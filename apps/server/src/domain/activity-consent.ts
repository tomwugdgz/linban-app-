// ============================================================================
// 邻伴 · 健康活动感知 · 授权门闩（domain 纯函数，架构 §13 / PRD 红线④）
// ----------------------------------------------------------------------------
// 为什么独立成文件：双层知情同意与「撤销即停采」是**红线的代码机制**，不是
// 注释——它必须在任何 IO 之前先被判定，且判定逻辑可单测、可回放。
//
// 四条硬约束（PRD 红线）：
//   1. **双层**：老人本人层 + 子女层，两层都 GRANTED 才允许采集与共享；
//   2. **范围**：授权主表 GRANTED 之外，还须 `consent_scopes` 覆盖当前采集
//      范围（否则「授权了但没授权这个范围」会被误读为全量同意）；
//   3. **撤销即停采**：任一层 REVOKED → 立即拒绝采集（不等历史清理完成，
//      撤销与清理解耦，team-lead 裁定②）；
//   4. **可解释**：拒绝必须带reason code + 影响范围说明，供隐私中心与客服
//      复现「为什么停了」，不允许只回一个 false。
//
// 零 IO：调用方（modules/activity）负责把 DB 行读成这里的入参形状。
// ============================================================================

import { activity_consent_scope_level, activity_consent_status } from '@linban/shared';

// ---------------------------------------------------------------------------
// 采集范围（scope）枚举：与 activity_consent_scopes 表的 scope 语义对齐
// ---------------------------------------------------------------------------

/** 可采集的数据范围（PRD：按数据类别分档，非按功能分档） */
export const ACTIVITY_SCOPE = {
  /** 活动状态汇总（日报/趋势/看板） */
  SUMMARY: 'SUMMARY',
  /** 告警（久静/离线等安全兜底推送） */
  ALERT: 'ALERT',
  /** 子女可见范围档位（授权子女能看多细） */
  FAMILY_VISIBLE: 'FAMILY_VISIBLE',
} as const;
export type ActivityScope = (typeof ACTIVITY_SCOPE)[keyof typeof ACTIVITY_SCOPE];

/** 门闩拒绝原因码（落order_timeline / audit_logs / 隐私中心展示） */
export const CONSENT_DENY_REASON = {
  /** 老人本人层未授权（PENDING 或 REVOKED） */
  ELDER_NOT_GRANTED: 'ELDER_NOT_GRANTED',
  /** 子女层未授权——注意：子女层 PENDING 不阻断采集，仅阻断共享 */
  FAMILY_NOT_GRANTED: 'FAMILY_NOT_GRANTED',
  /** 授权已过期（策略版本变更或到期） */
  CONSENT_EXPIRED: 'CONSENT_EXPIRED',
  /** 授权范围未覆盖本次采集范围 */
  SCOPE_NOT_COVERED: 'SCOPE_NOT_COVERED',
  /** 采集总开关关闭（activity_watch_enabled=false，灰度未开） */
  WATCH_DISABLED: 'WATCH_DISABLED',
} as const;
export type ConsentDenyReason = (typeof CONSENT_DENY_REASON)[keyof typeof CONSENT_DENY_REASON];

// ---------------------------------------------------------------------------
// 入参形状（由 service 层从 DB 行投影，domain 不碰 IO）
// ---------------------------------------------------------------------------

/** 单层授权（老人本人层或子女层各一份） */
export interface ConsentLayer {
  status: activity_consent_status;
  /** 授权范围覆盖的 scope 集合（来自 activity_consent_scopes 子表） */
  scopes: readonly ActivityScope[];
  /** 授权到期时间；null = 不限期 */
  expiresAt?: Date | null;
}

export interface ConsentGateInput {
  /** 采集总开关（system_configs.activity_watch_enabled，默认 false=opt-in） */
  watchEnabled: boolean;
  /** 老人本人层授权 */
  elder: ConsentLayer | null;
  /** 子女层授权（可无子女，故可null） */
  family: ConsentLayer | null;
  /** 本次操作要访问/采集的范围 */
  scope: ActivityScope;
  /** 判定时刻 */
  now: Date;
}

export interface ConsentGateResult {
  /** 是否允许本次操作 */
  allowed: boolean;
  /** 拒绝原因码（allowed=true 时为 null） */
  denyReason: ConsentDenyReason | null;
  /** 面向用户的影响范围说明（隐私中心与客服可读，禁止含内部规则明细） */
  impactNote: string | null;
  /**
   * 是否允许**共享给子女**（采集与共享是两个动作，门闩分开判）：
   * 子女层未授权时仍可采集（安全兜底不依赖子女同意，Q9），
   * 但绝不可把数据共享出去。
   */
  sharingAllowed: boolean;
}

// ---------------------------------------------------------------------------
// 主判定
// ---------------------------------------------------------------------------

/** 授权是否处于生效态（GRANTED 且未过期） */
export function isConsentEffective(layer: ConsentLayer | null, now: Date): boolean {
  if (!layer) return false;
  if (layer.status === activity_consent_status.REVOKED) return false;
  if (layer.status !== activity_consent_status.GRANTED) return false;
  if (layer.expiresAt && layer.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** 该层是否覆盖指定范围（导出供单测与 service 层复用） */
export function coversActivityScope(layer: ConsentLayer | null, scope: ActivityScope): boolean {
  return Boolean(layer && layer.scopes.includes(scope));
}

/** 生成影响范围说明（可审计文案；不含内部规则明细） */
function impactOf(reason: ConsentDenyReason): string {
  switch (reason) {
    case CONSENT_DENY_REASON.WATCH_DISABLED:
      return '健康活动感知功能当前未开放，已停止采集；你的数据未被使用。';
    case CONSENT_DENY_REASON.ELDER_NOT_GRANTED:
      return '你尚未开启健康活动感知授权（或已关闭），采集已停止；已产生的原始特征正在按留存策略清理，日聚合数据不再新增。';
    case CONSENT_DENY_REASON.CONSENT_EXPIRED:
      return '授权已到期，采集自动停止；如需继续请重新开启。';
    case CONSENT_DENY_REASON.SCOPE_NOT_COVERED:
      return '本次采集范围不在你的授权范围内，已跳过；其他已授权范围不受影响。';
    case CONSENT_DENY_REASON.FAMILY_NOT_GRANTED:
      return '采集不受影响，但数据不会共享给子女，直至子女层授权生效。';
  }
}

/**
 * 双层同意门闩（纯函数）。
 *
 * 判定顺序（短路，越靠前越先拒绝）：
 *   1. 总开关关闭 → WATCH_DISABLED（**全拒**，灰度未开时一条都不采）；
 *   2. 老人本人层失效 → ELDER_NOT_GRANTED / CONSENT_EXPIRED（**撤销即停采**）；
 *   3. 范围未覆盖 → SCOPE_NOT_COVERED；
 *   4. 通过 → allowed=true。
 *
 * **子女层不参与采集门闩**（只在 sharingAllowed 体现）：安全兜底（久静/离线
 * 告警与客服外呼）是平台安全责任，不因子女未同意而降级（Q9刻意偏离）。
 */
export function assertConsent(input: ConsentGateInput): ConsentGateResult {
  const { watchEnabled, elder, family, scope, now } = input;
  //共享独立判定：需子女层生效**且** 明确授权 FAMILY_VISIBLE 范围，
  //与本次操作的 scope 无关（哪怕本次只是采集告警，也要有共享授权才可共享）
  const sharingAllowed =
    isConsentEffective(family, now) && coversActivityScope(family, ACTIVITY_SCOPE.FAMILY_VISIBLE);

  const deny = (reason: ConsentDenyReason): ConsentGateResult => ({
    allowed: false,
    denyReason: reason,
    impactNote: impactOf(reason),
    sharingAllowed: false,
  });

  // 1. 总开关（opt-in 灰度）
  if (!watchEnabled) return deny(CONSENT_DENY_REASON.WATCH_DISABLED);

  // 2. 老人本人层：撤销/过期即刻停采，不等历史清理
  if (!elder) return deny(CONSENT_DENY_REASON.ELDER_NOT_GRANTED);
  if (
    elder.status === activity_consent_status.REVOKED
    || elder.status === activity_consent_status.PENDING
  ) {
    return deny(CONSENT_DENY_REASON.ELDER_NOT_GRANTED);
  }
  if (elder.expiresAt && elder.expiresAt.getTime() <= now.getTime()) {
    return deny(CONSENT_DENY_REASON.CONSENT_EXPIRED);
  }

  // 3. 范围覆盖（授权了≠授权了这个范围）
  if (!coversActivityScope(elder, scope)) return deny(CONSENT_DENY_REASON.SCOPE_NOT_COVERED);

  return { allowed: true, denyReason: null, impactNote: null, sharingAllowed };
}

// ---------------------------------------------------------------------------
// 一键关闭（撤销）的纯函数部分：撤销即时生效 + 清理异步解耦
// ---------------------------------------------------------------------------

export interface RevokePlan {
  /** 生效时刻（撤销即刻，采集入口从此拒绝） */
  effectiveAt: Date;
  /** 是否需清理未聚合原始特征（红线：撤销后不再保留） */
  purgeUnaggregated: boolean;
  /** 日聚合是否留存（留存= true，出参必须明示，避免误解为「全删」） */
  aggregateRetained: boolean;
  /** 面向用户的说明 */
  note: string;
}

/**
 * 一键关闭的处置计划（纯函数）。
 * 裁定②：撤销请求**不等待**大批量清理——即时停采 + 异步清理，撤销与清理解耦，
 * 清理完成后由 service 回写 consents 的清理确认态（字段 A4 待宋砚秋定稿）。
 */
export function planRevoke(now: Date): RevokePlan {
  return {
    effectiveAt: now,
    purgeUnaggregated: true,
    aggregateRetained: true,
    note: '已立即停止采集；未聚合的原始特征将在留存期内清理完毕，历史活动日报与趋势会保留用于你随时回看。如需彻底删除全部数据，请联系客服。',
  };
}

/** 采集入参范围校验（红线：不引入 L4 字段/原始波形，格式非法即拒 22004） */
export interface FeaturePayloadCheck {
  ok: boolean;
  /** 拒绝时给出的字段名（不含值，绝不回显原文） */
  rejectedField: string | null;
}

/**
 * `features` 子对象内**绝对禁止**出现的字段（小写比较）。
 * PRD 红线③：只收派生特征，不引入 L4 字段、不存原始波形/音视频/定位。
 * 注意：SSID/BSSID/MAC 不在此列——它们是顶层允许字段，但**必须**经
 * `modules/activity/ingest.sanitize.ts` 的 `normalizeNetworkIdentity` 做
 * HMAC 化后才落库（原文不出进程）；若出现在 `features` 内则视为绕过
 * HMAC 化，同样拒绝。
 */
export const FORBIDDEN_FEATURE_KEYS: readonly string[] = [
  'csi',
  'csi_raw',
  'waveform',
  'wave',
  'audio',
  'video',
  'camera',
  'microphone',
  'gps',
  'latitude',
  'longitude',
  'location',
  'ssid',
  'bssid',
  'mac',
  'macaddr',
  'mac_address',
  'rssi_raw',
];

/**
 * 采集特征格式校验（纯函数）。
 * 两条纪律：
 *   1. **禁原始字段**——SSID/BSSID/MAC 等原文由端上上报后**立即 HMAC 化**，
 *      但即便如此也不接受 CSI/原始波形/音视频/定位类字段（红线：不引入 L4）；
 *   2. **不回显原文**——拒绝时只给字段名，绝不把入参值拼进错误信息（防日志泄漏）。
 */
export function checkFeaturePayload(payload: Record<string, unknown>): FeaturePayloadCheck {
  for (const key of Object.keys(payload)) {
    const k = key.toLowerCase();
    if (FORBIDDEN_FEATURE_KEYS.includes(k)) {
      return { ok: false, rejectedField: key };
    }
  }
  return { ok: true, rejectedField: null };
}

/** 子女可见范围档位的判定（老人授权范围内的才可见）；NONE 永不可见 */
export function isScopeVisibleToFamily(
  granted: activity_consent_scope_level,
  required: activity_consent_scope_level,
): boolean {
  const order: activity_consent_scope_level[] = [
    activity_consent_scope_level.NONE,
    activity_consent_scope_level.ALERT_ONLY,
    activity_consent_scope_level.DAILY_SUMMARY,
    activity_consent_scope_level.TREND,
  ];
  return (
    order.indexOf(granted) >= order.indexOf(required)
    && granted !== activity_consent_scope_level.NONE
  );
}