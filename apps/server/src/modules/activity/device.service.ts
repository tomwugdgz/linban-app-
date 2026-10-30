// ============================================================================
// 邻伴 · 健康活动感知 · 探针绑定（service 层，架构 §13.3 / 契约 §13.3）
// ----------------------------------------------------------------------------
// 契约硬要求：**必须先授权后绑设备**，不得反向——授权未 GRANTED 直接 22001。
// 顺序若反了，会造出「设备绑上了但采集立刻被门闩挡住」的脏状态：
// 用户看到绑定成功，实际一条数据都采不进来，且排查方向会被带偏（怀疑硬件）。
//
// 三条设计纪律：
//   1. device_no 由**服务端生成**，不接受端上传参。端上能指定 device_no
//      就等于能指定「我用谁的设备身份上报」——虽然还有令牌校验兜底，
//      但把可枚举的标识交给端上设定，等于把越权面从token 挪到字符串。
//   2. 明文令牌**只在此处返回一次**，库里只存 SHA-256 哈希（A5）。
//      重复 bind 不重新签发（否则同一设备每次绑定都换令牌，正在上报的
//      旧令牌瞬间失效，客户端与库不同步），而是回放首次的 device_no。
//   3. 守卫列模式：`active_key='A'` 表示当前生效。schema 上有
//      `@@unique([elder_user_id, device_type, active_key])`，所以同老人
//      同类型只能有一条生效设备；换绑时旧行 active_key 置 NULL。
//
// 隐私：MAC 一律只落 device_mac_hmac（HMAC-SHA256），原文不出进程、不入日志
// （PRD 红线②，与 ingest 同一把钥匙，口径一致才能做同家识别）。
// ============================================================================

import { randomBytes } from 'node:crypto';
import { wifi_device_status, wifi_device_type } from '@prisma/client';
import { AppError } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { hmacIndex } from '../../common/crypto';
import { ACTIVITY_SCOPE } from '../../domain/activity-consent';
import { assertCollectAllowed } from './consent.service';
import { hashDeviceToken } from './ingest.service';
import { normalizeNetworkIdentity } from './ingest.sanitize';

const log = moduleLogger('activity');

/** 守卫列：当前生效设备（schema 靠它做同类型唯一） */
const ACTIVE_KEY = 'A';

/** 设备令牌有效期（天）。到期须轮换——schema 上有token_expires_at 索引供扫描。 */
export const DEVICE_TOKEN_TTL_DAYS = 90;

/** device_no 前缀：与 genBizNo 格式对齐（<前缀><yyyyMMdd><10 位随机 base36 大写>） */
const DEVICE_NO_PREFIX = 'WFD';

/**
 * MVP 开放的设备类型白名单（契约 §13.3）。
 * 通道B 网关是 W+1 硬件，此处**明确拒绝而非静默降级**——静默降级会让端上
 * 以为绑成功、实际数据永不落库，排查方向会被带偏到硬件上。
 */
export const BINDABLE_DEVICE_TYPES: readonly wifi_device_type[] = [wifi_device_type.APP_PROBE];

/** 生成 device_no（服务端生成，见纪律 1） */
export function genDeviceNo(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
  return `${DEVICE_NO_PREFIX}${y}${m}${d}${rand}`;
}

/** 生成明文设备令牌（32 字节随机 → base64url，43 字符） */
export function genDeviceToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 归一化 MAC 后 HMAC 化；入参非法时返回 null（不抛——MAC 是可选字段） */
export function macToHmac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const normalized = normalizeNetworkIdentity('MAC', mac);
  return normalized.ok ? normalized.hmac : null;
}

/** 绑定入参（端上传参仅这些；elderId 一律从 token 解析，不接受端上传参） */
export interface BindDeviceInput {
  deviceType: wifi_device_type;
  /** 设备 MAC（原文，仅内存；落库只留 HMAC） */
  mac?: string | null;
  vendor?: string | null;
  model?: string | null;
  heartbeatIntervalSec?: number | null;
}

export interface BindDeviceResult {
  deviceId: string;
  deviceNo: string;
  deviceType: wifi_device_type;
  status: wifi_device_status;
  /**
   * 明文设备令牌：**仅首次签发时返回**，之后一律 null。
   * 端上必须自行持久化（后续心跳放X-Device-Token 头）。
   */
  deviceToken: string | null;
  tokenExpiresAt: string | null;
  heartbeatIntervalSec: number;
  /** 替换了多少条旧设备（同类型换绑时旧行 active_key 置 NULL） */
  replacedDeviceCount: number;
  /** 幂等回放标记：true = 已有生效设备，未新建、未换令牌 */
  replayed: boolean;
}

/**
 * 绑定探针（契约 §13.3，幂等）。
 *
 * 幂等语义：同老人 + 同类型已有 active_key='A' 的设备 → 回放，不再签发令牌。
 * 这是刻意选择：重新签发会让客户端手���的旧令牌立刻失效，
 * 而令牌明文不可从库里取回（只有哈希），重签等于强制客户端重新配对。
 */
export async function bindDevice(
  elderUserId: bigint,
  input: BindDeviceInput,
  now = new Date(),
): Promise<BindDeviceResult> {
  // 闸 1：总开关 + 双层授权（老人本人层 GRANTED 且范围覆盖 SUMMARY）。
  // 复用 ingest 的同一道门闩——授权口径必须一处实现，否则两端口径会漂移。
  // 未授权 → 22001，总开关关/已撤销停采 → 22006（由 consent.service 映射）。
  await assertCollectAllowed(elderUserId, ACTIVITY_SCOPE.SUMMARY, now);

  // 闸 2：类型白名单。通道B 网关是 W+1 硬件，MVP 不开放绑定——但**不能静默降级**，
  // 静默降级会让端上以为绑成功、实际数据永不落库。这里明确拒绝。
  if (!BINDABLE_DEVICE_TYPES.includes(input.deviceType)) {
    throw new AppError(22004, '暂不支持该设备类型（网关通道为 W+1 能力）');
  }

  // 幂等：已有同类型生效设备 → 回放，不新建不换令牌
  const existing = await prisma.wifi_devices.findFirst({
    where: { elder_user_id: elderUserId, device_type: input.deviceType, active_key: ACTIVE_KEY },
  });
  if (existing) {
    log.info(
      { event: 'activity-device-bind-replay', elder: String(elderUserId), device: existing.device_no },
      '感知设备已绑定，幂等回放（不重签令牌）',
    );
    return {
      deviceId: existing.id.toString(),
      deviceNo: existing.device_no,
      deviceType: existing.device_type,
      status: existing.status,
      deviceToken: null, // 明文不可复现（库里只有哈希）
      tokenExpiresAt: existing.token_expires_at?.toISOString() ?? null,
      heartbeatIntervalSec: existing.heartbeat_interval_sec,
      replacedDeviceCount: 0,
      replayed: true,
    };
  }

  const intervalSec = normalizeInterval(input.heartbeatIntervalSec);
  const plainToken = genDeviceToken();
  const tokenExpiresAt = new Date(now.getTime() + DEVICE_TOKEN_TTL_DAYS * 86400000);
  const macHmac = macToHmac(input.mac);

  // 换绑保护：把同类型的历史行 active_key 置 NULL（守卫列腾位）。
  // 正常路径下不该有多条（唯一约束挡住了），但历史脏数据可能存在，
  // 不清会让新行插入撞唯一索引。
  const cleared = await prisma.wifi_devices.updateMany({
    where: { elder_user_id: elderUserId, device_type: input.deviceType, active_key: { not: null } },
    data: { active_key: null, status: wifi_device_status.UNBOUND },
  });

  // device_no 唯一索引兜底：随机碰撞概率极低（36^10），但真撞上必须换号重试，
  // 而不是把 P2002 抛给端上——那是服务端问题，不该让用户重试。
  const created = await createDeviceWithRetry({
    elderUserId,
    input,
    intervalSec,
    plainToken,
    tokenExpiresAt,
    macHmac,
    now,
  });

  log.info(
    {
      event: 'activity-device-bind',
      elder: String(elderUserId),
      device: created.device_no,
      deviceType: created.device_type,
      replaced: cleared.count,
      macBound: macHmac !== null,
    },
    '探针绑定成功（明文令牌仅本次返回）',
  );

  return {
    deviceId: created.id.toString(),
    deviceNo: created.device_no,
    deviceType: created.device_type,
    status: created.status,
    deviceToken: plainToken,
    tokenExpiresAt: created.token_expires_at?.toISOString() ?? null,
    heartbeatIntervalSec: created.heartbeat_interval_sec,
    replacedDeviceCount: cleared.count,
    replayed: false,
  };
}

/** device_no 碰撞重试次数（上限；超过则抛 500，属极端异常） */
const DEVICE_NO_RETRY = 3;

/** 插入设备行；撞 device_no 唯一索引则换号重试 */
async function createDeviceWithRetry(args: {
  elderUserId: bigint;
  input: BindDeviceInput;
  intervalSec: number;
  plainToken: string;
  tokenExpiresAt: Date;
  macHmac: string | null;
  now: Date;
}) {
  const { elderUserId, input, intervalSec, plainToken, tokenExpiresAt, macHmac, now } = args;
  for (let attempt = 0; attempt < DEVICE_NO_RETRY; attempt += 1) {
    try {
      return await prisma.wifi_devices.create({
        data: {
          device_no: genDeviceNo(now),
          elder_user_id: elderUserId,
          device_type: input.deviceType,
          // 待首次心跳（不是 ONLINE——没心跳就不能说在线）
          status: wifi_device_status.PENDING,
          active_key: ACTIVE_KEY,
          vendor: input.vendor?.slice(0, 64) ?? null,
          model: input.model?.slice(0, 64) ?? null,
          device_mac_hmac: macHmac,
          device_token_hash: hashDeviceToken(plainToken),
          token_issued_at: now,
          token_expires_at: tokenExpiresAt,
          collect_enabled: true,
          heartbeat_interval_sec: intervalSec,
          bound_at: now,
        },
      });
    } catch (e) {
      // P2002 =唯一冲突。要么是 device_no 碰撞（换号重试），
      // 要么是 [elder_user_id, device_type, active_key] 守卫列冲突
      //（并发 bind——此时首个请求已成功，重试必然还是冲突，直接抛出让端上走幂等回放）。
      const code = (e as { code?: string })?.code;
      if (code !== 'P2002') throw e;
      const target = (e as { meta?: { target?: unknown } })?.meta?.target;
      const isDeviceNoConflict = JSON.stringify(target ?? '').includes('device_no');
      if (!isDeviceNoConflict) {
        log.warn({ event: 'activity-device-bind-conflict', elder: String(elderUserId) },
          '并发绑定撞守卫列唯一约束（非device_no 碰撞），不再重试');
        throw new AppError(22004, '设备绑定冲突，请重试');
      }
      log.warn({ event: 'activity-device-no-retry', attempt: attempt + 1 }, 'device_no 碰撞，换号重试');
    }
  }
  throw new AppError(22004, '设备号生成失败，请重试');
}

/**
 * 解绑 / 撤销单设备（红线⑦ 的设备侧落点）。
 * 撤销授权走 revokeConsent（会连带置停采）；这里只管设备维度。
 */
export async function unbindDevice(
  elderUserId: bigint,
  deviceId: bigint,
  now = new Date(),
): Promise<{ unbound: true; effectiveAt: Date }> {
  const device = await prisma.wifi_devices.findFirst({
    where: { id: deviceId, elder_user_id: elderUserId },
    select: { id: true },
  });
  // 不区分「不存在」与「不属于你」：防存在性探测（同 assertActivityReadable 口径）
  if (!device) throw new AppError(23004, '感知设备不存在或无权操作');

  await prisma.wifi_devices.update({
    where: { id: device.id },
    data: {
      active_key: null,
      status: wifi_device_status.UNBOUND,
      collect_enabled: false,
      disabled_at: now,
      // 令牌立即失效：解绑后旧令牌不得再上报
      device_token_hash: null,
      token_expires_at: null,
    },
  });
  log.info(
    { event: 'activity-device-unbind', elder: String(elderUserId), device: deviceId.toString() },
    '探针已解绑（令牌即时失效）',
  );
  return { unbound: true, effectiveAt: now };
}

/** 心跳间隔归一（秒）：缺省 60，区间 [15, 3600]，越界回落缺省 */
export function normalizeInterval(input: number | null | undefined): number {
  if (input === null || input === undefined) return 60;
  if (!Number.isFinite(input)) return 60;
  const n = Math.floor(input);
  if (n < 15 || n > 3600) return 60;
  return n;
}