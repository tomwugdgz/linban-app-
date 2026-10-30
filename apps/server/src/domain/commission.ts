// ============================================================================
// 邻伴 · 抽成计算（架构 §7.3：以「分」为单位的整数运算，杜绝浮点）
// ----------------------------------------------------------------------------
// 公式：
//   平台抽成  = round(订单实收 × 抽成比例)     —— 四舍五入到「分」
//   陪聊员应收 = 订单实收 − 平台抽成
//   抽成比例以基点（bp）整数快照：500bp = 5%，后续调配置不影响历史单
//   （profit_sharing_records.commission_rate_bp，审计可回放）。
//   分成基数不含优惠券/时长卡抵扣部分（营销预算由平台承担）：
//   订单实收 = 原价 − coupon_deduct_fen − gift_card_deduct_fen。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  COMMISSION_RATE_DEFAULT_BP,
  COMMISSION_RATE_MAX_BP,
  COMMISSION_RATE_MIN_BP,
  BP_PER_PERCENT,
  SERVICE_DURATION_MAX_MINUTES,
  SERVICE_DURATION_MIN_MINUTES,
  SERVICE_DURATION_STEP_MINUTES,
} from '@linban/shared';

/** 抽成计算结果（全部为 BigInt 分，落库前由 service 层直接透传） */
export interface CommissionResult {
  /** 订单实收（分）—— 分成基数 */
  orderAmountFen: bigint;
  /** 抽成比例快照（基点，500 = 5%） */
  commissionRateBp: number;
  /** 平台抽成（分）= round(实收 × bp / 10000) */
  platformCommissionFen: bigint;
  /** 陪聊员应收（分）= 实收 − 平台抽成 */
  companionIncomeFen: bigint;
}

/** 校验抽成比例是否在允许区间（架构：5%–10%，即 500–1000bp） */
export function assertRateBp(bp: number): void {
  if (!Number.isInteger(bp) || bp < COMMISSION_RATE_MIN_BP || bp > COMMISSION_RATE_MAX_BP) {
    throw new AppError(10001, `抽成比例基点 ${bp} 超出允许区间 [${COMMISSION_RATE_MIN_BP}, ${COMMISSION_RATE_MAX_BP}]`, {
      bp,
      minBp: COMMISSION_RATE_MIN_BP,
      maxBp: COMMISSION_RATE_MAX_BP,
    });
  }
}

/**
 * 计算一次分账拆分（纯函数，BigInt 整数运算）。
 * @param orderAmountFen 订单实收（分，BigInt 原生）
 * @param commissionRateBp 抽成比例快照（基点）
 */
export function computeCommission(orderAmountFen: bigint, commissionRateBp: number): CommissionResult {
  if (orderAmountFen < 0n) {
    throw new AppError(10001, '订单实收不能为负', { orderAmountFen: orderAmountFen.toString() });
  }
  assertRateBp(commissionRateBp);

  // round(x) = floor(x + 0.5)：BigInt 下加半个除数实现四舍五入
  // platform = (amount * bp + 5000) / 10000
  const platformCommissionFen = (orderAmountFen * BigInt(commissionRateBp) + 5000n) / 10000n;
  const companionIncomeFen = orderAmountFen - platformCommissionFen;

  return {
    orderAmountFen,
    commissionRateBp,
    platformCommissionFen,
    companionIncomeFen,
  };
}

/**
 * 解析抽成配置为基点（bp）。
 * system_configs.commission_rate 以 DECIMAL 字符串存储（如 "0.05"），
 * 换算：bp = round(rate * 10000)。MVP 为单比例；阶梯规则预留：
 * 后续可按订单金额区间返回不同 bp（快照仍落单条记录）。
 */
export function resolveCommissionRateBp(rateStr: string, orderAmountFen?: bigint): number {
  const rate = Number(rateStr);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) {
    throw new AppError(90005, `commission_rate 配置非法: "${rateStr}"`, { rateStr });
  }
  // TODO(阶梯规则)：MVP 单比例。阶梯配置落 system_configs 后在此按 orderAmountFen 分支。
  void orderAmountFen;
  const bp = Math.round(rate * BP_PER_PERCENT * BP_PER_PERCENT);
  assertRateBp(bp);
  return bp;
}

/** bp → 比例（用于展示，如 500 → 0.05） */
export function bpToRate(bp: number): number {
  return bp / (BP_PER_PERCENT * BP_PER_PERCENT);
}

/** 订单计价（架构 §6.1：时长按小时档，时薪 200–300 元）：
 *  原价 = round(时长分钟 × 时薪 / 60)；实收 = max(0, 原价 − 券抵扣 − 卡抵扣)。
 * @returns 原价/抵扣/实收（分，BigInt） */
export function calcOrderAmount(input: {
  durationMinutes: number;
  hourlyRateFen: bigint;
  couponDeductFen?: bigint;
  giftCardDeductFen?: bigint;
}): {
  originalAmountFen: bigint;
  couponDeductFen: bigint;
  giftCardDeductFen: bigint;
  totalAmountFen: bigint;
} {
  const { durationMinutes, hourlyRateFen } = input;
  const couponDeductFen = input.couponDeductFen ?? 0n;
  const giftCardDeductFen = input.giftCardDeductFen ?? 0n;

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < SERVICE_DURATION_MIN_MINUTES ||
    durationMinutes > SERVICE_DURATION_MAX_MINUTES ||
    durationMinutes % SERVICE_DURATION_STEP_MINUTES !== 0
  ) {
    throw new AppError(10001, `服务时长 ${durationMinutes} 分钟不合法（需 ${SERVICE_DURATION_MIN_MINUTES}–${SERVICE_DURATION_MAX_MINUTES} 分钟且为 ${SERVICE_DURATION_STEP_MINUTES} 的倍数）`, {
      durationMinutes,
    });
  }
  if (hourlyRateFen <= 0n) {
    throw new AppError(10001, '时薪必须大于 0', { hourlyRateFen: hourlyRateFen.toString() });
  }
  if (couponDeductFen < 0n || giftCardDeductFen < 0n) {
    throw new AppError(10001, '抵扣金额不能为负');
  }

  // 原价 = round(duration * rate / 60)（四舍五入到分）
  const originalAmountFen =
    (BigInt(durationMinutes) * hourlyRateFen + 30n) / 60n;

  const deduct = couponDeductFen + giftCardDeductFen;
  // 抵扣不得超过原价（服务层用券前已校验门槛，此处兜底）
  const totalAmountFen = deduct >= originalAmountFen ? 0n : originalAmountFen - deduct;

  return { originalAmountFen, couponDeductFen, giftCardDeductFen, totalAmountFen };
}

/** 默认抽成基点（system_configs 缺失时的回落值） */
export function defaultCommissionRateBp(): number {
  return COMMISSION_RATE_DEFAULT_BP;
}
