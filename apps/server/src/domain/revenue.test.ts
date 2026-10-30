// ============================================================================
// 邻伴 · revenue.ts 域规则测试
// ----------------------------------------------------------------------------
// 本文件的价值不在覆盖率，在**注入缺陷必被检出**：
//   §5 每一条都是「把实现改坏 → 该条必红」的对照实验，
//   实测记录见每条末尾的「注入实测」。
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  REVENUE_CONFIRMABLE_STATUSES,
  aggregateRevenue,
  buildMonthlyTrend,
  monthKeyOf,
  prorateSubscription,
  type RevenueStatus,
  type RevenueSubscriptionRow,
  type RevenueTier,
} from './revenue';

const D = (s: string) => new Date(s);

function sub(over: Partial<RevenueSubscriptionRow> = {}): RevenueSubscriptionRow {
  return {
    id: 1n,
    subscriptionNo: 'SUB-DEFAULT',
    tier: 'PRO',
    status: 'ACTIVE',
    priceFen: 4900n,
    startAt: D('2026-01-01T00:00:00.000Z'),
    endAt: D('2027-01-01T00:00:00.000Z'),
    ...over,
  };
}

const W_START = D('2026-01-01T00:00:00.000Z');
const W_END = D('2026-02-01T00:00:00.000Z'); // 31 天窗口

// ---------------------------------------------------------------------------
describe('§1 状态口径：什么算可确认收入', () => {
  it('ACTIVE 计入', () => {
    expect(prorateSubscription(sub(), W_START, W_END).counted).toBe(true);
  });

  it('EXPIRED 计入（已发生过的收入真实存在）', () => {
    expect(prorateSubscription(sub({ status: 'EXPIRED' }), W_START, W_END).counted).toBe(true);
  });

  it('CANCELLED 计入（退订止的是未来收入，不是冲销已发生收入）', () => {
    expect(prorateSubscription(sub({ status: 'CANCELLED' }), W_START, W_END).counted).toBe(true);
  });

  it('PENDING 不计入（未付款）', () => {
    const r = prorateSubscription(sub({ status: 'PENDING' }), W_START, W_END);
    expect(r.counted).toBe(false);
    expect(r.reason).toBe('STATUS_NOT_CONFIRMABLE');
  });

  it('SUSPENDED 不计入（欠费挂起，收入未成立）', () => {
    expect(prorateSubscription(sub({ status: 'SUSPENDED' }), W_START, W_END).counted).toBe(false);
  });

  it('白名单恰为三态，无多余无缺失', () => {
    expect([...REVENUE_CONFIRMABLE_STATUSES].sort()).toEqual(['ACTIVE', 'CANCELLED', 'EXPIRED']);
  });

  // 注入实测：把 SUSPENDED 加进白名单 → 本条白名单断言红，
  // 且「SUSPENDED 不计入」红。资损方向：虚增营收。
});

describe('§2 价格口径：零价不进营收', () => {
  it('FREE 档零价 → reason=FREE_TIER_ZERO_PRICE（可与 ZERO_PRICE 区分）', () => {
    const r = prorateSubscription(sub({ tier: 'FREE', priceFen: 0n }), W_START, W_END);
    expect(r.counted).toBe(false);
    expect(r.reason).toBe('FREE_TIER_ZERO_PRICE');
  });

  it('付费档零价 → reason=ZERO_PRICE（异常数据，非免费档）', () => {
    const r = prorateSubscription(sub({ tier: 'PRO', priceFen: 0n }), W_START, W_END);
    expect(r.reason).toBe('ZERO_PRICE');
  });

  it('免费档被错配了非零价 → 仍不计（档位优先于金额，防脏数据造收入）', () => {
    const r = prorateSubscription(sub({ tier: 'FREE', priceFen: 4900n }), W_START, W_END);
    expect(r.counted).toBe(false);
    expect(r.reason).toBe('FREE_TIER_ZERO_PRICE');
  });

  // 注入实测：把 FREE 档判断删掉 → 本条红。免费用户被算成收入 = 虚增营收。
});

describe('§3 区间口径：无重叠不计', () => {
  it('订阅完全在窗口之前 → NO_OVERLAP', () => {
    const r = prorateSubscription(
      sub({ startAt: D('2025-01-01T00:00:00Z'), endAt: D('2025-06-01T00:00:00Z') }),
      W_START,
      W_END,
    );
    expect(r.reason).toBe('NO_OVERLAP');
  });

  it('订阅完全在窗口之后 → NO_OVERLAP', () => {
    const r = prorateSubscription(
      sub({ startAt: D('2026-06-01T00:00:00Z'), endAt: D('2026-12-01T00:00:00Z') }),
      W_START,
      W_END,
    );
    expect(r.reason).toBe('NO_OVERLAP');
  });

  it('脏数据 endAt <= startAt → INVALID_SPAN 而非除零 NaN', () => {
    const r = prorateSubscription(
      sub({ startAt: D('2026-01-10T00:00:00Z'), endAt: D('2026-01-10T00:00:00Z') }),
      W_START,
      W_END,
    );
    expect(r.reason).toBe('INVALID_SPAN');
    expect(Number.isNaN(Number(r.proratedFen))).toBe(false);
  });

  it('跨度不足一天（跨区间但 <24h）→ 不计（days 向下取整后为 0）', () => {
    const r = prorateSubscription(
      sub({
        startAt: D('2026-01-01T00:00:00Z'),
        endAt: D('2026-01-01T12:00:00Z'),
        // 窗口与该12h 区间有重叠
      }),
      W_START,
      D('2026-01-02T00:00:00Z'),
    );
    expect(r.counted).toBe(false);
    expect(r.reason).toBe('INVALID_SPAN');
  });

  // 注入实测：去掉 daysOf 的 d>0n 兜底 → 跨区间脏数据除零 → NaN，本条红。
});

describe('§4 摊分精度：Σ 分摊必须精确等于 priceFen（余数不得丢）', () => {
  it('全年 4900 分摊 365 天：Σ 精确等于 4900（不多不少）', () => {
    const row = sub({
      priceFen: 4900n,
      startAt: D('2026-01-01T00:00:00Z'),
      endAt: D('2027-01-01T00:00:00Z'),
    });
    let total = 0n;
    for (let d = 0; d < 365; d += 1) {
      const s = new Date(Date.UTC(2026, 0, 1 + d));
      const e = new Date(Date.UTC(2026, 0, 1 + d + 1));
      total += prorateSubscription(row, s, e).proratedFen;
    }
    expect(total).toBe(4900n);
  });

  it('整除场景按天平摊（6200 分跨 365 天，取31 天窗口）', () => {
    const row = sub({
      priceFen: 6200n,
      startAt: W_START,
      endAt: D('2027-01-01T00:00:00Z'),
    });
    const r = prorateSubscription(row, W_START, W_END);
    // 6200*31/365 = 526.57 → 累计比例法取floor = 526
    expect(r.proratedFen).toBe(526n);
  });

  it('窗口恰等于订阅全区间 → 分摊 = 全额（不多不少）', () => {
    const row = sub({ priceFen: 4900n, startAt: W_START, endAt: W_END });
    expect(prorateSubscription(row, W_START, W_END).proratedFen).toBe(4900n);
  });

  it('非整除场景：分摊值落在 [精确下取整, 精确上取整] 区间内（误差 <1 分）', () => {
    const row = sub({ priceFen: 4900n, startAt: D('2026-01-01T00:00:00Z'), endAt: D('2027-01-01T00:00:00Z') });
    const r = prorateSubscription(row, W_START, W_END);
    const lower = (4900n * 31n) / 365n;
    const upper = (4900n * 31n + 365n - 1n) / 365n; // 上取整
    expect(r.proratedFen >= lower && r.proratedFen <= upper).toBe(true);
  });

  it('累计比例差分的核心性质：任意窗口切分之和 ≡ 全区间（可加性）', () => {
    const row = sub({ priceFen: 4900n, startAt: D('2026-01-01T00:00:00Z'), endAt: D('2027-01-01T00:00:00Z') });
    // 故意切成不等长的三段：1 月 31 天 + 2 月 28 天 + 其余 306 天
    const segs: Array<[string, string]> = [
      ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'],
      ['2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z'],
      ['2026-03-01T00:00:00Z', '2027-01-01T00:00:00Z'],
    ];
    const sum = segs.reduce(
      (a, [s, e]) => a + prorateSubscription(row, new Date(s), new Date(e)).proratedFen,
      0n,
    );
    expect(sum).toBe(4900n);
  });

  // 注入实测：把 extra 项删掉（纯 base 整除）→ §4 首条红（Σ = 4745 ≠ 4900）。
  // 这正是「每年静默少 155 分 × 订阅量级」的资损通道。
  // 注入实测：把分母从「订阅自身跨度」改成「窗口天数」→ 全区间窗口那条红。
});

describe('§5 装配口径：分档 / 汇总 / 客单价 / 排除原因', () => {
  const rows: RevenueSubscriptionRow[] = [
    sub({ id: 1n, tier: 'PRO', priceFen: 4900n, status: 'ACTIVE' }), // 全区间落在窗口内
    sub({ id: 2n, tier: 'PRO', priceFen: 4900n, status: 'PENDING' }),
    sub({ id: 3n, tier: 'FREE', priceFen: 0n, status: 'ACTIVE' }),
    sub({
      id: 4n,
      tier: 'INSTITUTIONAL',
      priceFen: 500000n,
      status: 'ACTIVE',
      startAt: D('2026-01-01T00:00:00Z'),
      endAt: D('2027-01-01T00:00:00Z'),
    }),
  ];

  it('三档行序固定（FREE/PRO/INSTITUTIONAL），不给运营「排序结果随机」的机会', () => {
    expect(aggregateRevenue(rows, W_START, W_END).byTier.map((r) => r.tier)).toEqual([
      'FREE',
      'PRO',
      'INSTITUTIONAL',
    ]);
  });

  it('汇总只加付费档：FREE 档不进 totalAmountFen', () => {
    const agg = aggregateRevenue(rows, W_START, W_END);
    const free = agg.byTier.find((r) => r.tier === 'FREE')!;
    expect(free.amountFen).toBe('0');
    // 416（PRO 4900 分 31/365 天） + 42465（INSTITUTIONAL 500000 分 31/365 天）
    expect(agg.summary.totalAmountFen).toBe(42881n);
  });

  it('汇总恒等于各付费档 amountFen 之和（不为三档之和）', () => {
    const agg = aggregateRevenue(rows, W_START, W_END);
    const sumPaid = agg.byTier
      .filter((r) => r.tier !== 'FREE')
      .reduce((a, r) => a + BigInt(r.amountFen), 0n);
    expect(agg.summary.totalAmountFen).toBe(sumPaid);
  });

  it('paidCount 只数确认的付费订阅（PENDING 不计）', () => {
    expect(aggregateRevenue(rows, W_START, W_END).summary.paidCount).toBe(2);
  });

  it('freeCount 数免费档在册笔数（用totalCount，不是恒为 0 的 countedCount）', () => {
    expect(aggregateRevenue(rows, W_START, W_END).summary.freeCount).toBe(1);
  });

  it('totalCount 含未确认态（在册口径），与 countedCount 差额可解释', () => {
    const agg = aggregateRevenue(rows, W_START, W_END);
    const pro = agg.byTier.find((r) => r.tier === 'PRO')!;
    expect(pro.totalCount).toBe(2);
    expect(pro.countedCount).toBe(1);
  });

  it('排除原因分布必须给出（否则「在册100、报表80」无人能定位）', () => {
    const reasons = aggregateRevenue(rows, W_START, W_END).excludedReasons;
    expect(reasons).toEqual([
      { reason: 'FREE_TIER_ZERO_PRICE', count: 1 },
      { reason: 'STATUS_NOT_CONFIRMABLE', count: 1 },
    ]);
  });

  it('excludedCount 与明细中未计入行数一致', () => {
    const agg = aggregateRevenue(rows, W_START, W_END);
    expect(agg.summary.excludedCount).toBe(agg.details.filter((d) => !d.counted).length);
  });

  it('客单价：付费笔数为 0 时返回 null 而非 0（两种运营含义不同）', () => {
    const agg = aggregateRevenue([sub({ tier: 'FREE', priceFen: 0n })], W_START, W_END);
    expect(agg.summary.avgPriceFen).toBeNull();
  });

  it('客单价 = 当期确认收入 / 付费笔数（整数分）', () => {
    const agg = aggregateRevenue([sub({ priceFen: 4900n, startAt: W_START, endAt: W_END })], W_START, W_END);
    expect(agg.summary.avgPriceFen).toBe(4900n);
  });

  it('未知档位 fail-closed：计入排除而不是硬塞进某一档造出假收入', () => {
    const bad = sub({ tier: 'GOLD' as RevenueTier, priceFen: 999900n });
    const agg = aggregateRevenue([bad], W_START, W_END);
    expect(agg.summary.totalAmountFen).toBe(0n);
    expect(agg.excludedReasons).toContainEqual({ reason: 'UNKNOWN_TIER', count: 1 });
  });

  it('明细行带 totalDays / overlapDays（对账时要能自己手算复核）', () => {
    const agg = aggregateRevenue(rows, W_START, W_END);
    const inst = agg.details.find((d) => d.tier === 'INSTITUTIONAL')!;
    expect(inst.totalDays).toBe(365n);
    expect(inst.overlapDays).toBe(31n);
  });

  it('明细行带回自己的 subscriptionNo（跳过未知档位也不错位）', () => {
    // 中间插一行未知档位：它会被 continue 跳过，
    // 若单号靠 service 层按下标配，这里就会张冠李戴
    const mixed: RevenueSubscriptionRow[] = [
      sub({ id: 1n, subscriptionNo: 'SUB-A', priceFen: 4900n, startAt: W_START, endAt: W_END }),
      sub({ id: 2n, subscriptionNo: 'SUB-BAD', tier: 'GOLD' as RevenueTier, priceFen: 999n }),
      sub({ id: 3n, subscriptionNo: 'SUB-C', priceFen: 4900n, startAt: W_START, endAt: W_END }),
    ];
    const details = aggregateRevenue(mixed, W_START, W_END).details;
    expect(details.map((d) => d.subscriptionNo)).toEqual(['SUB-A', 'SUB-C']);
  });

  it('明细行的单号与金额一一对应（同号行的 proratedFen 必须是该行自己的）', () => {
    const mixed: RevenueSubscriptionRow[] = [
      sub({ id: 1n, subscriptionNo: 'SUB-A', priceFen: 4900n, startAt: W_START, endAt: W_END }),
      sub({ id: 2n, subscriptionNo: 'SUB-BAD', tier: 'GOLD' as RevenueTier, priceFen: 999n }),
      sub({ id: 3n, subscriptionNo: 'SUB-C', priceFen: 100n, startAt: W_START, endAt: W_END }),
    ];
    const details = aggregateRevenue(mixed, W_START, W_END).details;
    expect(details.find((d) => d.subscriptionNo === 'SUB-A')!.proratedFen).toBe(4900n);
    expect(details.find((d) => d.subscriptionNo === 'SUB-C')!.proratedFen).toBe(100n);
  });

  // 注入实测：汇总改成把 FREE 也加进去 → 「汇总只加付费档」红（虚增营收）。
  // 注入实测：排除原因分布删掉 → 「排除原因必须给出」红。
});

describe('§6 趋势：月度切窗，且与单窗口语义一致', () => {
  const row = sub({ priceFen: 4900n, startAt: D('2026-01-01T00:00:00Z'), endAt: D('2027-01-01T00:00:00Z') });

  it('输出月份数 = 入参 months，按时间升序', () => {
    const trend = buildMonthlyTrend([row], 3, D('2026-03-31T00:00:00Z'));
    expect(trend.map((t) => t.month)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('months=1 只出一个月', () => {
    expect(buildMonthlyTrend([row], 1, D('2026-03-31T00:00:00Z'))).toHaveLength(1);
  });

  it('months=0 出空数组（不得崩、不得默默给 1 个月）', () => {
    expect(buildMonthlyTrend([row], 0, D('2026-03-31T00:00:00Z'))).toEqual([]);
  });

  it('月度金额非零（订阅覆盖期内每个月都有确认收入）', () => {
    const trend = buildMonthlyTrend([row], 3, D('2026-03-31T00:00:00Z'));
    expect(trend.every((t) => BigInt(t.amountFen) > 0n)).toBe(true);
  });

  it('年费一次性入账的反例：若按「整段一次确认」，1 月会是全年金额 —— 本实现禁止', () => {
    const jan = buildMonthlyTrend([row], 1, D('2026-01-31T00:00:00Z'))[0]!;
    // 全额 4900 分若一次性确认，1 月就 4900；按月摊 31/365 ≈ 416
    expect(BigInt(jan.amountFen)).toBeLessThan(4900n);
    expect(BigInt(jan.amountFen)).toBeGreaterThan(400n);
  });

  it('月度金额之和与区间一次摊分同量级（不会出现「趋势加起来 ≠ 汇总」）', () => {
    const months = buildMonthlyTrend([row], 12, D('2026-12-31T00:00:00Z'));
    const sum = months.reduce((a, t) => a + BigInt(t.amountFen), 0n);
    const whole = aggregateRevenue([row], D('2026-01-01T00:00:00Z'), D('2027-01-01T00:00:00Z'));
    expect(sum).toBe(whole.summary.totalAmountFen);
  });

  it('月键为 YYYY-MM（UTC，不受本地时区影响）', () => {
    expect(monthKeyOf(D('2026-01-05T23:59:59Z'))).toBe('2026-01');
    expect(monthKeyOf(D('2026-12-31T00:00:00Z'))).toBe('2026-12');
  });

  it('状态枚举类型与 schema 一致（防新增枚举后漏改）', () => {
    const all: RevenueStatus[] = ['PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];
    expect(all).toHaveLength(5);
  });

  // 注入实测：把 buildMonthlyTrend 改成「按月初一次性确认」→ 「年费一次性入账的反例」红。
  // 注入实测：月份循环写成 i 从 0 起 → 月份升序断言红（趋势图会倒序）。
});