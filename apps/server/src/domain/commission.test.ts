// 抽成计算单测：BigInt 整数运算、round 行为、边界金额（0/超大）、bp 区间（架构 §7.3）
import { describe, expect, it } from 'vitest';
import {
  assertRateBp,
  bpToRate,
  calcOrderAmount,
  computeCommission,
  defaultCommissionRateBp,
  resolveCommissionRateBp,
} from './commission';

const YI = 100_000_000n; // ¥100 万 = 1 亿分
const MAX_SAFE = 9007199254740991n; // Number.MAX_SAFE_INTEGER（2^53−1）

describe('抽成计算 · 正常值', () => {
  it('¥500 订单 5% 抽成 → 平台 2500 分 / 陪聊员 47500 分', () => {
    const r = computeCommission(50000n, 500);
    expect(r.platformCommissionFen).toBe(2500n);
    expect(r.companionIncomeFen).toBe(47500n);
    expect(r.orderAmountFen + 0n).toBe(50000n);
  });

  it('拆分恒等式：平台 + 陪聊员 = 实收（任意值）', () => {
    for (const amount of [1n, 99n, 12345n, 999999n, YI]) {
      const r = computeCommission(amount, 500);
      expect(r.platformCommissionFen + r.companionIncomeFen).toBe(amount);
    }
  });

  it('四舍五入：3333 × 5% = 166.65 分 → 167 分', () => {
    const r = computeCommission(3333n, 500);
    expect(r.platformCommissionFen).toBe(167n);
    expect(r.companionIncomeFen).toBe(3166n);
  });

  it('四舍五入入界：1666 × 5% = 83.3 → 83；1667 × 5% = 83.35 → 83', () => {
    expect(computeCommission(1666n, 500).platformCommissionFen).toBe(83n);
    expect(computeCommission(1667n, 500).platformCommissionFen).toBe(83n);
  });

  it('10% 上限抽成：¥300 = 30000 分 → 平台 3000 / 陪聊员 27000', () => {
    const r = computeCommission(30000n, 1000);
    expect(r.platformCommissionFen).toBe(3000n);
    expect(r.companionIncomeFen).toBe(27000n);
  });
});

describe('抽成计算 · 边界金额', () => {
  it('0 分订单 → 平台 0 / 陪聊员 0（不抛错）', () => {
    const r = computeCommission(0n, 500);
    expect(r.platformCommissionFen).toBe(0n);
    expect(r.companionIncomeFen).toBe(0n);
  });

  it('1 分订单 → 平台 0（round(0.05)=0）/ 陪聊员 1', () => {
    const r = computeCommission(1n, 500);
    expect(r.platformCommissionFen).toBe(0n);
    expect(r.companionIncomeFen).toBe(1n);
  });

  it('超大值：2^53−1 分 × 5% → 精确 BigInt，不丢精度', () => {
    const r = computeCommission(MAX_SAFE, 500);
    // 9007199254740991 * 500 / 10000 = 450359962737049.55 → 450359962737050
    expect(r.platformCommissionFen).toBe(450359962737050n);
    expect(r.platformCommissionFen + r.companionIncomeFen).toBe(MAX_SAFE);
  });

  it('超过 2^53 的超大值仍精确（BigInt 无上限）', () => {
    const huge = MAX_SAFE * 1000n;
    const r = computeCommission(huge, 500);
    expect(r.platformCommissionFen + r.companionIncomeFen).toBe(huge);
  });

  it('负金额 → 拒绝', () => {
    expect(() => computeCommission(-1n, 500)).toThrowError(/不能为负/);
  });
});

describe('抽成计算 · bp 区间与配置换算', () => {
  it('bp 下限 500 / 上限 1000 合法', () => {
    expect(() => assertRateBp(500)).not.toThrow();
    expect(() => assertRateBp(1000)).not.toThrow();
  });

  it('bp 499 / 1001 / 非整数 → 拒绝', () => {
    expect(() => assertRateBp(499)).toThrowError(/超出允许区间/);
    expect(() => assertRateBp(1001)).toThrowError(/超出允许区间/);
    expect(() => assertRateBp(500.5)).toThrowError(/超出允许区间/);
  });

  it('computeCommission 内部同样校验 bp', () => {
    expect(() => computeCommission(1000n, 100)).toThrowError(/超出允许区间/);
  });

  it('"0.05" → 500bp；"0.1" → 1000bp', () => {
    expect(resolveCommissionRateBp('0.05')).toBe(500);
    expect(resolveCommissionRateBp('0.1')).toBe(1000);
  });

  it('非法配置串 → 90005 CONFIG_MISSING', () => {
    expect(() => resolveCommissionRateBp('abc')).toThrowError(/非法/);
    expect(() => resolveCommissionRateBp('1.5')).toThrowError(/非法/);
    expect(() => resolveCommissionRateBp('0')).toThrowError(/非法/);
  });

  it('bp → rate 展示换算', () => {
    expect(bpToRate(500)).toBe(0.05);
    expect(bpToRate(1000)).toBe(0.1);
  });

  it('默认基点 500', () => {
    expect(defaultCommissionRateBp()).toBe(500);
  });
});

describe('订单计价（架构 §6.1：时长档 × 时薪）', () => {
  it('2 小时 × ¥200/h(20000 分) → 原价 40000 分', () => {
    const r = calcOrderAmount({ durationMinutes: 120, hourlyRateFen: 20000n });
    expect(r.originalAmountFen).toBe(40000n);
    expect(r.totalAmountFen).toBe(40000n);
  });

  it('90 分钟按分钟比例计价（四舍五入到分）', () => {
    // 90 * 20000 / 60 = 30000
    const r = calcOrderAmount({ durationMinutes: 90, hourlyRateFen: 20000n });
    expect(r.originalAmountFen).toBe(30000n);
  });

  it('抵扣不进入分成基数：原价 40000 − 券 5000 → 实收 35000', () => {
    const r = calcOrderAmount({
      durationMinutes: 120,
      hourlyRateFen: 20000n,
      couponDeductFen: 5000n,
    });
    expect(r.totalAmountFen).toBe(35000n);
    expect(r.couponDeductFen).toBe(5000n);
    expect(r.giftCardDeductFen).toBe(0n);
  });

  it('券+时长卡合计抵扣', () => {
    const r = calcOrderAmount({
      durationMinutes: 120,
      hourlyRateFen: 20000n,
      couponDeductFen: 3000n,
      giftCardDeductFen: 7000n,
    });
    expect(r.totalAmountFen).toBe(30000n);
  });

  it('抵扣 ≥ 原价 → 实收 0（不为负）', () => {
    const r = calcOrderAmount({ durationMinutes: 60, hourlyRateFen: 20000n, couponDeductFen: 99999n });
    expect(r.totalAmountFen).toBe(0n);
  });

  it('时长非法（过短/过长/非整点半档）→ 拒绝', () => {
    expect(() => calcOrderAmount({ durationMinutes: 30, hourlyRateFen: 20000n })).toThrowError(/不合法/);
    expect(() => calcOrderAmount({ durationMinutes: 45, hourlyRateFen: 20000n })).toThrowError(/不合法/);
    expect(() => calcOrderAmount({ durationMinutes: 600, hourlyRateFen: 20000n })).toThrowError(/不合法/);
  });

  it('时薪 ≤ 0 → 拒绝', () => {
    expect(() => calcOrderAmount({ durationMinutes: 60, hourlyRateFen: 0n })).toThrowError(/时薪/);
  });

  it('负抵扣 → 拒绝', () => {
    expect(() =>
      calcOrderAmount({ durationMinutes: 60, hourlyRateFen: 20000n, couponDeductFen: -1n }),
    ).toThrowError(/抵扣/);
  });
});
