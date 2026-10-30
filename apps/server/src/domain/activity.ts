// ============================================================================
// 邻伴 · 健康活动感知 · domain 纯函数（架构 §13.1–§13.5/§13.11、PRD MODULE-ACTIVITY-SENSE.md）
// ----------------------------------------------------------------------------
// 本文件是活动感知的「唯一逻辑副本」：状态分级、置信度、交叉验证、告警抑制、
// 派单加成、引流触发器全部在此，service 层只做取数与副作用，不重复实现规则。
//
// 隐私红线落成代码机制（不是注释，是判定分支）：
//   · UNKNOWN 优先于一切猜测——探针离线 / 信号超 TTL / 窗口过短 → 强制 UNKNOWN，
//     不得用过期数据"假装确定"；
//   · 单通道不得直接输出健康结论——单通道置信度硬上限 0.6，且紧急告警强制
//     双通道交叉（crossVerifySatisfied 默认 required=true，单通道一律 false）；
//   · 一切阈值走入参（默认取 §13.11 配置口径），便于后台热调与单测边界断言。
//
// Q10 定稿口径：派单为「加分数」而非乘数——LOW +5 / STILL +10，同档内微调，
// 不得跨档；服务半径硬约束不因加成放宽。
// ============================================================================

import {
  activity_bonus_reason,
  activity_status,
  ACTIVITY_DISPATCH_BAND_SIZE,
  ACTIVITY_DISPATCH_SCORE_CAP,
} from '@linban/shared';

// ---------------------------------------------------------------------------
// 1. 活动状态五级分级
// ---------------------------------------------------------------------------

/** 分级阈值（PRD §3 口径；可被后台配置覆盖，故默认值做入参） */
export const ACTIVITY_GRADE_THRESHOLDS = {
  /** 活跃占比下限（activeMinutes / windowMinutes ≥ 此值 → ACTIVE） */
  activeRatioHigh: 0.6,
  /** 低活跃占比上限（< 此值且非久静 → LOW） */
  activeRatioLow: 0.15,
  /** 久静：窗口内活跃分钟上限 */
  stillActiveMinutesMax: 2,
  /** 久静：窗口内网络切换次数上限（频繁切换 = 人在活动） */
  stillSwitchCountMax: 1,
  /** 有效窗口最短时长（分钟），不足则数据不足 → UNKNOWN */
  minWindowMinutes: 5,
  /** 活跃判定：活动计数下限（步数/加速度计数，无传感器则该条不参与） */
  activeCountHigh: 60,
  /** 久静佐证：活动计数上限（低于此值视为"几乎无运动"） */
  activeCountStillMax: 5,
} as const;

/** 依据码（explain_code）：可审计、可回放，落 activity_daily_summary / health_alerts */
export const ACTIVITY_EXPLAIN = {
  PROBE_OFFLINE: 'PROBE_OFFLINE',
  SIGNAL_EXPIRED: 'SIGNAL_EXPIRED',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  AWAY_CONFIRMED: 'AWAY_CONFIRMED',
  ACTIVE_HIGH: 'ACTIVE_HIGH',
  STILL_NO_MOTION: 'STILL_NO_MOTION',
  LOW_ACTIVITY: 'LOW_ACTIVITY',
} as const;
export type ActivityExplain = (typeof ACTIVITY_EXPLAIN)[keyof typeof ACTIVITY_EXPLAIN];

/** 采集窗口特征向量（只允许特征，禁止原始波形 / CSI——PRD 红线③） */
export interface ActivityWindowStats {
  /** 采集窗口时长（分钟） */
  windowMinutes: number;
  /** 窗口内活跃时长（分钟） */
  activeMinutes: number;
  /** 网络切换频次（次/窗口） */
  networkSwitchCount: number;
  /** Wi-Fi 连接稳定性 0–1 */
  connectionStability: number;
  /** 步数或加速度活动计数（无传感器则 null，不参与判定） */
  activityCount?: number | null;
  /** 是否在已知家庭 BSSID（服务端 HMAC 比对结论，端上不可传原文） */
  atHomeBssid?: boolean | null;
}

export interface ClassifyActivityInput {
  stats: ActivityWindowStats;
  /** 最后一次有效信号距 now 的秒数（新鲜度） */
  freshnessSec: number;
  /** 探针在线状态；false → UNKNOWN */
  probeOnline: boolean;
  /** 信号有效期（秒，activity_signal_ttl=21600） */
  signalTtlSec: number;
  /** 阈值覆盖（后台热调；as const 的字面量类型会挡住热调值，故显式放宽为 number） */
  thresholds?: { [K in keyof typeof ACTIVITY_GRADE_THRESHOLDS]?: number };
}

export interface ClassifyActivityResult {
  status: activity_status;
  /** 活跃占比（0–1），供日聚合与引流触发器复用 */
  activeRatio: number;
  explainCode: ActivityExplain;
  freshnessSec: number;
}

/**
 * 活动状态分级（纯函数）。
 * 判定顺序即优先级：离线 → 信号过期 → 数据不足 → 离家 → 活跃 → 久静 → 低活跃。
 * 注意：本函数不输出置信度，置信度统一由 computeConfidence 计算（避免两处口径漂移）。
 */
export function classifyActivityStatus(input: ClassifyActivityInput): ClassifyActivityResult {
  const t = { ...ACTIVITY_GRADE_THRESHOLDS, ...input.thresholds };
  const s = input.stats;
  const unknown = (explainCode: ActivityExplain): ClassifyActivityResult => ({
    status: 'UNKNOWN',
    activeRatio: 0,
    explainCode,
    freshnessSec: input.freshnessSec,
  });

  // 红线：探针离线 → 数据不可信，禁止猜测
  if (!input.probeOnline) return unknown(ACTIVITY_EXPLAIN.PROBE_OFFLINE);
  // 红线：数据陈旧超 TTL → 回落 UNKNOWN（§13.3）
  if (input.freshnessSec > input.signalTtlSec) return unknown(ACTIVITY_EXPLAIN.SIGNAL_EXPIRED);
  // 数据不足：窗口过短或特征非法
  if (s.windowMinutes < t.minWindowMinutes || s.activeMinutes < 0 || s.windowMinutes <= 0) {
    return unknown(ACTIVITY_EXPLAIN.INSUFFICIENT_DATA);
  }

  const activeRatio = s.activeMinutes / s.windowMinutes;
  const activityCount = s.activityCount ?? null;

  // 明确离家（BSSID 不匹配）：AWAY
  if (s.atHomeBssid === false) {
    return { status: 'AWAY', activeRatio, explainCode: ACTIVITY_EXPLAIN.AWAY_CONFIRMED, freshnessSec: input.freshnessSec };
  }

  // 活跃：活跃占比高，或活动计数明确偏高
  const highCount = activityCount !== null && activityCount >= Math.max(t.activeCountHigh, s.windowMinutes * 2);
  if (activeRatio >= t.activeRatioHigh || highCount) {
    return { status: 'ACTIVE', activeRatio, explainCode: ACTIVITY_EXPLAIN.ACTIVE_HIGH, freshnessSec: input.freshnessSec };
  }

  // 久静：几乎无活动且网络稳定（不频繁切换）
  if (s.activeMinutes <= t.stillActiveMinutesMax && s.networkSwitchCount <= t.stillSwitchCountMax) {
    return { status: 'STILL', activeRatio, explainCode: ACTIVITY_EXPLAIN.STILL_NO_MOTION, freshnessSec: input.freshnessSec };
  }

  // 低活跃（中间带亦归LOW，保守：宁少判活跃）
  return { status: 'LOW', activeRatio, explainCode: ACTIVITY_EXPLAIN.LOW_ACTIVITY, freshnessSec: input.freshnessSec };
}

// ---------------------------------------------------------------------------
// 2. 置信度计算（新鲜度衰减 + 通道缺失降级 + 交叉验证加权）
// ---------------------------------------------------------------------------

/** 置信度口径常量（§13.3） */
export const CONFIDENCE_RULES = {
  /** 单通道基础值（同时是单通道硬上限——单通道不得出健康结论） */
  singleChannelBase: 0.6,
  /** 单通道硬上限 */
  singleChannelCap: 0.6,
  /** 双通道（未交叉验证）基础值 */
  dualChannelBase: 0.85,
  /** 双通道交叉验证加权因子 */
  crossVerifyFactor: 1.3,
  /** 交叉验证后绝对上限（不允许"完全确定"的健康结论） */
  cap: 0.95,
  /** 数据陈旧衰减：线性，最低降至 0.5 倍 */
  staleFloor: 0.5,
} as const;

export interface ComputeConfidenceInput {
  /** 最后一次有效信号距 now 的秒数 */
  freshnessSec: number;
  /** 信号有效期（秒，activity_signal_ttl） */
  signalTtlSec: number;
  /** 当前有效通道数（0 / 1 / 2） */
  channelCount: number;
  /** 是否已通过双通道交叉验证（步数/订单/IM 等交叉源命中） */
  crossVerified?: boolean;
}

/**
 * 状态置信度 0–1（纯函数）。
 * 规则（§13.3）：
 *   1. 通道缺失降级：0 通道 → 0；1 通道 → 0.6（封顶 0.6）；2 通道 → 0.85；
 *   2. 新鲜度衰减：新鲜度线性衰减至 0.5 倍（超 TTL 直接 0，即 UNKNOWN）；
 *   3. 交叉验证加权：双通道且交叉命中 → ×1.3；
 *   4. 最终封顶 0.95；单通道无论如何不得超 0.6。
 */
export function computeConfidence(input: ComputeConfidenceInput): number {
  const r = CONFIDENCE_RULES;
  const { freshnessSec, signalTtlSec, channelCount, crossVerified = false } = input;

  // 超 TTL → 数据不可用，置信度为 0（调用方应落 UNKNOWN）
  if (freshnessSec > signalTtlSec || freshnessSec < 0) return 0;
  if (channelCount <= 0) return 0;

  // 通道缺失降级
  const base = channelCount >= 2 ? r.dualChannelBase : r.singleChannelBase;

  // 新鲜度衰减：0→1.0 倍，TTL→0.5 倍（单调不增）
  const ratio = Math.max(0, Math.min(1, freshnessSec / signalTtlSec));
  const decay = 1 - (1 - r.staleFloor) * ratio;

  let conf = base * decay;

  // 交叉验证加权：仅双通道有效（单通道自称交叉不成立）
  if (channelCount >= 2 && crossVerified) conf *= r.crossVerifyFactor;

  conf = Math.min(conf, r.cap);
  // 红线：单通道硬上限 0.6
  if (channelCount < 2) conf = Math.min(conf, r.singleChannelCap);
  return Math.round(conf * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// 3. 双通道交叉验证判定（紧急告警强制双通道）
// ---------------------------------------------------------------------------

export interface CrossVerifyInput {
  /** 通道 A（APP Wi-Fi 心跳）本窗口是否有效 */
  channelAValid: boolean;
  /** 通道 B（网关特征）本窗口是否有效 */
  channelBValid: boolean;
  /** 交叉源（步数/订单/IM 等第三方佐证）是否命中 */
  crossSourceHit?: boolean;
  /** activity_cross_verify_required（默认 true，建议锁死；置false 仅灰度用） */
  required?: boolean;
}

/**
 * 交叉验证是否满足（纯函数）。
 * required=true（默认，生产锁死）时：必须 A、B 双通道均有效且交叉源命中；
 * 任一通道无效 → 一律false，调用方据此把 URGENT 降级为 WARN 等人工确认。
 */
export function crossVerifySatisfied(input: CrossVerifyInput): boolean {
  const required = input.required ?? true;
  const bothValid = input.channelAValid && input.channelBValid;
  if (!required) {
    // 灰度口径：单通道有效即可放行，但仍不得越级为紧急结论（由调用方限级）
    return bothValid || input.channelAValid || input.channelBValid || input.crossSourceHit === true;
  }
  return bothValid && input.crossSourceHit === true;
}

// ---------------------------------------------------------------------------
// 4. 告警抑制窗口（防告警疲劳）
// ---------------------------------------------------------------------------

export interface SuppressAlertInput {
  /** 同类（同elder + 同 alert_type）上次告警时间；null = 从未告警 */
  lastAlertAt: Date | null;
  /** 抑制窗口（分钟，activity_alert_suppress_min=180） */
  suppressWindowMin: number;
  /** 判定时刻 */
  now: Date;
}

/**
 * 同类告警是否应被抑制（纯函数）。
 * 边界口径：距上次告警**恰好等于**窗口 → 仍抑制（闭区间，防抖动）；
 * 窗口内不重复推送；已 RESOLVED/DISMISSED 的终态由调用方以lastAlertAt=NULL 表达。
 */
export function shouldSuppressAlert(input: SuppressAlertInput): boolean {
  if (!input.lastAlertAt) return false;
  if (input.suppressWindowMin <= 0) return false;
  const elapsedMin = (input.now.getTime() - input.lastAlertAt.getTime()) / 60000;
  if (elapsedMin < 0) return true; // 时钟回拨：保守抑制，不重复轰炸
  return elapsedMin <= input.suppressWindowMin;
}

// ---------------------------------------------------------------------------
// 5. 派单活动加成（Q10 定稿：加分数 + 同档微调 + 不得跨档）
// ---------------------------------------------------------------------------

/**
 * 加成原因码（落 orders.dispatch_reason_code，供陪聊员申诉与风控复核）。
 * 唯一定义在 @linban/shared（activity_bonus_reason）——三端共用同一事实源，
 * 此处仅做再导出，保持历史 import 路径不破。
 */
export const ACTIVITY_BONUS_REASON = activity_bonus_reason;
export type ActivityBonusReason = activity_bonus_reason;

/** 派单加成默认口径（system_configs: activity_dispatch_bonus_low / _still） */
export const DISPATCH_BONUS_DEFAULTS = {
  bonusLow: 5,
  bonusStill: 10,
  /** 展示与落库分上限（硬顶 100，与 shared ACTIVITY_DISPATCH_SCORE_CAP 同值） */
  cap: ACTIVITY_DISPATCH_SCORE_CAP,
  /** 分档粒度：档 = floor(baseScore / bandSize)，0–100 共 11 档 */
  bandSize: ACTIVITY_DISPATCH_BAND_SIZE,
} as const;

export interface ComputeDispatchWeightInput {
  /** 基础分（scoreDispatchCandidate 的结果，0–100） */
  baseScore: number;
  /** 老人当前活动状态 */
  activityStatus: activity_status;
  /** LOW 加成分（默认 5） */
  bonusLow?: number;
  /** STILL 加成分（默认 10） */
  bonusStill?: number;
  /** 展示/落库分上限（默认 100） */
  cap?: number;
}

export interface DispatchWeightResult {
  baseScore: number;
  activityBonus: number;
  /** 展示与落库分= min(base + bonus, cap) */
  finalScore: number;
  /** 档位归属：始终按 baseScore 定档，加成不改变档（杜绝跨档抢单） */
  band: number;
  bonusReason: ActivityBonusReason;
}

/** 计算某候选因老人活动状态获得的加成（纯函数，ACTIVE/AWAY/UNKNOWN 一律 0） */
export function computeDispatchWeight(input: ComputeDispatchWeightInput): DispatchWeightResult {
  const bonusLow = input.bonusLow ?? DISPATCH_BONUS_DEFAULTS.bonusLow;
  const bonusStill = input.bonusStill ?? DISPATCH_BONUS_DEFAULTS.bonusStill;
  const cap = input.cap ?? DISPATCH_BONUS_DEFAULTS.cap;
  const base = Math.max(0, Math.min(cap, input.baseScore));

  let bonus = 0;
  let reason: ActivityBonusReason = ACTIVITY_BONUS_REASON.NONE;
  if (input.activityStatus === 'LOW') {
    bonus = bonusLow;
    reason = ACTIVITY_BONUS_REASON.ACTIVITY_LOW;
  } else if (input.activityStatus === 'STILL') {
    bonus = bonusStill;
    reason = ACTIVITY_BONUS_REASON.ACTIVITY_STILL;
  }

  const finalScore = Math.min(base + bonus, cap);
  return {
    baseScore: Math.round(base * 100) / 100,
    activityBonus: bonus,
    finalScore: Math.round(finalScore * 100) / 100,
    band: Math.floor(base / DISPATCH_BONUS_DEFAULTS.bandSize),
    bonusReason: reason,
  };
}

/** 待排序候选（派单层注入；activityStatus 由 IO 层从activity_daily_summary 取） */
export interface ActivityWeightedCandidate<T> {
  candidate: T;
  baseScore: number;
  activityStatus: activity_status;
  /** 是否在服务半径内；false → 硬约束排除，不参与同档比较 */
  withinRadius: boolean;
}

export interface RankByActivityOptions {
  bonusLow?: number;
  bonusStill?: number;
  cap?: number;
}

/**
 * 派单排序：先按 baseScore 分档，**组内**按(baseScore + activityBonus) 降序。
 * · 跨档不跃升——档位归属只看 baseScore；
 * · 服务半径外候选直接出局，不因加成放宽（Q10 硬约束）；
 * · 同分按 candidate 原顺序稳定排序。
 */
export function rankByActivity<T>(
  items: readonly ActivityWeightedCandidate<T>[],
  opts: RankByActivityOptions = {},
): Array<{ candidate: T; weight: DispatchWeightResult }> {
  return items
    .filter((x) => x.withinRadius)
    .map((x, i) => ({
      candidate: x.candidate,
      weight: computeDispatchWeight({
        baseScore: x.baseScore,
        activityStatus: x.activityStatus,
        bonusLow: opts.bonusLow,
        bonusStill: opts.bonusStill,
        cap: opts.cap,
      }),
      idx: i,
    }))
    .sort((a, b) => b.weight.band - a.weight.band || b.weight.finalScore - a.weight.finalScore || a.idx - b.idx)
    .map(({ candidate, weight }) => ({ candidate, weight }));
}

// ---------------------------------------------------------------------------
// 6. 引流触发器（PRD §4漏斗：活跃下降 / 连续低活跃 / 新装体验）
// ---------------------------------------------------------------------------

export const LEAD_TRIGGER = {
  /** 触发器①：活跃量下降超阈值 */
  ACTIVITY_DROP: 'ACTIVITY_DROP',
  /** 触发器②：连续 N 天低活跃 */
  LOW_TREND: 'LOW_TREND',
  /** 触发器③：新装体验 */
  NEWINSTALL_EXPERIENCE: 'NEWINSTALL_EXPERIENCE',
} as const;
export type LeadTrigger = (typeof LEAD_TRIGGER)[keyof typeof LEAD_TRIGGER];

/** 单日活动量（activity_daily_summary 的投影，纯数值不含任何原始特征） */
export interface DailyActivityPoint {
  /** 统计日期 yyyy-MM-dd */
  date: string;
  /** 当日活跃分钟数 */
  activeMinutes: number;
  /** 当日分级（用于连续低活跃判定） */
  status?: activity_status | null;
}

export interface DetectLeadTriggersInput {
  /** 按日期升序的日活动量序列（至少 2 天才可能判定下降） */
  series: readonly DailyActivityPoint[];
  /** 基线天数（取序列前 N 天均值作基线，默认与 windowDays 同值） */
  baselineDays?: number;
  /** 观察窗口天数（默认 activity_low_trend_window_days=3） */
  windowDays?: number;
  /** 下降阈值 %（默认 activity_drop_pct_threshold=30，**恰好等于不触发**） */
  dropPctThreshold?: number;
  /** 是否新装用户（用于触发器③） */
  isNewInstall?: boolean;
  /** 观察窗内的渠道活动（PRD：仅付费/已激活渠道才投放优惠） */
  newInstallChannelActive?: boolean;
}

export interface LeadTriggerHit {
  trigger: LeadTrigger;
  /** 原因说明（落activity_touchpoints 与后台看板，可审计） */
  reason: string;
  /** 量化依据 */
  metrics: Record<string, number>;
}

/**
 * 引流触发器判定（纯函数）。
 * 阈值口径：
 *   · 下降幅度 > dropPctThreshold 才触发（**恰好 30% 不触发**，30.1% 触发）；
 *   · 连续 windowDays 天 status ∈ {LOW, STILL} 触发②；
 *   · isNewInstall 且渠道已激活触发③（新装体验）。
 */
export function detectLeadTriggers(input: DetectLeadTriggersInput): LeadTriggerHit[] {
  const windowDays = input.windowDays ?? 3;
  const dropPct = input.dropPctThreshold ?? 30;
  const baselineDays = input.baselineDays ?? windowDays;
  const hits: LeadTriggerHit[] = [];

  // 触发器③：新装体验（注册即发券，故只看标记与渠道是否已激活）
  if (input.isNewInstall && input.newInstallChannelActive !== false) {
    hits.push({
      trigger: LEAD_TRIGGER.NEWINSTALL_EXPERIENCE,
      reason: '新装用户且渠道已激活，发放新装体验优惠（券 source=ACTIVITY_LEAD）',
      metrics: { windowDays },
    });
  }

  const series = input.series;
  const needDays = Math.max(baselineDays, windowDays);
  if (series.length < needDays) return hits;

  const mean = (arr: readonly DailyActivityPoint[]): number =>
    arr.length === 0 ? 0 : arr.reduce((a, p) => a + p.activeMinutes, 0) / arr.length;

  // 触发器①：观察窗均值相对基线均值的下降幅度
  const baseline = series.slice(0, baselineDays);
  const recent = series.slice(series.length - windowDays);
  const baselineMean = mean(baseline);
  const recentMean = mean(recent);
  // 严格大于才触发：恰好 30% 不触发
  if (baselineMean > 0 && (baselineMean - recentMean) / baselineMean * 100 > dropPct) {
    const dropPctActual = Math.round(((baselineMean - recentMean) / baselineMean) * 10000) / 100;
    hits.push({
      trigger: LEAD_TRIGGER.ACTIVITY_DROP,
      reason: `近${windowDays} 天活动量较基线下降 ${dropPctActual}%，超阈值 ${dropPct}%`,
      metrics: {
        baselineMean: Math.round(baselineMean * 100) / 100,
        recentMean: Math.round(recentMean * 100) / 100,
        dropPct: dropPctActual,
        threshold: dropPct,
      },
    });
  }

  // 触发器②：连续 windowDays 天低活跃（LOW/STILL）
  const tail = series.slice(series.length - windowDays);
  const allLow = tail.length === windowDays && tail.every((p) => p.status === 'LOW' || p.status === 'STILL');
  if (allLow) {
    hits.push({
      trigger: LEAD_TRIGGER.LOW_TREND,
      reason: `连续 ${windowDays} 天低活跃（LOW/STILL），触发关怀触达`,
      metrics: { windowDays, recentMean: Math.round(recentMean * 100) / 100 },
    });
  }

  return hits;
}

// ---------------------------------------------------------------------------
// 留存与有效期小工具（供 retention sweep / ingest 复用）
// ---------------------------------------------------------------------------

/** 信号是否已过留存清理时点（PRD 红线⑥：retained_until = window_end + 留存天数） */
export function shouldPurgeSignal(retainedUntil: Date, now: Date): boolean {
  return now.getTime() >= retainedUntil.getTime();
}

/** 信号是否已过有效期（超 TTL → 不得用于分级） */
export function isSignalExpired(freshnessSec: number, signalTtlSec: number): boolean {
  return freshnessSec > signalTtlSec;
}