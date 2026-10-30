// ============================================================================
// 邻伴 · 信用分规则（架构 §8.3：加减项、限流/冻结阈值）
// ----------------------------------------------------------------------------
// 规则（§8.3）：
//   好评 +1 / 差评 −3 / 取消 −2 / 私聊违规 −5 / 飞单坐实 −20 并清退。
// 阈值：
//   score < 40（credit_freeze_threshold）→ 冻结接单；
//   40 ≤ score < 60（credit_limit_threshold）→ 限流派单；
//   score ≥ 60 → 正常派单。
// 边界：满分 100 封顶，下限 0 触底（clamp）。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  CREDIT_FREEZE_THRESHOLD_DEFAULT,
  CREDIT_FULL_SCORE,
  CREDIT_LIMIT_THRESHOLD_DEFAULT,
  CREDIT_MIN_SCORE,
  CREDIT_RULES,
} from '@linban/shared';
import type { credit_log_type } from '@linban/shared';

/** 信用分变更结果 */
export interface CreditChangeResult {
  before: number;
  after: number;
  /** 实际生效的变更量（clamp 后可能与输入不同） */
  change: number;
  /** 变更后是否触发限流派单 */
  limited: boolean;
  /** 变更后是否触发冻结接单 */
  frozen: boolean;
}

/** 阈值参数（默认取架构常量，service 层可传 system_configs 热值） */
export interface CreditThresholds {
  limit: number;
  freeze: number;
}

export const CREDIT_THRESHOLDS_DEFAULT: CreditThresholds = {
  limit: CREDIT_LIMIT_THRESHOLD_DEFAULT,
  freeze: CREDIT_FREEZE_THRESHOLD_DEFAULT,
};

/** 取某事由的固定分值（MANUAL/SYSTEM 无固定值，返回 null 由操作方输入） */
export function fixedDelta(type: credit_log_type): number | null {
  switch (type) {
    case 'GOOD_REVIEW':
      return CREDIT_RULES.GOOD_REVIEW;
    case 'BAD_REVIEW':
      return CREDIT_RULES.BAD_REVIEW;
    case 'CANCEL':
      return CREDIT_RULES.CANCEL;
    case 'IM_VIOLATION':
      return CREDIT_RULES.IM_VIOLATION;
    case 'FLY_ORDER':
      return CREDIT_RULES.FLY_ORDER;
    default:
      return null; // MANUAL / SYSTEM
  }
}

/** 分值区间：单次手工调整 |change| ≤ 20（防误操作，服务层再校） */
export const MANUAL_DELTA_MAX = 20;

/**
 * 应用一次信用分变更（纯函数）。
 * @param before 当前分
 * @param delta 变更量（正加负减）
 * @param thresholds 限流/冻结阈值（默认 60/40）
 */
export function applyCreditChange(
  before: number,
  delta: number,
  thresholds: CreditThresholds = CREDIT_THRESHOLDS_DEFAULT,
): CreditChangeResult {
  if (!Number.isInteger(before) || before < CREDIT_MIN_SCORE || before > CREDIT_FULL_SCORE) {
    throw new AppError(10001, `信用分初值非法: ${before}`, { before });
  }
  if (!Number.isInteger(delta)) {
    throw new AppError(10001, `信用分变更量必须为整数: ${delta}`, { delta });
  }
  if (before + delta < CREDIT_MIN_SCORE || before + delta > CREDIT_FULL_SCORE) {
    throw new AppError(10001, `信用分变更后越界 [${CREDIT_MIN_SCORE}, ${CREDIT_FULL_SCORE}]: ${before} + ${delta}`, {
      before,
      delta,
    });
  }

  const after = before + delta;
  return {
    before,
    after,
    change: after - before,
    limited: after < thresholds.limit,
    frozen: after < thresholds.freeze,
  };
}

/**
 * 便捷版本：按事由应用固定分值（MANUAL/SYSTEM 抛错——分值必须显式输入，
 * 杜绝「系统原因」悄悄改分，审计可回放）。
 */
export function applyCreditChangeByType(
  before: number,
  type: credit_log_type,
  thresholds: CreditThresholds = CREDIT_THRESHOLDS_DEFAULT,
): CreditChangeResult {
  const delta = fixedDelta(type);
  if (delta === null) {
    throw new AppError(10001, `事由 ${type} 无固定分值，须显式传入变更量`);
  }
  return applyCreditChange(before, delta, thresholds);
}

/** 是否需要限流派单（不含冻结） */
export function isLimited(score: number, thresholds: CreditThresholds = CREDIT_THRESHOLDS_DEFAULT): boolean {
  return score < thresholds.limit && score >= thresholds.freeze;
}

/** 是否冻结接单 */
export function isFrozen(score: number, thresholds: CreditThresholds = CREDIT_THRESHOLDS_DEFAULT): boolean {
  return score < thresholds.freeze;
}

/** 飞单坐实 → 必须清退（架构 §8.3「−20 并清退」） */
export function requiresBan(type: credit_log_type): boolean {
  return type === 'FLY_ORDER';
}

/** 校验信用分初值合法（0–100 整数） */
export function assertValidScore(score: number): void {
  if (!Number.isInteger(score) || score < CREDIT_MIN_SCORE || score > CREDIT_FULL_SCORE) {
    throw new AppError(10001, `信用分非法: ${score}（需 ${CREDIT_MIN_SCORE}–${CREDIT_FULL_SCORE} 整数）`, { score });
  }
}
