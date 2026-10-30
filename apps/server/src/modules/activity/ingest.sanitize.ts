// ============================================================================
// 邻伴 · 健康活动感知 · 采集入口的原文处理（架构 §13 / PRD 红线②③）
// ----------------------------------------------------------------------------
// 这条链路是整个模块的隐私命门：**SSID / BSSID / MAC 原文只在内存里存在
// 一瞬，随即被 HMAC-SHA256(pepper) 替换，之后的一切（写库/打日志/抛错/审计）
// 一律只见盲索引 hex64。代码机制而非约定：
//   · `normalizeNetworkIdentity` —— 归一 + 分类，出参**只含 hmac 字段**；
//   · `redactFeatureLog`         —— 日志脱敏器，白名单式输出（拒绝值不出进程）；
//   · `toPersistenceFeatures`    —— 落库前的最后一道闸，原文类型不可传入。
//
// 纪律：不得为了「排查方便」把原文塞进 log/error message —— 本文件是唯一
// 允许原文短暂存在的位置，且函数返回后调用方变量里不应再持有原文。
// ============================================================================

import { hmacIndex } from '../../common/crypto';
import { FORBIDDEN_FEATURE_KEYS, checkFeaturePayload } from '../../domain/activity-consent';

/** 端上可上报的网络标识类型（均须HMAC 化，不落原文） */
export type NetworkIdentityKind = 'SSID' | 'BSSID' | 'MAC';

/** 归一后的网络标识：只有盲索引，没有原文 */
export interface NetworkIdentityHmac {
  kind: NetworkIdentityKind;
  /** HMAC-SHA256(pepper, normalized) hex64 */
  hmac: string;
  /** 是否成功归一（false 时hmac 为 null，调用方应拒收该字段而非落空值） */
  ok: boolean;
}

/**
 * 网络标识归一：
 *   · BSSID / MAC —— 去分隔符并转大写（`a4:2b:b0` / `A4-2B-B0` 视为同一设备）；
 *   · SSID —— 仅去首尾空白（**大小写与空格可能有语义，不做激进的归一**，
 *     否则不同热点会误判为同一网络）。
 * 返回值里**没有原文字段**，这是刻意的：让调用方在拿到结果的那一刻就
 * 不可能把原文传下去。
 */
export function normalizeNetworkIdentity(
  kind: NetworkIdentityKind,
  rawValue: string,
): NetworkIdentityHmac {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return { kind, hmac: '', ok: false };
  const payload =
    kind === 'SSID' ? trimmed : trimmed.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (payload.length === 0) return { kind, hmac: '', ok: false };
  return { kind, hmac: hmacIndex(payload), ok: true };
}

/** 端上上报的原始采集入参（字段名用 snake_case 对齐端侧 SDK 习惯） */
export interface RawIngestPayload {
  /** 已连接的 Wi-Fi SSID（原文，仅内存） */
  ssid?: string | null;
  /** 已连接的 Wi-Fi BSSID（原文，仅内存） */
  bssid?: string | null;
  /** 设备 MAC（原文，仅内存） */
  mac?: string | null;
  /** 采集窗口起止（ISO 字符串或时间戳） */
  window_start: Date;
  window_minutes: number;
  /** 派生特征（allowed 白名单外的字段会被拒，见 ALLOWED_FEATURE_KEYS） */
  features?: Record<string, number> | null;
}

/** 允许落库的派生特征白名单（**白名单而非黑名单**：新增字段必须显式放行） */
export const ALLOWED_FEATURE_KEYS: readonly string[] = [
  'windowMinutes',
  'activeMinutes',
  'networkSwitchCount',
  'connectionStability',
  'activityCount',
  'rssiAvg',
  'rssiStd',
  'apCount',
  'nightActiveMinutes',
];

/** 归一化后的采集入参（可落库、可打日志） */
export interface SanitizedIngest {
  ssid_hmac: string | null;
  bssid_hmac: string | null;
  mac_hmac: string | null;
  window_start: Date;
  window_minutes: number;
  /** 仅白名单内的派生特征 */
  features: Record<string, number>;
  /** 留存截止时刻（window_end + 留存天数，留存上限硬性14 天由 service 传入） */
  retained_until: Date;
}

export class IngestSanitizeError extends Error {
  /** 22004：上报特征格式不合法（字段名，绝不含值） */
  readonly field: string;
  constructor(field: string) {
    super(`采集特征不合法字段: ${field}`);
    this.name = 'IngestSanitizeError';
    this.field = field;
  }
}

/**
 * 采集窗口起点对齐（幂等成立的前提，team-lead 指定实现位置）。
 *
 * 为什么必须做：`activity_signals` 的唯一索引是 `(device_id, window_start)`，
 * 而 `window_start` 是 `DateTime(3)`（**毫秒精度**）。同一设备同一 5 分钟窗口，
 * 因上报抖动落在不同毫秒（10:00:00.123 与 10:00:00.456）时，
 * 唯一键会**放行两条** → 日聚合被重复计数污染。这类 bug 极难发现，
 * 所以对齐必须在 HMAC 化之前做（顺序：**先对齐 → 再 HMAC 化 → 再落库**）。
 *
 * 口径：**向下取整**到 windowMinutes 的整数倍边界（UTC）。
 * 取整而非四舍五入的理由：窗口是「覆盖区间」语义，向下取整保证
 * 同一区间内的所有上报都落在同一代表时刻，且不会把数据推到未来窗口。
 */
export function alignWindowStart(windowStart: Date, windowMinutes: number): Date {
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new IngestSanitizeError('window_minutes');
  }
  const ms = windowStart.getTime();
  if (!Number.isFinite(ms)) throw new IngestSanitizeError('window_start');
  const windowMs = windowMinutes * 60000;
  // 以 UTC 纪元为基准向下取整（不受服务器本地时区影响）
  return new Date(Math.floor(ms / windowMs) * windowMs);
}

/** 留存天数硬上限（PRD 红线⑥：原始特征 ≤14 天，不接受配置放大） */
export const RETENTION_DAYS_HARD_CAP = 14;

/**
 * 采集入参清洗（落库前唯一入口）。
 * 三道闸：
 *   1.禁原始字段（CSI/波形/音视频/定位）→ IngestSanitizeError；
 *   2. 派生特征走**白名单**，非白名单键一律拒（防端上新传敏感字段）；
 *   3. SSID/BSSID/MAC 一律 HMAC 化，出参**结构上不含原文**。
 * @param retentionDays 配置留存天数；超过硬上限 14 时按 14 截断（红线不可配大）
 */
export function toPersistenceFeatures(
  raw: RawIngestPayload,
  retentionDays: number,
): SanitizedIngest {
  // 闸 1：禁字段（大小写不敏感）——只扫 features 子对象；
  //顶层 ssid/bssid/mac 是**允许字段**，它们由闸 3 做 HMAC 化；
  //若它们出现在 features 内则视为绕过 HMAC 化，同样拒绝。
  const check = checkFeaturePayload((raw.features ?? {}) as Record<string, unknown>);
  if (!check.ok) throw new IngestSanitizeError(check.rejectedField!);

  // 闸 2：派生特征白名单（附数值合法性：有限数、非负）
  const features: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw.features ?? {})) {
    if (!ALLOWED_FEATURE_KEYS.includes(k)) throw new IngestSanitizeError(k);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new IngestSanitizeError(k);
    features[k] = v;
  }
  if (!Number.isFinite(raw.window_minutes) || raw.window_minutes <= 0) {
    throw new IngestSanitizeError('window_minutes');
  }

  // 闸 3：网络标识 HMAC 化（出参结构上无原文）
  const days = Math.min(Math.max(1, Math.floor(retentionDays)), RETENTION_DAYS_HARD_CAP);
  // 先对齐窗口起点（幂等唯一键成立的前提），再算窗口止与留存截止
  const alignedStart = alignWindowStart(raw.window_start, raw.window_minutes);
  const windowEnd = new Date(alignedStart.getTime() + raw.window_minutes * 60000);
  const ssid = raw.ssid ? normalizeNetworkIdentity('SSID', raw.ssid) : null;
  const bssid = raw.bssid ? normalizeNetworkIdentity('BSSID', raw.bssid) : null;
  const mac = raw.mac ? normalizeNetworkIdentity('MAC', raw.mac) : null;

  return {
    ssid_hmac: ssid?.ok ? ssid.hmac : null,
    bssid_hmac: bssid?.ok ? bssid.hmac : null,
    mac_hmac: mac?.ok ? mac.hmac : null,
    window_start: alignedStart,
    window_minutes: raw.window_minutes,
    features,
    retained_until: new Date(windowEnd.getTime() + days * 86400000),
  };
}

/**
 * 日志脱敏输出（白名单式）：只允许数值型派生特征与 HMAC 前 8 位，
 * 任何字符串型字段一律不出现在日志里——包括 SSID/BSSID/MAC 原文。
 */
export function redactFeatureLog(input: SanitizedIngest): Record<string, unknown> {
  return {
    window_start: input.window_start.toISOString(),
    window_minutes: input.window_minutes,
    retained_until: input.retained_until.toISOString(),
    features: input.features,
    ssid_hmac_prefix: input.ssid_hmac ? input.ssid_hmac.slice(0, 8) : null,
    bssid_hmac_prefix: input.bssid_hmac ? input.bssid_hmac.slice(0, 8) : null,
    mac_hmac_prefix: input.mac_hmac ? input.mac_hmac.slice(0, 8) : null,
    feature_count: Object.keys(input.features).length,
  };
}

/** 禁字段清单对外暴露（供单测与文档核对；勿在业务里另造同义列表） */
export { FORBIDDEN_FEATURE_KEYS };