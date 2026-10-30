// ============================================================================
// 邻伴 · 健康活动感知 · 采集入库（service 层，架构 §13 / PRD 红线②）
// ----------------------------------------------------------------------------
// 完整门闩顺序（契约 §13.3，顺序不可颠倒）：
//   总开关 → 双层授权（含范围子表）→ 设备已绑定且在线 → 设备令牌校验
//   → 特征清洗三道闸（禁字段/白名单/HMAC 化）→ 落 activity_signals（幂等）
//
// A5 已闭环：wifi_devices 有 device_token_hash + token_expires_at，
// 故令牌校验用 **常数时间比较**（safeEqualHex），防时序侧信道；
// 明文令牌只在签发时返回一次，库里只存 SHA-256 哈希。
// ============================================================================

import { createHash } from 'node:crypto';
import { wifi_device_status } from '@prisma/client';
import { AppError } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { safeEqualHex } from '../../common/crypto';
import { ACTIVITY_SCOPE } from '../../domain/activity-consent';
import { assertCollectAllowed, getWatchEnabled } from './consent.service';
import {
  IngestSanitizeError,
  redactFeatureLog,
  toPersistenceFeatures,
} from './ingest.sanitize';
import type { RawIngestPayload, SanitizedIngest } from './ingest.sanitize';

const log = moduleLogger('activity');

/** 设备令牌哈希（与 wifi_devices.device_token_hash 对齐，VarChar(64) → hex64） */
export function hashDeviceToken(plainToken: string): string {
  return createHash('sha256').update(plainToken.trim(), 'utf8').digest('hex');
}

/** 心跳超时的离线判定阈值倍数（last_heartbeat 超过 interval 的 N 倍即离线） */
const OFFLINE_INTERVAL_MULTIPLE = 3;

/** 采集上报入参（原始，含待HMAC 化的网络标识；device_no 由 service 单独入参传入） */
export type IngestInput = RawIngestPayload;

/** 采集结果 */
export interface IngestResult {
  accepted: boolean;
  signalId: string;
  /** 幂等回放标记：true = 命中已有窗口，未重复写 */
  replayed: boolean;
}

/**
 * 设备令牌校验（纯比较，无副作用）。
 * 失败一律22005（不区分「令牌不存在」与「令牌错误」，防探测）。
 */
export function verifyDeviceToken(
  storedHash: string | null,
  tokenExpiresAt: Date | null,
  plainToken: string,
  now: Date,
): boolean {
  if (!storedHash || !plainToken) return false;
  if (tokenExpiresAt && tokenExpiresAt.getTime() <= now.getTime()) return false;
  return safeEqualHex(storedHash, hashDeviceToken(plainToken));
}

/**
 * 采集入库主链路。
 * @param elderUserId 数据主体（老人）；来自 token，不接受端上传参
 * @param deviceNo 探针设备号
 * @param deviceToken 明文设备令牌（仅内存，不落库不落日志）
 */
export async function ingestSignal(
  elderUserId: bigint,
  deviceNo: string,
  deviceToken: string,
  raw: IngestInput,
  now = new Date(),
): Promise<IngestResult> {
  // 闸 1：采集总开关（opt-in，fail-safe 关闭）
  if (!(await getWatchEnabled())) {
    throw new AppError(22006, '健康活动感知当前未开放，采集已停止');
  }

  // 闸 2：双层授权（老人本人层 + 范围覆盖；子女层只影响共享不影响采集）
  await assertCollectAllowed(elderUserId, ACTIVITY_SCOPE.SUMMARY, now);

  // 闸 3：设备存在且属于该老人（防横向越权：设备不按老人过滤即等于越权采集）
  const device = await prisma.wifi_devices.findFirst({
    where: { device_no: deviceNo, elder_user_id: elderUserId },
  });
  if (!device) throw new AppError(22002, '感知设备未绑定');
  if (device.collect_enabled === false || device.status === wifi_device_status.REVOKED) {
    throw new AppError(22006, '采集已停止（本人已关闭健康活动感知）');
  }
  if (device.status !== wifi_device_status.ONLINE && device.status !== wifi_device_status.PENDING) {
    throw new AppError(22003, '感知设备离线');
  }

  // 闸 4：设备令牌（常数时间比较；明文令牌此刻起不再被使用）
  if (!verifyDeviceToken(device.device_token_hash, device.token_expires_at, deviceToken, now)) {
    throw new AppError(22005, '设备令牌校验失败');
  }

  // 闸 5：窗口粒度以**设备配置**为准（主理人裁定：设备级固化）。
  // 为什么必须固化：window_start 的对齐网格由 window_minutes 决定，若同一设备
  // 一次报 5、一次报 60，同一物理时刻会落两套坐标系 → 被切成两个窗口 →
  // 唯一键挡不住（日聚合会重复计数）。所以口径只认设备配置。
  // 端上传参仅作参考：不一致时**以设备为准 + 记 warn**，不拒绝——
  // 直接拒绝会让所有老版本端上报全失败（它们没这个字段 awareness）。
  const windowDecision = resolveWindowMinutes(device.window_minutes, raw.window_minutes);
  if (windowDecision.drifted) {
    log.warn(
      {
        event: 'activity-window-minutes-drift',
        device: deviceNo,
        deviceWindowMinutes: windowDecision.effective,
        clientWindowMinutes: raw.window_minutes,
      },
      '端上报窗口粒度与设备配置不一致，以设备配置为准（防同一时刻被切成两个窗口）',
    );
  }

  // 闸 6：特征清洗三道闸（禁字段 → 白名单 → HMAC 化），失败 22004
  let sanitized: SanitizedIngest;
  try {
    sanitized = toPersistenceFeatures(
      { ...raw, window_minutes: windowDecision.effective },
      await getRetentionDays(),
    );
  } catch (e) {
    if (e instanceof IngestSanitizeError) {
      // 只记字段名，绝不记入参值（防日志泄漏）
      log.warn({ event: 'activity-ingest-rejected', field: e.field }, '采集特征被拒（22004）');
      throw new AppError(22004, `上报特征格式不合法：${e.field}`);
    }
    throw e;
  }

  // 闸 6：幂等 —— 同设备同窗口只留一条（DB 复合唯一逻辑，代码层先查后写）
  const existing = await prisma.activity_signals.findFirst({
    where: { device_id: device.id, window_start: sanitized.window_start },
    select: { id: true },
  });
  if (existing) {
    return { accepted: true, signalId: existing.id.toString(), replayed: true };
  }

  const windowEnd = new Date(
    sanitized.window_start.getTime() + sanitized.window_minutes * 60000,
  );
  // 闸 7：写入。DB @@unique([device_id, window_start]) 是最终兜底，
  // 并发双写时后到者必撞 P2002 —— 捕获后**回放既有行**而非报错。
  // 为什么必须捕获：APP 心跳遇网络抖动会自行重试，两个请求并发到达是常态，
  // 让上报端收到 500 会诱发更多重试（重试风暴），且语义上「这条窗口已经记过了」
  // 本就该是成功。上报端看到的是 accepted:true + replayed:true。
  let createdId: bigint;
  try {
    const created = await prisma.activity_signals.create({
      data: {
        elder_user_id: elderUserId,
        device_id: device.id,
        channel: 'CHANNEL_A_APP',
        window_start: sanitized.window_start,
        window_end: windowEnd,
        window_minutes: sanitized.window_minutes,
        features: sanitized.features as never,
        data_freshness_seconds: Math.max(
          0,
          Math.round((now.getTime() - windowEnd.getTime()) / 1000),
        ),
        ssid_hmac: sanitized.ssid_hmac,
        bssid_hmac: sanitized.bssid_hmac,
        retained_until: sanitized.retained_until,
        // 心跳即在线
        ...(device.status === 'PENDING' || !device.last_heartbeat_at
          ? { status: 'ONLINE', last_heartbeat_at: now }
          : { last_heartbeat_at: now }),
      },
      select: { id: true },
    });
    createdId = created.id;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // 并发窗口：唯一键已由先到者占用，回放它的 id。
    // 复合唯一键名device_id_window_start 来自 @@unique([device_id, window_start])。
    const winner = await prisma.activity_signals.findUnique({
      where: {
        device_id_window_start: {
          device_id: device.id,
          window_start: sanitized.window_start,
        },
      },
      select: { id: true },
    });
    // 回查还查不到（先到者恰好在同一瞬间被留存清理删掉）→ 不吞错误，走正常抛路径
    if (!winner) throw e;
    log.info(
      {
        event: 'activity-ingest-replayed-by-unique',
        device: deviceNo,
        window_start: sanitized.window_start.toISOString(),
        signalId: winner.id.toString(),
      },
      '并发上报命中唯一键，回放既有信号（幂等）',
    );
    return { accepted: true, signalId: winner.id.toString(), replayed: true };
  }

  // 日志：只出脱敏摘要（白名单字段 + HMAC 前8 位），原文绝不进日志
  log.info(
    { event: 'activity-ingest', device: deviceNo, ...redactFeatureLog(sanitized) },
    '活动信号已采集（原文已HMAC 化）',
  );

  return { accepted: true, signalId: createdId.toString(), replayed: false };
}

/**
 * 判断是否为 Prisma 唯一约束冲突（P2002）。
 * 刻意不按 message 文本匹配——Prisma 的错误文案随版本变化，按文本判会漏。
 */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object'
    && e !== null
    && (e as { code?: unknown }).code === 'P2002'
  );
}

/** 窗口粒度合法区间（分钟）。下界与 activity_signals 默认 5 分钟一致 */
export const WINDOW_MINUTES_MIN = 1;
export const WINDOW_MINUTES_MAX = 1440;

export interface WindowMinutesDecision {
  /** 最终生效值（= 设备配置） */
  effective: number;
  /** 端上传参是否与设备配置不一致（不一致时记 warn） */
  drifted: boolean;
}

/**
 * 窗口粒度裁决（纯函数，可单测）：**一律以设备配置为准**。
 * 设备配置缺失或非法时回落 5（schema 默认值），不回落端上传参——
 * 回落端上传参等于把「设备级固化」这个约束又漏回端上。
 */
export function resolveWindowMinutes(
  deviceWindowMinutes: number | null | undefined,
  clientWindowMinutes: number | null | undefined,
): WindowMinutesDecision {
  const valid = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isInteger(n)
    && n >= WINDOW_MINUTES_MIN && n <= WINDOW_MINUTES_MAX;

  const effective = valid(deviceWindowMinutes) ? deviceWindowMinutes : 5;
  const drifted = valid(clientWindowMinutes) && clientWindowMinutes !== effective;
  return { effective, drifted };
}

/** 留存天数配置（红线硬上限 14 由 sanitize 层兜住，此处只读配置） */
async function getRetentionDays(): Promise<number> {
  const row = await prisma.system_configs.findUnique({
    where: { config_key: 'activity_signal_retention_days' },
  });
  const n = row ? Number(row.config_value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/** 信号 TTL 配置（秒）；分级时判过期用 */
export async function getSignalTtlSec(): Promise<number> {
  const row = await prisma.system_configs.findUnique({
    where: { config_key: 'activity_signal_ttl' },
  });
  const n = row ? Number(row.config_value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 21600;
}

/** 设备是否应判离线（心跳超时倍数判定，纯函数化便于单测） */
export function shouldMarkOffline(
  status: wifi_device_status,
  collectEnabled: boolean,
  lastHeartbeatAt: Date | null,
  intervalSec: number,
  now: Date,
): boolean {
  if (collectEnabled === false || status === wifi_device_status.REVOKED) return false;
  if (!lastHeartbeatAt) return false;
  const elapsedSec = (now.getTime() - lastHeartbeatAt.getTime()) / 1000;
  return elapsedSec > intervalSec * OFFLINE_INTERVAL_MULTIPLE;
}