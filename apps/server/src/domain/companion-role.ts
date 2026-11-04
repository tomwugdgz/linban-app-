// ============================================================================
// 邻伴 · 供给角色领域规则（domain 层纯函数，零 IO，架构 §15.4 / §15.5）
// ----------------------------------------------------------------------------
// 为什么单独成层而不塞进派单/结算 service：§15.4 的「结算隔离」与 §15.5 的
// 「角色化派单」共用同一份角色判定口径。把判定收敛到纯函数，service 只做
// 「取数 + 调用」，避免同一条规则在入驻、支付、派单各写一遍——本轮两个预留
// 角色尚不可创建，判定门闩是纵深防御，将来开放时漏改一处就会污染分账流水。
// 跨端常量（白名单 / 结算模式 / 中文标签）一律取 @linban/shared，服务端不另立
// 一份，防止三端口径漂移（§15.4）。
// ============================================================================

import {
  ACTIVITY_DISPATCH_BAND_SIZE,
  ACTIVITY_DISPATCH_SCORE_CAP,
  AppError,
  OPEN_COMPANION_ROLES,
  ROLE_SETTLEMENT_MODE,
} from '@linban/shared';
import type { companion_role, SettlementMode } from '@linban/shared';

/**
 * 真实货币流结算模式（§15.4 表：HOURLY_PAID / PROFESSIONAL_PAID 进分账）。
 * 为什么用显式白名单而不是「排除两个非货币值」：结算隔离要求「非货币角色绝不进
 * 分账」必须是显式断言；若靠默认/排除分支，将来新增第三种非货币模式时会被默认
 * 判成「可进分账」，门闩就形同虚设（§15.4 单测硬要求）。
 * 为什么元素类型取 shared 的 SettlementMode 而非 string：若写成 string 集合，
 * 字面量拼错（如 'HOURLY_PIAD'）编译期不报错、运行期恒 false，门闩就成了
 * 「看着在守、其实没守」；复用共享联合类型能让拼错在编译期暴露。
 */
const MONETARY_SETTLEMENT_MODES: ReadonlySet<SettlementMode> = new Set<SettlementMode>([
  'HOURLY_PAID',
  'PROFESSIONAL_PAID',
]);

/** 角色是否本轮开放入驻（白名单取 shared，服务端不复制口径） */
export function isOpenCompanionRole(role: companion_role): boolean {
  return OPEN_COMPANION_ROLES.includes(role);
}

/**
 * 角色是否走真实货币流结算（取 shared 的「角色→结算模式」映射）。
 * 不复用 isOpenCompanionRole 推断：「是否开放」与「是否有货币流」是两个正交维度，
 * 未来可能开放一个非货币角色，届时结算隔离仍须独立成立（§15.4 两进两不进）。
 */
export function isMonetarySettlement(role: companion_role): boolean {
  // 直接传 SettlementMode，不用 String() 包一层退化成 string（会丢掉上面的类型保护）
  return MONETARY_SETTLEMENT_MODES.has(ROLE_SETTLEMENT_MODE[role]);
}

/** 是否可进入分账流水：必须同时「本轮开放」且「真实货币结算」 */
export function canEnterProfitSharing(role: companion_role): boolean {
  return isOpenCompanionRole(role) && isMonetarySettlement(role);
}

/**
 * 入驻前置断言：未开放角色明确拒绝 13016，绝不静默回落 SHARED_SON（§15.6）。
 * 把「字段格式错」(10001) 与「角色未开放」(13016) 分开，未来开放新角色只改
 * shared 白名单，不动 zod 契约。
 */
export function assertOpenCompanionRole(role: companion_role): void {
  if (!isOpenCompanionRole(role)) {
    throw new AppError(13016, `供给角色 ${role} 暂未开放入驻`, { role });
  }
}

/**
 * 分账前置断言：非货币结算角色绝不写 profit_sharing_records（§15.4 纵深防御）。
 * 本轮两个非货币角色根本无法创建，这道门是防「未来开放时误接分账链路」。
 */
export function assertSharingEligible(role: companion_role): void {
  if (!isMonetarySettlement(role)) {
    throw new AppError(13017, `供给角色 ${role} 的结算方式不参与分账`, { role });
  }
}

// ---------------------------------------------------------------------------
// 角色化派单（§15.5：不得破坏既有出口）
// ---------------------------------------------------------------------------

/**
 * 角色命中加成分（0–100 同量纲，非权重；§15.5 明确不写入 DISPATCH_WEIGHTS）。
 * 为什么取 8 而非初版 12：§15.12 C10 裁定——档宽是 10，加成若 ≥ 档宽，同档内
 * 命中角色会恒定压过任何基础分差异，与 PRD「同等条件下优先」不符；取 8（≤10）
 * 后，基础分差 9 分仍能压过加成，角色只在同一水平线上起优先作用。
 */
export const ROLE_MATCH_BONUS = 8;

/** 命中偏好角色时的加分；未指定偏好一律 0，保证既有排序零回归 */
export function roleMatchBonus(
  candidateRole: companion_role,
  preferredRole?: companion_role | null,
): number {
  if (!preferredRole) return 0;
  return candidateRole === preferredRole ? ROLE_MATCH_BONUS : 0;
}

/**
 * 角色化派单排序器（与 activity.ts 的 rankByActivity 同层、同范式）。
 *
 * 为什么独立于 rankDispatchCandidates：§15.5 硬约束既有出口签名与行为完全不动、
 * DISPATCH_WEIGHTS 总和仍为 100，角色偏好只能由独立排序器承担。
 *
 * 「分档 + 组内加成、加成不得跨档」（§13.12 Q10）如何落地：
 *   · 档位 band 只由 baseScore 决定（floor(base / 档粒度)），与加成无关；
 *   · finalScore = base + 角色命中加成，仅供**同档内**比较；
 *   · 排序主键是 band，故低档候选即便 +8 也绝不会跃升到高档之前。
 * 档粒度/分上限复用活动加成的 shared 常量，是为了两个独立排序器对「档」的
 * 边界定义一致（若将来叠加使用，不会出现两套分档口径）。
 *
 * 未指定 preferredRole 时直接原序返回，连分档排序都不做——这是「排序结果与改造前
 * 逐字一致」的严格保证，不依赖调用方恰好已按分档排好序，既有单测零回归。
 */
export function rankByCompanionRole<T extends { role: companion_role }>(
  items: readonly T[],
  preferredRole?: companion_role | null,
  baseScoreOf?: (item: T) => number,
): T[] {
  if (!preferredRole) return [...items];

  return items
    .map((item, idx) => {
      const base = baseScoreOf
        ? Math.max(0, Math.min(ACTIVITY_DISPATCH_SCORE_CAP, baseScoreOf(item)))
        : 0;
      const band = Math.floor(base / ACTIVITY_DISPATCH_BAND_SIZE);
      const finalScore = Math.min(
        base + roleMatchBonus(item.role, preferredRole),
        ACTIVITY_DISPATCH_SCORE_CAP,
      );
      return { item, band, finalScore, idx };
    })
    .sort((a, b) => b.band - a.band || b.finalScore - a.finalScore || a.idx - b.idx)
    .map((x) => x.item);
}
