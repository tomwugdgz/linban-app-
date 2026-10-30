// ============================================================================
// 邻伴 · 感知订阅营收报表（service 层，契约 §13.6 / PRD §5 / Q8）
// ----------------------------------------------------------------------------
// 端点：GET /admin/activity/revenue（权限点 revenue:read）
//
// 本文件**只做 Prisma 取数 + 域函数装配**，不含任何摊分或口径判断
// —— 那些全在 domain/revenue.ts，理由见该文件头（口径算错是资损方向的错，
// 必须能对它做注入式反例测试）。
//
// ---------------------------------------------------------------------------
// 账务隔离硬约束（Q8 / PRD §5）
// ---------------------------------------------------------------------------
// 订阅收入**不进** orders / payments / profit_sharing_records / commissions。
// 本文件刻意只import activity_subscriptions 一个模型：
// 一次 import 就开一条资损通道，将来有人加一行 join 就是分账池被动过账。
// （对照：`getFunnel` 里的 acquisitionCost 之所以敢 join activity_touchpoints，
//   是因为那是成本科目、方向相反且不回收入池。）
//
// 契约明文要求（§13.6 注）：营收页权限 `revenue:read`，
// **不复用** payment:* / config:read / risk:* —— 否则营收与分账的隔离在 RBAC 层是假的。
// ============================================================================

import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import {
  aggregateRevenue,
  buildMonthlyTrend,
  type RevenueSubscriptionRow,
  type RevenueTier,
  type RevenueStatus,
} from '../../domain/revenue';

const log = moduleLogger('activity-revenue');

/** 出参：订阅状态与档位按原样透出（枚举值由前端 shared 的常量表渲染） */
export interface RevenueDetailDTO {
  subscriptionNo: string;
  tier: RevenueTier;
  status: RevenueStatus;
  /** 原价（分，字符串化） */
  priceFen: string;
  /** 当期确认收入（分，字符串化）；未计入为 "0" */
  proratedFen: string;
  /** 是否计入当期 */
  counted: boolean;
  /** 未计入原因（可审计） */
  reason: string;
  /** 本订阅自身跨度（天） */
  totalDays: number;
  /** 与统计窗口重叠天数 */
  overlapDays: number;
}

export interface RevenueReportDTO {
  /** 统计窗口（闭开区间 [windowStart, windowEnd)） */
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  /** 按档位（固定行序 FREE/PRO/INSTITUTIONAL） */
  byTier: Array<{
    tier: RevenueTier;
    amountFen: string;
    countedCount: number;
    totalCount: number;
  }>;
  summary: {
    totalAmountFen: string;
    paidCount: number;
    freeCount: number;
    /** 客单价（分）；无付费用户时为 null */
    avgPriceFen: string | null;
    excludedCount: number;
  };
  /** 月度趋势（months 长度，升序） */
  trend: Array<{ month: string; amountFen: string }>;
  /** 排除原因分布（报表数与在册数差额可解释） */
  excludedReasons: Array<{ reason: string; count: number }>;
  /** 明细（供财务逐笔复核；上限 window 内的行数） */
  details: RevenueDetailDTO[];
  /** 科目隔离声明（Q8：前端须原样展示，不得省略） */
  accountingNote: string;
  /**
   * 🔴 `details` 被`DETAIL_LIMIT` 截断。
   *
   * 【危害】仅「少显示几行明细」，`summary`/`byTier`/`trend` 的数字**不受影响**
   *   （它们由 domain 层在**全量**上聚合，不依赖这个slice）。
   *   故与 funnel 的 `attributionTruncated`（**聚合数字偏小**）性质不同，字段名区分开。
   *
   * 【为什么必须显式告知】财务复核会逐笔对 `details`，
   *   若不知道被截了，运营看到 500 行会以为「就这么多」，漏核的部分永远不会被发现。
   */
  detailTruncated: boolean;
}

/**
 * 明细上限：营收报表是聚合视图，不需要全量流水。
 *
 * ⚠️ 旧注释写「超限截断并置 truncated」，但**实现里从未置过该字段** ——
 *   `details` 被 slice 了，信息却丢了。这是「注释描述了不存在的行为」，
 *   **比「注释没写」更危险**：读代码的人以为标记已经有了，不会去查。
 *   现已补上 `detailTruncated`（见下方），注释与实现对齐。
 *
 * 【危害方向】截断只导致「少显示几行明细」，数字本身正确
 *   —— 与 funnel 的 `attributionTruncated`（数字偏小）不同，故字段名区分开。
 */
const DETAIL_LIMIT = 500;

export async function getRevenueReport(opts: {
  windowStart: Date;
  windowEnd: Date;
  months: number;
}): Promise<RevenueReportDTO> {
  const { windowStart, windowEnd, months } = opts;

  /**
   * 取数范围**按窗口前后各外扩**再在应用层过滤。
   *
   * 为什么不用 where 直接卡窗口：摊分是「区间有重叠即可能计入」，
   * start_at 早于窗口但 end_at 晚于窗口的**跨界订阅**同样要计入
   * （年费用户每月都在贡献收入）。若 where 卡 start_at >= windowStart，
   * 会把整批跨界订阅漏掉 —— 表现为「老用户越多、报表营收越低」，
   * 是个方向明确但极难自查的错。
   */
  const rows = await prisma.activity_subscriptions.findMany({
    where: {
      // 排除肯定无交集的：end_at <= 窗口起 或 start_at >= 窗口止
      start_at: { lt: windowEnd },
      end_at: { gt: windowStart },
    },
    select: {
      id: true,
      subscription_no: true,
      tier: true,
      status: true,
      price_fen: true,
      start_at: true,
      end_at: true,
    },
    orderBy: { id: 'asc' },
    take: 20_000,
  });

  if (rows.length >= 20_000) {
    log.warn(
      { event: 'revenue-row-cap-hit', rowCount: rows.length },
      '订阅取数触及 2 万行上限，报表可能不完整；需评估分页或预聚合',
    );
  }

  const mapped: RevenueSubscriptionRow[] = rows.map((r) => ({
    id: r.id,
    subscriptionNo: r.subscription_no,
    tier: r.tier as RevenueTier,
    status: r.status as RevenueStatus,
    priceFen: r.price_fen,
    startAt: r.start_at,
    endAt: r.end_at,
  }));

  const agg = aggregateRevenue(mapped, windowStart, windowEnd);
  const detailSlice = agg.details.slice(0, DETAIL_LIMIT);
  // 🔴 保守判据：取满上限即视为可能截断。可能误报（正好 N 条），绝不漏报。
  //   判据方向选错时代价对称 —— 这条适用于所有「上限类」标记。
  const detailTruncated = agg.details.length >= DETAIL_LIMIT;

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowDays: Math.floor((windowEnd.getTime() - windowStart.getTime()) / 86_400_000),
    byTier: agg.byTier,
    summary: {
      totalAmountFen: agg.summary.totalAmountFen.toString(),
      paidCount: agg.summary.paidCount,
      freeCount: agg.summary.freeCount,
      avgPriceFen: agg.summary.avgPriceFen === null ? null : agg.summary.avgPriceFen.toString(),
      excludedCount: agg.summary.excludedCount,
    },
    trend: buildMonthlyTrend(mapped, months, windowEnd),
    excludedReasons: agg.excludedReasons,
    details: detailSlice.map((d) => ({
      subscriptionNo: d.subscriptionNo,
      tier: d.tier,
      status: d.status,
      priceFen: d.priceFen.toString(),
      proratedFen: d.proratedFen.toString(),
      counted: d.counted,
      reason: d.reason,
      totalDays: Number(d.totalDays),
      overlapDays: Number(d.overlapDays),
    })),
    accountingNote: '订阅收入为独立科目，不进陪聊分账池（PRD §5 / Q8）；与分账报表分别对账。',
    detailTruncated,
  };
}