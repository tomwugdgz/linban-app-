// ============================================================================
// 邻伴 · 派单打分（domain 层纯函数，架构 §6.1 2）
// ----------------------------------------------------------------------------
// 派单引擎候选筛选与加权打分：
//   候选过滤：ACTIVE + 信用分 ≥ 冻结阈值 + geohash 前缀命中 + 日程覆盖
//            + 时段未被占用（DB 侧）。
//   打分（Top N 推送）：就近（距离衰减）+ 标签匹配 + 信用分 + 等级。
//   权重为 MVP 经验值，后台可调（后续进 system_configs）。
// ============================================================================

import { CREDIT_FREEZE_THRESHOLD_DEFAULT } from '@linban/shared';

/** 派单候选（DB 投影） */
export interface DispatchCandidate {
  companionId: bigint;
  /** 与订单地址距离（米） */
  distanceM: number;
  /** 服务标签 */
  tags: string[] | null;
  /** 信用分 */
  creditScore: number;
  /** 等级 1–5 */
  level: number;
  /** 历史评分（0–5） */
  ratingAvg: number;
  /** 完成单量 */
  completedOrders: number;
  /** 时薪（分） */
  hourlyRateFen: bigint;
}

/** 派单查询条件 */
export interface DispatchQuery {
  /** 老人期望标签（画像 interests） */
  preferredTags?: string[] | null;
  /** 距离满分半径（米）：≤ 此距离得满分，超出衰减 */
  distanceFullM?: number;
  /** 距离衰减半衰（米）：每增加一个半衰距离分减半 */
  distanceHalfM?: number;
}

/** 打分权重（MVP 经验值；总和 100） */
export const DISPATCH_WEIGHTS = {
  distance: 40,
  tags: 20,
  credit: 20,
  level: 10,
  rating: 10,
} as const;

/** 候选硬性过滤（返回 false 的直接出局） */
export function candidateEligible(
  c: DispatchCandidate,
  opts: { creditFreezeThreshold?: number; maxHourlyRateFen?: bigint } = {},
): boolean {
  const freezeThreshold = opts.creditFreezeThreshold ?? CREDIT_FREEZE_THRESHOLD_DEFAULT;
  if (c.creditScore < freezeThreshold) return false; // 冻结线以下不派
  if (c.level < 1 || c.level > 5) return false;
  if (c.completedOrders < 0) return false;
  if (opts.maxHourlyRateFen !== undefined && c.hourlyRateFen > opts.maxHourlyRateFen) return false;
  return true;
}

/** 距离分（0–1）：≤ full 得 1，超出按半衰衰减 */
export function distanceScore(distanceM: number, fullM = 1000, halfM = 3000): number {
  if (distanceM <= fullM) return 1;
  // 指数衰减：每 halfM 减半
  const excess = distanceM - fullM;
  const decay = Math.pow(0.5, excess / halfM);
  return Math.max(0, Math.min(1, decay));
}

/** 标签分（0–1）：命中偏好标签比例 */
export function tagsScore(candidateTags: string[] | null, preferred: string[] | null): number {
  if (!preferred || preferred.length === 0) return 0.5; // 无偏好：中性分
  if (!candidateTags || candidateTags.length === 0) return 0;
  const set = new Set(candidateTags);
  const hits = preferred.filter((t) => set.has(t)).length;
  return hits / preferred.length;
}

/** 信用分（0–1）：分/100 */
export function creditScore(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}

/** 等级分（0–1）：(level−1)/4 */
export function levelScore(level: number): number {
  return Math.max(0, Math.min(1, (level - 1) / 4));
}

/** 评分分（0–1）：rating/5 */
export function ratingScore(ratingAvg: number): number {
  return Math.max(0, Math.min(1, ratingAvg / 5));
}

/** 综合打分（0–100） */
export function scoreDispatchCandidate(c: DispatchCandidate, q: DispatchQuery = {}): number {
  const w = DISPATCH_WEIGHTS;
  const score =
    w.distance * distanceScore(c.distanceM, q.distanceFullM, q.distanceHalfM) +
    w.tags * tagsScore(c.tags, q.preferredTags ?? null) +
    w.credit * creditScore(c.creditScore) +
    w.level * levelScore(c.level) +
    w.rating * ratingScore(c.ratingAvg);
  return Math.round(score * 100) / 100;
}

/** 过滤 + 打分 + 排序取 Top N（派单引擎主入口） */
export function rankDispatchCandidates(
  candidates: readonly DispatchCandidate[],
  q: DispatchQuery = {},
  topN = 5,
  opts: { creditFreezeThreshold?: number; maxHourlyRateFen?: bigint } = {},
): DispatchCandidate[] {
  return candidates
    .filter((c) => candidateEligible(c, opts))
    .map((c) => ({ c, s: scoreDispatchCandidate(c, q) }))
    .sort((a, b) => b.s - a.s || Number(a.c.companionId - b.c.companionId))
    .slice(0, topN)
    .map((x) => x.c);
}
