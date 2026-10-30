// ============================================================================
// 邻伴 · 感知订阅营收聚合（纯函数层，零 IO）
// ----------------------------------------------------------------------------
// 支撑 GET /admin/activity/revenue（契约 §13.6，权限点 revenue:read）。
//
// 为什么要单独抽domain：本文件全是「口径判定」，一旦算错是**资损方向**的错
// （把免费订阅算成收入 = 虚增营收；把过期订阅算成当期收入 = 虚增营收）。
// 把口径从Prisma 装配里剥出来，才能对它做注入式反例测试。
//
// ============================================================================
// 一、账务隔离铁律（PRD §5 / Q8 裁定）
// ----------------------------------------------------------------------------
// 感知订阅收入**不进** orders / payments / profit_sharing_records / commissions。
// 本聚合只读 activity_subscriptions，**代码层不 import 任何分账表**——
// 这不是风格选择：一旦 import 了，将来有人加一行 join 就是资损通道。
// 因此下方 `REVENUE_TIER_VALUES` 里刻意不含任何 'payment' / 'sharing' 标识。
//
// 二、什么算「当期确认收入」（三条，任一不满足即**不计**）
// ----------------------------------------------------------------------------
//   1. status 必须是可确认态（ACTIVE / EXPIRED / CANCELLED 皆可确认已发生过的收入；
//      PENDING 未付款、SUSPENDED 欠费暂停 均不计）。
//   2. 起止区间与统计窗口**必须有实际重叠**，且重叠长度 > 0。
//      一次性确认整段 price_fen 是错的：年费用户每月都出当期收入，
//      一次性入账会让本月虚高、下月为0，运营看板当月环比直接失真。
//   3. 按**重叠天数**在总区间跨度上做直线摊分（pro-rata），
//      分母是「本订阅自身跨度」而非「自然月天数」——
//      否则 INSTITUTIONAL 一次性年约会被 365摊薄成月度可比口径错误。
//
// 三、精度纪律
// ----------------------------------------------------------------------------
//   · 金额全程 BigInt（分），**绝不经Number**——
//     ¥49 万级月营收（约 4900_0000 分）远小于 2^53，但分账与营收
//     长期累加没有上限，Number 一旦介入就在累加处静默丢精度。
//   · 摊分用**累计比例差分**（running-total / cumulative allocation），
//     而**不是**「base=整除 + 余数按天补发」。
//
// 为什么不能用「base + 余数补偿」——这是本轮实测踩到的真bug（已被测试抓到）：
//   price=4900 / totalDays=365 / 窗口 31 天
//     朴素做法：base = floor(4900*31/365) = 416，rem = (4900*31) % 365 = 60，
//               extra = ceil(31*60/365) = 6 → 报 422 分
//     真实精确值 4900*31/365 = 416.16                → 多了 6 分（虚增营收）
//   逐日相加更糟：365 天求和得 5110 ≠ 4900 —— 同一笔余数被重复摊了 31 次；
//   且「月度之和 ≠ 全区间」，运营看趋势图必然发现对不上账。
//
//   正确做法：定义累计函数 cum(n) = floor(price · n / totalDays)，
//             任意 [i, j) 天窗口的应确认金额 = cum(j) − cum(i)。
//   由差分的可加性，该式同时满足三条：
//     · 全区间：cum(T) − cum(0) = price        （精确等于原价，余数零丢失）
//     · 任意切分：Σ 各窗口 ≡ cum(T) − cum(0)  （**趋势之和 ≡ 汇总数**）
//     · 单窗口误差 < 1 分（floor 语义，且永不超发）
//   这是财务摊分的标准算法，非本项目发明。
// ============================================================================

/** 订阅档位（与 schema enum activity_subscription_tier 逐值一致） */
export type RevenueTier = 'FREE' | 'PRO' | 'INSTITUTIONAL';

/** 订阅状态（与 schema enum activity_subscription_status 逐值一致） */
export type RevenueStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';

/**
 * 可确认收入的状态白名单。
 *
 * 为什么 CANCELLED 也算：用户 1 月付费、2 月退订 —— 1 月那笔收入真实发生了，
 * 不确认就是虚减营收；退订本身是对「未来收入」���止，不是对「已发生收入」的冲销
 * （冲销走退款，Q8：退款是独立科目，不在本报表里做净额）。
 * SUSPENDED 不算：欠费挂起，收入尚未成立，按「确认收入」口径不应入账。
 */
export const REVENUE_CONFIRMABLE_STATUSES: readonly RevenueStatus[] = [
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
];

/** 零成本档（不产生收入，但要在报表里出现，便于运营看量级） */
export const FREE_TIER: RevenueTier = 'FREE';

/** 分摊口径：某订阅在某窗口内的确认收入（分） */
export interface ProratedRevenue {
  /** 是否计入了当期收入（false 时下方金额字段无意义） */
  counted: boolean;
  /** 当期确认收入（分）。未计入时为0n */
  proratedFen: bigint;
  /** 未计入的原因（可审计；**不得省略**，否则报表对不上账时无法定位） */
  reason:
    | 'COUNTED'
    | 'STATUS_NOT_CONFIRMABLE'
    | 'FREE_TIER_ZERO_PRICE'
    | 'ZERO_PRICE'
    | 'ZERO_SPAN'
    | 'NO_OVERLAP'
    | 'INVALID_SPAN';
}

/** 订阅事实（service 层从 Prisma 行转换而来；只带聚合需要的列） */
export interface RevenueSubscriptionRow {
  id: bigint;
  /**
   * 业务单号：随行进入域函数并回传。
   *
   * 为什么必须带进来而不是 service 层事后按下标配号：
   * aggregateRevenue 会跳过「未知档位」这类行，若service 层靠
   * `details[i]` ↔ `rows[i]` 对齐，一旦中间跳过任何行，
   * 后面所有行的单号就会**整体错位** —— 财务拿着A 的单号去核B 的金额，
   * 且金额看起来完全合理，没有任何异常信号。
   */
  subscriptionNo: string;
  tier: RevenueTier;
  status: RevenueStatus;
  /** 订阅价（分）。FREE 档与试用单为 0 */
  priceFen: bigint;
  /** 订阅生效起点（含） */
  startAt: Date;
  /** 订阅失效点（**不含**，与 schema end_at 语义一致） */
  endAt: Date;
}

const MS_PER_DAY = 86_400_000;

/** 归一化上限：防止脏数据（endAt<= startAt）除零/负除。调用方仍应修数据，此处只保证不出NaN */
function daysOf(from: Date, to: Date): bigint {
  const d = BigInt(Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
  return d > 0n ? d : 0n;
}

/**
 * 单订阅的窗口内确认收入（累计比例差分法，见文件头「三、精度纪律」）。
 *
 * 实现要点：金额不按窗口直接算，而是按**累计边界**算 ——
 *   cum(n) = floor(priceFen · n / totalDays)   （n = 距 startAt 的第 n 天）
 *   amount = cum(toOffset) − cum(fromOffset)
 * 这样做的唯一理由是**差分可加**：
 *   · 全区间 → cum(totalDays) − cum(0) = priceFen（余数一分不丢）
 *   · 任意窗口切分 → Σ 各窗口 ≡ 全区间（趋势图逐月相加 == 汇总数）
 * 直接算 `floor(price·ov/T)` 会随窗口起点漂移，逐日相加恒溢出（实测 5110≠4900）。
 */
export function prorateSubscription(
  row: RevenueSubscriptionRow,
  windowStart: Date,
  windowEnd: Date,
): ProratedRevenue {
  if (!REVENUE_CONFIRMABLE_STATUSES.includes(row.status)) {
    return { counted: false, proratedFen: 0n, reason: 'STATUS_NOT_CONFIRMABLE' };
  }
  // 档位优先于金额：FREE 档即便被脏数据错配了非零价也不计，
  // 否则一条FREE 记录就能凭空造出收入（资损方向：虚增）。
  if (row.tier === FREE_TIER) {
    return { counted: false, proratedFen: 0n, reason: 'FREE_TIER_ZERO_PRICE' };
  }
  if (row.priceFen <= 0n) {
    return { counted: false, proratedFen: 0n, reason: 'ZERO_PRICE' };
  }
  // 脏数据防御：endAt<= startAt 时跨度为 0，无法摊分 → 不计并显式给原因
  const totalDays = daysOf(row.startAt, row.endAt);
  if (totalDays === 0n) return { counted: false, proratedFen: 0n, reason: 'INVALID_SPAN' };

  // 区间重叠（闭开区间 [start, end)）
  const from = row.startAt > windowStart ? row.startAt : windowStart;
  const to = row.endAt < windowEnd ? row.endAt : windowEnd;
  const overlapDays = daysOf(from, to);
  if (overlapDays === 0n) return { counted: false, proratedFen: 0n, reason: 'NO_OVERLAP' };

  const fromOffset = daysOf(row.startAt, from);
  const toOffset = fromOffset + overlapDays;
  const cum = (n: bigint) => (row.priceFen * n) / totalDays;
  return { counted: true, proratedFen: cum(toOffset) - cum(fromOffset), reason: 'COUNTED' };
}

/** 一行订阅在窗口内的「摊分是否满额」标记（供对账：剩余尾款落在哪个月） */
export interface RevenueRowDetail extends ProratedRevenue {
  subscriptionNo: string;
  tier: RevenueTier;
  status: RevenueStatus;
  /** 原价（分） */
  priceFen: bigint;
  /** 本订阅自身总跨度（天） */
  totalDays: bigint;
  /** 与窗口重叠天数 */
  overlapDays: bigint;
}

/** 按档位分档统计行 */
export interface RevenueTierBucket {
  tier: RevenueTier;
  /** 当期确认收入（分，字符串化出参） */
  amountFen: string;
  /** 当期确认的订阅笔数 */
  countedCount: number;
  /** 在册订阅笔数（含未确认态与免费档；用于算「付费转化」） */
  totalCount: number;
}

/** 月度趋势行 */
export interface RevenueTrendPoint {
  /** YYYY-MM */
  month: string;
  amountFen: string;
}

/** 汇总视图 */
export interface RevenueSummary {
  /** 当期确认收入合计（分） */
  totalAmountFen: bigint;
  /** 付费档位订阅笔数（PRO + INSTITUTIONAL），仅计确认态 */
  paidCount: number;
  /**
   * 免费档**在册**笔数。
   *
   * 为什么用 totalCount 而非 countedCount：FREE 档零价 → 恒不「计入」，
   * 用 countedCount 会让freeCount 永远等于 0（这不是业务事实，
   * 是口径选错了字段）。免费档要看的是**在册量**（运营关心
   * 「多少老人在用免费层」，这决定付费转化的分母）。
   */
  freeCount: number;
  /** 客单价：当期确认收入 / 付费笔数（分）；付费笔数 0 时为 null 而非 0 */
  avgPriceFen: bigint | null;
  /** 因非确认态被排除的笔数（可审计：报表与在册数差额可解释） */
  excludedCount: number;
}

/** 按档位固定顺序输出（FREE/PRO/INSTITUTIONAL），**不给排序**：
 * 报表行序必须是稳定的，运营看同比要能对齐行。 */
const TIER_ORDER: readonly RevenueTier[] = ['FREE', 'PRO', 'INSTITUTIONAL'];

/**
 * 全量装配：分档 + 汇总 + 排除原因分布。
 *
 * 纯函数：入参行数组，输出无外部依赖。排除原因分布**必须**输出——
 * 「在册 100 笔、报表只认 80 笔」不解释原因，运营会去查数据是不是丢了。
 */
export function aggregateRevenue(rows: RevenueSubscriptionRow[], windowStart: Date, windowEnd: Date) {
  const buckets = new Map<RevenueTier, { amountFen: bigint; countedCount: number; totalCount: number }>();
  for (const t of TIER_ORDER) buckets.set(t, { amountFen: 0n, countedCount: 0, totalCount: 0 });

  const excludedReasons = new Map<string, number>();
  const details: RevenueRowDetail[] = [];

  for (const row of rows) {
    const b = buckets.get(row.tier);
    // 档位脏数据（不在三档内）不静默丢弃，计入 INSTITUTIONAL 会造出假收入 → fail-closed
    if (!b) {
      excludedReasons.set('UNKNOWN_TIER', (excludedReasons.get('UNKNOWN_TIER') ?? 0) + 1);
      continue;
    }
    b.totalCount += 1;
    const r = prorateSubscription(row, windowStart, windowEnd);
    const totalDays = daysOf(row.startAt, row.endAt);
    const from = row.startAt > windowStart ? row.startAt : windowStart;
    const to = row.endAt < windowEnd ? row.endAt : windowEnd;
    details.push({
      ...r,
      subscriptionNo: row.subscriptionNo,
      tier: row.tier,
      status: row.status,
      priceFen: row.priceFen,
      totalDays,
      overlapDays: daysOf(from, to),
    });
    if (!r.counted) {
      excludedReasons.set(r.reason, (excludedReasons.get(r.reason) ?? 0) + 1);
      continue;
    }
    b.amountFen += r.proratedFen;
    b.countedCount += 1;
  }

  const byTier: RevenueTierBucket[] = TIER_ORDER.map((tier) => {
    const b = buckets.get(tier)!;
    return { tier, amountFen: b.amountFen.toString(), countedCount: b.countedCount, totalCount: b.totalCount };
  });

  const totalAmountFen = byTier
    .filter((r) => r.tier !== FREE_TIER)
    .reduce((acc, r) => acc + BigInt(r.amountFen), 0n);
  const paidCount = byTier
    .filter((r) => r.tier !== FREE_TIER)
    .reduce((acc, r) => acc + r.countedCount, 0);
  const freeCount = byTier.find((r) => r.tier === FREE_TIER)?.totalCount ?? 0;
  const summary: RevenueSummary = {
    totalAmountFen,
    paidCount,
    freeCount,
    // 分母为 0 时返回 null：返回 0 会被运营读成「客单价 0 元」，
    // 而真相是「本期没有付费用户」—— 这是两种不同的运营结论。
    avgPriceFen: paidCount > 0 ? totalAmountFen / BigInt(paidCount) : null,
    excludedCount: details.filter((d) => !d.counted).length,
  };

  return {
    byTier,
    summary,
    details,
    excludedReasons: [...excludedReasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)),
  };
}

/** 月份键 YYYY-MM（UTC，避免跨时区把订单划到错月） */
export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 按自然月切窗做趋势（每月单独摊分，而不是「按月初一次性确认」）。
 *
 * 与aggregateRevenue 的关系：aggregate 是**单窗口**汇总，趋势是**多窗口**编排。
 * 二者共用 prorateSubscription，因此「本月数」之和与「区间一次摊分」在语义上一致，
 * 不会出现「趋势图加起来 ≠ 汇总数」的对不上。
 */
export function buildMonthlyTrend(
  rows: RevenueSubscriptionRow[],
  months: number,
  windowEnd: Date,
): RevenueTrendPoint[] {
  const out: RevenueTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const s = new Date(
      Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() - i, 1),
    );
    const e = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() - i + 1, 1));
    const agg = aggregateRevenue(rows, s, e);
    out.push({ month: monthKeyOf(s), amountFen: agg.summary.totalAmountFen.toString() });
  }
  return out;
}