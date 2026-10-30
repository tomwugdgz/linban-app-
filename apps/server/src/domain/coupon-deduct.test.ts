// ============================================================================
// 券核销领域规则单测（domain 层，零 IO）
// ----------------------------------------------------------------------------
// 这组测试守的是**钱**。核心是三个必须锁死的点：
//
//  1. **快照优先**：有快照时模板面额改成多少都不影响（这是 value_snapshot 的全部意义）
//  2. **null 回退**：存量券必须能用（否则用户有券却抵扣 0，且无感知）
//  3. **回退要打日志**：没有这条日志，回填做完了没有永远查不出来
//
// 第 3 条我在 service 层用测试锁（跨层），本文件锁纯函数的口径。
// ============================================================================

import { describe, expect, it } from 'vitest';
import { calcCouponDeduct, needsBackfillLog, type CouponDeductInput } from './coupon-deduct';

const NOW = new Date('2026-10-22T00:00:00.000Z');

/** 造一张用户券（边界显式传参，不靠默认值隐含） */
function uc(over: Partial<CouponDeductInput> = {}): CouponDeductInput {
  return {
    userCouponId: 1n,
    couponId: 100n,
    couponType: 'FULL_REDUCTION',
    templateValue: 1000,
    valueSnapshot: 1000,
    userCouponStatus: 'UNUSED',
    expiredAt: null,
    templateStatus: 'ACTIVE',
    orderOriginalFen: 100000n,
    now: NOW,
    ...over,
  };
}

describe('面额来源 · 快照优先（value_snapshot 的全部意义）', () => {
  it('有快照时用快照，模板面额改成别的也不影响', () => {
    // 券面额 1000 分；模板后来被改成 5000 分（虽然业务上被 10001 拦着，
    // 但存量券的快照必须独立于模板）
    const r = calcCouponDeduct(uc({ valueSnapshot: 1000, templateValue: 5000 }));
    expect(r.deductFen).toBe(1000n);
    expect(r.valueSource).toBe('SNAPSHOT');
  });

  it('快照为 0 时抵扣为 0（不是回退读模板 —— 快照为0 是「这张券面额就是0」）', () => {
    // 这条很容易写错：`valueSnapshot ?? templateValue` 会把 0 当成"没有"，
    // 从而回退读模板，用错误的面额抵扣 —— 资损。
    const r = calcCouponDeduct(uc({ valueSnapshot: 0, templateValue: 5000 }));
    expect(r.valueSource).toBe('SNAPSHOT');
    expect(r.usable).toBe(false);
    expect(r.deductFen).toBe(0n);
  });

  it('有快照时模板面额为 0 也不影响（面额已冻结在快照里）', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: 2000, templateValue: 0 }));
    expect(r.deductFen).toBe(2000n);
    expect(r.valueSource).toBe('SNAPSHOT');
  });
});

describe('面额来源 · null 回退（存量券未回填）', () => {
  it('快照为 null 时回退读模板，且标记 FALLBACK_TEMPLATE', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: null, templateValue: 3000 }));
    expect(r.deductFen).toBe(3000n);
    expect(r.valueSource).toBe('FALLBACK_TEMPLATE');
    expect(r.effectiveValue).toBe(3000);
  });

  it('回退分支下模板面额为 0 → 不可用（不能白送）', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: null, templateValue: 0 }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('COUPON_ZERO_VALUE');
    expect(r.valueSource).toBe('FALLBACK_TEMPLATE');
  });

  it('needsBackfillLog 只在 null 时为 true（回填完成的判据）', () => {
    expect(needsBackfillLog(null)).toBe(true);
    expect(needsBackfillLog(0)).toBe(false);
    expect(needsBackfillLog(1000)).toBe(false);
  });
});

describe('不可用判定 · 状态与时效', () => {
  it('已使用的券不可再用', () => {
    const r = calcCouponDeduct(uc({ userCouponStatus: 'USED' }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('COUPON_NOT_USABLE_STATUS');
  });

  it('已过期的券不可用（边界：expiredAt == now 视为已过期）', () => {
    expect(calcCouponDeduct(uc({ expiredAt: NOW })).reason).toBe('COUPON_EXPIRED');
    // 边界差1ms：未过期
    expect(calcCouponDeduct(uc({ expiredAt: new Date(NOW.getTime() + 1) })).usable).toBe(true);
  });

  it('DRAFT 模板的券不可用（数据错乱时不该白送）', () => {
    const r = calcCouponDeduct(uc({ templateStatus: 'DRAFT' }));
    expect(r.usable).toBe(false);
  });

  it('ENDED 模板的存量券**仍可核销**（主理人裁定：单方作废等于拿用户当祭品）', () => {
    const r = calcCouponDeduct(uc({ templateStatus: 'ENDED' }));
    expect(r.usable).toBe(true);
    expect(r.deductFen).toBe(1000n);
  });

  it('PAUSED 模板的存量券同样可核销（pause 只挡新领，不挡存量）', () => {
    const r = calcCouponDeduct(uc({ templateStatus: 'PAUSED' }));
    expect(r.usable).toBe(true);
    expect(r.deductFen).toBe(1000n);
  });
});

describe('量纲陷阱 · DURATION 类券不得当金额扣', () => {
  it('DURATION 类型直接判不可用（60 分钟≠ 60 分）', () => {
    // 这是最容易出资损的一处：value=60 对 DURATION 是「60分钟」，
    // 当金额扣就是白送 60 元。
    const r = calcCouponDeduct(uc({ couponType: 'DURATION', valueSnapshot: 60, templateValue: 60 }));
    expect(r.usable).toBe(false);
    expect(r.deductFen).toBe(0n);
  });

  it('回退分支下的 DURATION 同样拦截', () => {
    const r = calcCouponDeduct(uc({ couponType: 'DURATION', valueSnapshot: null, templateValue: 60 }));
    expect(r.usable).toBe(false);
    expect(r.valueSource).toBe('FALLBACK_TEMPLATE');
  });
});

describe('抵扣上限 · 不得超过订单原价', () => {
  it('面额小于原价时全额抵扣', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: 3000, orderOriginalFen: 10000n }));
    expect(r.deductFen).toBe(3000n);
    expect(r.reason).toBeUndefined();
  });

  it('面额大于原价时截断到原价（防模板面额被改大后超额抵扣）', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: 50000, orderOriginalFen: 10000n }));
    expect(r.deductFen).toBe(10000n);
    expect(r.reason).toBe('COUPON_EXCEEDS_ORDER');
  });

  it('面额恰好等于原价（边界：不截断也不报错）', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: 10000, orderOriginalFen: 10000n }));
    expect(r.deductFen).toBe(10000n);
    expect(r.reason).toBeUndefined();
  });

  it('订单原价为 0 时抵扣也是 0（不得返回负数）', () => {
    const r = calcCouponDeduct(uc({ valueSnapshot: 1000, orderOriginalFen: 0n }));
    expect(r.deductFen).toBe(0n);
    expect(r.usable).toBe(true); // 券本身可用，只是抵满
  });
});

describe('BigInt 精度 · 金额必须精确', () => {
  it('大额面额被订单原价截断到上限（不得因溢出而错算）', () => {
    // 2^53 = 9007199254740992。用 Number 传进来时精度已丢，
    // 但**计算结果必须始终被 orderOriginalFen 钳住** —— 这才是不资损的关键：
    // 面额再大，抵扣也不得超过订单原价。
    const r = calcCouponDeduct(
      uc({ valueSnapshot: Number(9007199254740992n), orderOriginalFen: 10_000_000_000n }),
    );
    expect(r.deductFen).toBe(10_000_000_000n);
    expect(r.reason).toBe('COUPON_EXCEEDS_ORDER');
  });

  it('订单原价高于 2^53 时不被截断（BigInt 全程，无精度损失）', () => {
    const r = calcCouponDeduct(
      uc({ valueSnapshot: 5_000_000, orderOriginalFen: 10_000_000_000_000_000n }),
    );
    expect(r.deductFen).toBe(5_000_000n);
    expect(r.reason).toBeUndefined();
  });

  it('出参 deductFen 恒为 BigInt（调用方 toString 才安全）', () => {
    const r = calcCouponDeduct(uc());
    expect(typeof r.deductFen).toBe('bigint');
  });
});

describe('结果字段完整性（供 service 层日志与埋点）', () => {
  it('总是带回 userCouponId / couponId（回填统计与告警定位要用）', () => {
    const r = calcCouponDeduct(uc({ userCouponId: 777n, couponId: 888n }));
    expect(r).toMatchObject({ userCouponId: 777n, couponId: 888n });
  });

  it('不可用时也带 userCouponId / couponId（失败也要能追溯是哪张券）', () => {
    const r = calcCouponDeduct(uc({ userCouponId: 555n, couponId: 666n, userCouponStatus: 'USED' }));
    expect(r).toMatchObject({ userCouponId: 555n, couponId: 666n, usable: false });
  });
});