// ============================================================================
// 邻伴 · 券核销领域规则（domain 层，纯函数零 IO）
// ----------------------------------------------------------------------------
// 【为什么必须有 value_snapshot】
//
// `user_coupons` 原先只有 `coupon_id`、**没有面值快照**，核销时实时 JOIN
// `coupons` 模板读 `value`。后果：运营把 ¥50 的券改成 ¥100，**所有已领取但
// 未核销的券瞬间变成 ¥100** —— 用户无感知、平台直接资损，且不可逆。
//
// 所以后台 `PUT /admin/coupons/:id` 对 `claimed_count > 0` 的券改 `value`
// 一律回 10001（技术性不可协商，不是产品偏好）。
//
// 【本文件解决的是「加了快照列但还没落库」的过渡期问题】
//
// schema 已改（`user_coupons.value_snapshot Int?`）、迁移已落，但**存量
// `user_coupons` 行的value_snapshot 全是 NULL**。若此刻直接读快照，
// 存量券的抵扣金额会变成 null → 计算崩或抵扣 0 元。
// 故必须走双分支：
//
//   1. 有快照 → 用快照（面额已冻结，不受模板后续改动影响）
//   2. 无快照 → 回退读模板 value，**且必须打日志**
//
// 【回退分支的日志是这段代码最关键的部分】
//
// 它是「还有多少存量券没回填」的唯一可观测手段。没有它，回填做完了没有
// 永远查不出来，而漏掉的券会在用户核销那一刻才暴露 —— 那时已经资损了。
//统计口径必须是结构化的（userCouponId / couponId / type），
// 不能只打一句字符串，否则没法 grep 出「哪些券待回填」。
// ============================================================================

import { COUPON_STATUS } from '@linban/shared';
import type { coupon_type, user_coupon_status } from '@linban/shared';

/** 券核销计算的入参（只含必要字段，便于穷举测试） */
export interface CouponDeductInput {
  /** user_coupons.id —— 日志与幂等键要用 */
  userCouponId: bigint;
  /** user_coupons.coupon_id */
  couponId: bigint;
  /** coupons.type —— **决定 value 的量纲**，绝不能混用 */
  couponType: coupon_type;
  /** coupons.value —— 模板当前面额（回退分支才用） */
  templateValue: number;
  /**
   * user_coupons.value_snapshot —— 领取时冻结的面额。
   * `null` = 存量券未回填，走回退分支。
   */
  valueSnapshot: number | null;
  /** user_coupons.status */
  userCouponStatus: user_coupon_status;
  /** user_coupons.expired_at */
  expiredAt: Date | null;
  /** 券模板状态（模板被end 后存量券仍可用，见下方裁定） */
  templateStatus: string;
  /** 订单原价（分）——抵扣不得超过它 */
  orderOriginalFen: bigint;
  /** 业务日期（用于日志，不参与计算） */
  now: Date;
}

/** 核销计算结果 */
export interface CouponDeductResult {
  /** 是否可用于本单核销 */
  usable: boolean;
  /** 可抵扣金额（分）；不可用时为 0n */
  deductFen: bigint;
  /**
   * 面额来源：
   * - `SNAPSHOT` 有快照，面额已冻结
   * - `FALLBACK_TEMPLATE` 无快照，回退读模板 —— **需要回填**
   */
  valueSource: 'SNAPSHOT' | 'FALLBACK_TEMPLATE';
  /** 面额原值（未按订单上限截断前），单位随 couponType 变 */
  effectiveValue: number;
  /** 不可用原因（usable=false 时必有，供错误文案与埋点） */
  reason?:
    | 'COUPON_NOT_USABLE_STATUS'
    | 'COUPON_EXPIRED'
    | 'COUPON_TEMPLATE_ENDED'
    | 'COUPON_ZERO_VALUE'
    | 'COUPON_EXCEEDS_ORDER';
}

/**
 * 判定一张用户券能否用于本单，并算出抵扣金额。
 *
 * 【设计取舍：`ENDED` 模板的存量券仍可核销】
 * 主理人裁定（苏映棠转达）：结束投放后**存量已领券仍可正常核销用完**，
 * 不因结束而作废。理由是券已发给用户，单方面作废等于拿用户当祭品。
 * 所以 `templateStatus === 'ENDED'` **不阻断核销**，只影响「还能不能领新的」。
 *
 * 而 `DRAFT` 模板的券理论上不该存在（未投放无法领取），
 * 但若因数据错乱出现，**阻断** —— 不阻断等于白送。
 */
export function calcCouponDeduct(input: CouponDeductInput): CouponDeductResult {
  const base = {
    userCouponId: input.userCouponId,
    couponId: input.couponId,
  };

  // 1) 用户券自身状态必须可用
  if (input.userCouponStatus !== 'UNUSED') {
    return {
      ...base, usable: false, deductFen: 0n,
      valueSource: 'SNAPSHOT', effectiveValue: 0, reason: 'COUPON_NOT_USABLE_STATUS',
    };
  }

  // 2) 过期（服务端时间为准，不用客户端时间）
  if (input.expiredAt && input.expiredAt.getTime() <= input.now.getTime()) {
    return {
      ...base, usable: false, deductFen: 0n,
      valueSource: 'SNAPSHOT', effectiveValue: 0, reason: 'COUPON_EXPIRED',
    };
  }

  // 3) 模板状态：DRAFT 阻断（数据错乱），PAUSED/ENDED 均**不阻断**
  //    （主理人裁定：pause/end 只影响「还能不能领新的」，存量券照常用完）
  if (input.templateStatus === COUPON_STATUS.DRAFT) {
    return {
      ...base, usable: false, deductFen: 0n,
      valueSource: 'SNAPSHOT', effectiveValue: 0, reason: 'COUPON_TEMPLATE_ENDED',
    };
  }

  // 4) 取面额：快照优先，null 回退读模板
  const usingFallback = input.valueSnapshot === null;
  const effectiveValue = usingFallback ? input.templateValue : (input.valueSnapshot ?? 0);

  // 5) 面额为 0 不阻断下单，但抵扣为 0 —— 阻断会让用户「有券却不能用」而不知原因
  if (effectiveValue <= 0) {
    return {
      ...base, usable: false, deductFen: 0n,
      valueSource: usingFallback ? 'FALLBACK_TEMPLATE' : 'SNAPSHOT',
      effectiveValue, reason: 'COUPON_ZERO_VALUE',
    };
  }

  // 6) DURATION 类券的单位是**分钟**，不是分 —— 不能直接当金额扣。
  //    这是量纲陷阱：把 60（分钟）当 60 分抵扣，等于白送 60 元。
  //    MVP 阶段时长卡走gift_cards 链路（gift_card_deduct_fen），
  //    这里显式返回不可用而不是悄悄错算。
  if (input.couponType === 'DURATION') {
    return {
      ...base, usable: false, deductFen: 0n,
      valueSource: usingFallback ? 'FALLBACK_TEMPLATE' : 'SNAPSHOT',
      effectiveValue, reason: 'COUPON_ZERO_VALUE',
    };
  }

  // 7) 抵扣不得超过订单原价（防止负数订单；也防止模板面额被改大后超额抵扣）
  const deductFen = BigInt(effectiveValue);
  if (deductFen > input.orderOriginalFen) {
    return {
      ...base, usable: true, deductFen: input.orderOriginalFen,
      valueSource: usingFallback ? 'FALLBACK_TEMPLATE' : 'SNAPSHOT',
      effectiveValue, reason: 'COUPON_EXCEEDS_ORDER',
    };
  }

  return {
    ...base,
    usable: true,
    deductFen,
    valueSource: usingFallback ? 'FALLBACK_TEMPLATE' : 'SNAPSHOT',
    effectiveValue,
  };
}

/**
 * 是否需要记「快照缺失」日志。
 *
 * 抽成独立函数的理由：调用方在事务里可能 try/catch 包裹，
 * 若把判断内联进业务代码，很容易在改写时漏掉 —— 而这个日志是回填完成的
 * 唯一证据。独立函数 + 单测锁住，是为了让「要记日志」这件事不可遗忘。
 */
export function needsBackfillLog(valueSnapshot: number | null): boolean {
  return valueSnapshot === null;
}