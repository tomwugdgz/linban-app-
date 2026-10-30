// ============================================================================
// 邻伴 · 健康活动感知 · 后台读侧装配（service 层，架构 §13 / 契约 §13.6）
// ----------------------------------------------------------------------------
// 三个后台只读聚合：老人活动列表 / 健康看板 / 引流漏斗。
//
// 出参五件套纪律（红线⑤的接口侧落实，**每个含状态/结论的出参都带**）：
//   status + confidence + freshnessSec + explainCode + disclaimer
//   ——「参考指标，非医疗诊断」不是文案装饰，是出参结构的一部分。
//
// 视觉分区硬约束（team-lead 裁定）：UNKNOWN 与信号过期**必须单独分区**，
// 禁止与正常状态混排。故本文件为每行输出 `needsAttention: boolean`
// 与 `partition: 'NORMAL' | 'UNKNOWN_OR_STALE'`，由端上分区渲染。
//
// 注：A7 已落点 —— `elder_profiles.community_id` → `communities.community_name`，
// 「所属社区」已真读。**为 null 是正常业务态**（老人档案可能没填社区），
// 服务端不兜假值（兜了会让运营据此误投放），端上显示「未关联社区」中性灰。
// ============================================================================

import { AppError } from '@linban/shared';
import type { activity_status } from '@linban/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { computeConfidence } from '../../domain/activity';
import { ACTIVITY_DISCLAIMER } from './report.service';

const log = moduleLogger('activity');

/** 依据码中文释义（契约 §13.6 elders 端点要求：出参含 explainCode 中文释义） */
export const EXPLAIN_LABELS: Record<string, string> = {
  ACTIVE_HIGH: '活跃：特征充分且连接稳定',
  STILL_NO_MOTION: '久静：几乎无活动且网络稳定',
  LOW_ACTIVITY: '低活跃：活动量低于常态',
  AWAY_CONFIRMED: '外出：未匹配到家庭网络',
  PROBE_OFFLINE: '探针离线：数据不可信，已回落未知',
  SIGNAL_EXPIRED: '信号过期：数据超过有效期，已回落未知',
  INSUFFICIENT_DATA: '数据不足：采集窗口过短或特征缺失',
  DATA_NOT_REFERENCE_ONLY: '数据异常：已按参考指标降级处理',
};

/** 通道位图 → 通道数 */
function channelCountOf(mask: number): number {
  return (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0);
}

/** 单行老人活动视图（契约 §13.6 elders 出参） */
export interface ElderActivityRow {
  elderUserId: string;
  /** 昵称（脱敏：仅昵称，不含手机号/证件） */
  nickname: string;
  /** 所属社区（老人档案暂无该字段，恒 null 待 A7） */
  community: string | null;
  status: activity_status;
  confidence: number;
  /** 数据新鲜度（分钟） */
  freshnessMinutes: number;
  /** 信号是否已过期（超activity_signal_ttl） */
  stale: boolean;
  explainCode: string;
  /** explainCode 中文释义（端上直接展示，避免各自造词） */
  explainLabel: string;
  /** 视觉分区标记：UNKNOWN 或过期 → 独立分区，禁止与正常混排 */
  partition: 'NORMAL' | 'UNKNOWN_OR_STALE';
  needsAttention: boolean;
  lastSignalAt: string | null;
  summaryDate: string;
  /** 近 7 日 sparkline（活动量指数序列，升序；不足 7 日按实际天数） */
  sparkline: Array<{ date: string; activityScore: number; status: activity_status }>;
  disclaimer: string;
}

/**
 * 后台老人活动列表（契约 §13.6 GET /admin/activity/elders）。
 * 筛选：status（可多选）/ stale（是否过期）/ days（sparkline 天数，上限 30）。
 *
 * 实现口径：以 activity_daily_summary 为准（**不查原始特征**，红线③），
 * 每位老人取最近一条聚合行。
 */
export async function listElderActivities(opts: {
  statuses?: activity_status[];
  stale?: boolean;
  days?: number;
  page?: number;
  pageSize?: number;
  ttlSec: number;
}): Promise<{ list: ElderActivityRow[]; total: number; page: number; pageSize: number }> {
  const days = Math.min(Math.max(1, opts.days ?? 7), 30);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? 20), 100);

  // 取近days 天的全部聚合行，一次查询后在内存分组（避免 N+1）
  const since = new Date(Date.now() - (days - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);
  const rows = await prisma.activity_daily_summary.findMany({
    where: { summary_date: { gte: since } },
    orderBy: [{ elder_user_id: 'asc' }, { summary_date: 'asc' }],
    include: {
      elder_user: {
        select: {
          id: true,
          nickname: true,
          // A7 已落点：老人档案→社区。**为 null 是正常业务态**（档案可能没填社区），
          // 服务端**不兜假值** —— 前端会显示「未关联社区」的中性灰。
          // 兜一个假社区名会让运营以为该老人属于某小区，据此投放是错的。
          elder_profile: { select: { community: { select: { community_name: true } } } },
        },
      },
    },
  });

  // 分组：每老人一份（最新行 + sparkline）
  const byElder = new Map<
    string,
    { latest: (typeof rows)[number]; series: (typeof rows)[number][] }
  >();
  for (const r of rows) {
    const key = r.elder_user_id.toString();
    const cur = byElder.get(key);
    if (!cur) byElder.set(key, { latest: r, series: [r] });
    else cur.series.push(r);
  }

  let list: ElderActivityRow[] = [];
  for (const [, { latest, series }] of byElder) {
    const confidence = computeConfidence({
      freshnessSec: latest.data_freshness_minutes * 60,
      signalTtlSec: opts.ttlSec,
      channelCount: channelCountOf(latest.channel_mask),
      crossVerified: channelCountOf(latest.channel_mask) >= 2,
    });
    const stale = latest.data_freshness_minutes * 60 > opts.ttlSec;
    const isUnknown = latest.status === 'UNKNOWN' || latest.is_reference_only === false;
    const partition: ElderActivityRow['partition'] =
      isUnknown || stale ? 'UNKNOWN_OR_STALE' : 'NORMAL';

    const row: ElderActivityRow = {
      elderUserId: latest.elder_user_id.toString(),
      nickname: latest.elder_user.nickname,
      community: latest.elder_user.elder_profile?.community?.community_name ?? null,
      status: isUnknown ? 'UNKNOWN' : latest.status,
      confidence: isUnknown ? 0 : confidence,
      freshnessMinutes: latest.data_freshness_minutes,
      stale,
      explainCode: isUnknown && latest.is_reference_only === false
        ? 'DATA_NOT_REFERENCE_ONLY'
        : explainCodeOf(latest.status),
      explainLabel: '',
      partition,
      needsAttention: isUnknown || stale || latest.status === 'STILL' || latest.status === 'LOW',
      lastSignalAt: latest.computed_at?.toISOString() ?? null,
      summaryDate: latest.summary_date.toISOString().slice(0, 10),
      sparkline: series.map((s) => ({
        date: s.summary_date.toISOString().slice(0, 10),
        activityScore: s.activity_score,
        status: s.is_reference_only === false ? ('UNKNOWN' as activity_status) : s.status,
      })),
      disclaimer: ACTIVITY_DISCLAIMER,
    };
    row.explainLabel = EXPLAIN_LABELS[row.explainCode] ?? '状态依据码';
    list.push(row);
  }

  // 筛选：状态多选 + 是否过期
  if (opts.statuses && opts.statuses.length > 0) {
    const set = new Set(opts.statuses);
    list = list.filter((r) => set.has(r.status));
  }
  if (typeof opts.stale === 'boolean') {
    list = list.filter((r) => r.stale === opts.stale);
  }

  const total = list.length;
  const start = (page - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total, page, pageSize };
}

/** 状态 → 依据码（与 domain/activity.ts 的 ACTIVITY_EXPLAIN 一致） */
function explainCodeOf(status: activity_status): string {
  switch (status) {
    case 'ACTIVE':
      return 'ACTIVE_HIGH';
    case 'STILL':
      return 'STILL_NO_MOTION';
    case 'AWAY':
      return 'AWAY_CONFIRMED';
    case 'LOW':
      return 'LOW_ACTIVITY';
    default:
      return 'INSUFFICIENT_DATA';
  }
}

/** 健康看板出参（契约 §13.6 dashboard 字段清单） */
export interface ActivityDashboard {
  /** 在管老人数（有感知数据的老人） */
  managedElderCount: number;
  probeOnlineCount: number;
  probeOfflineCount: number;
  probeUnknownCount: number;
  /** 紧急未处置告警数（P0 口径：URGENT 且未 ACKNOWLEDGED/RESOLVED） */
  urgentUnhandledCount: number;
  todayAlertUnhandled: number;
  todayAlertHandled: number;
  todayAlertDismissed: number;
  /** 平均处置时长（分钟；无已处置告警时为 null，不填 0 假装快） */
  avgHandleMinutes: number | null;
  /** 近 7 日趋势序列 */
  trend: Array<{
    date: string;
    activeCount: number;
    lowCount: number;
    stillCount: number;
    awayCount: number;
    unknownCount: number;
  }>;
  /** 24 时段活跃分布（聚合，非实时轨迹） */
  activeSlots: Array<{ hour: number; level: number }>;
  statusDistribution: Record<string, number>;
  disclaimer: string;
}

/** 健康看板（契约 §13.6 GET /admin/activity/dashboard） */
export async function getDashboard(ttlSec: number): Promise<ActivityDashboard> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since7 = new Date(today.getTime() - 6 * 86400000);
  const since7Str = since7.toISOString().slice(0, 10);

  const [managed, devices, alerts7, urgentUnhandled, handledAgg, summaries7, slotAgg] =
    await Promise.all([
      prisma.activity_daily_summary.groupBy({
        by: ['elder_user_id'],
        where: { summary_date: { gte: since7 } },
        _count: { _all: true },
      }),
      prisma.wifi_devices.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.health_alerts.groupBy({
        by: ['status', 'level', 'triggered_at'],
        where: { triggered_at: { gte: since7 } },
        _count: { _all: true },
      }),
      prisma.health_alerts.count({
        where: { level: 'URGENT', status: { in: ['OPEN', 'ACKNOWLEDGED', 'PROCESSING'] } },
      }),
      prisma.health_alerts.findMany({
        where: { handled_at: { not: null }, triggered_at: { gte: since7 } },
        select: { triggered_at: true, handled_at: true },
        take: 1000,
      }),
      prisma.activity_daily_summary.findMany({
        where: { summary_date: { gte: since7 } },
        select: { summary_date: true, status: true, active_slots: true },
      }),
      prisma.activity_daily_summary.findMany({
        where: { summary_date: { gte: since7 }, active_slots: { not: Prisma.DbNull } },
        select: { active_slots: true },
        take: 2000,
      }),
    ]);

  // 设备在线率三态
  const byStatus = new Map(devices.map((d) => [d.status, d._count._all]));
  const online = byStatus.get('ONLINE') ?? 0;
  const offline = byStatus.get('OFFLINE') ?? 0;
  const probeTotal = devices.reduce((a, d) => a + d._count._all, 0);

  // 今日告警三态
  const todayAlerts = alerts7.filter((a) => a.triggered_at >= today);
  const handled = (s: string) => ['ACKNOWLEDGED', 'PROCESSING', 'RESOLVED', 'ESCALATED'].includes(s);
  const dismissed = (s: string) => s === 'DISMISSED';

  // 平均处置时长（分钟）
  const durations = handledAgg
    .filter((a) => a.handled_at)
    .map((a) => (a.handled_at!.getTime() - a.triggered_at.getTime()) / 60000)
    .filter((m) => m >= 0);
  const avgHandleMinutes = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 100) / 100
    : null;

  // 近 7 日趋势（按日聚合状态分布）
  // 显式类型：不给的话 Map 初始值会被推断成含 undefined 的宽松形状
  type TrendBucket = {
    activeCount: number;
    lowCount: number;
    stillCount: number;
    awayCount: number;
    unknownCount: number;
  };
  const emptyBucket = (): TrendBucket => ({
    activeCount: 0,
    lowCount: 0,
    stillCount: 0,
    awayCount: 0,
    unknownCount: 0,
  });
  const trendMap = new Map<string, TrendBucket>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(since7.getTime() + i * 86400000).toISOString().slice(0, 10);
    trendMap.set(d, emptyBucket());
  }
  for (const s of summaries7) {
    const d = s.summary_date.toISOString().slice(0, 10);
    const bucket = trendMap.get(d);
    if (!bucket) continue;
    // 显式 switch：状态枚举扩容时不会静默漏计（索引映射做不到这点）
    switch (s.status) {
      case 'ACTIVE':
        bucket.activeCount += 1;
        break;
      case 'LOW':
        bucket.lowCount += 1;
        break;
      case 'STILL':
        bucket.stillCount += 1;
        break;
      case 'AWAY':
        bucket.awayCount += 1;
        break;
      default:
        bucket.unknownCount += 1;
        break;
    }
  }

  // 24 时段分布（内存累加，避免 JSON 聚合 SQL）
  const hourSum = new Array<number>(24).fill(0);
  for (const s of slotAgg) {
    const slots = Array.isArray(s.active_slots) ? (s.active_slots as Array<{ hour: number; level: number }>) : [];
    for (const sl of slots) {
      const h = Number(sl.hour);
      const level = Number(sl.level) || 0;
      if (Number.isInteger(h) && h >= 0 && h < 24) hourSum[h] = (hourSum[h] ?? 0) + level;
    }
  }

  const statusDistribution: Record<string, number> = {};
  for (const s of summaries7) {
    statusDistribution[s.status] = (statusDistribution[s.status] ?? 0) + 1;
  }

  log.debug({ event: 'activity-dashboard', managed: managed.length }, '健康活动看板');

  return {
    managedElderCount: managed.length,
    probeOnlineCount: online,
    probeOfflineCount: offline,
    probeUnknownCount: Math.max(0, probeTotal - online - offline),
    urgentUnhandledCount: urgentUnhandled,
    todayAlertUnhandled: todayAlerts.filter((a) => !handled(a.status) && !dismissed(a.status)).length,
    todayAlertHandled: todayAlerts.filter((a) => handled(a.status)).length,
    todayAlertDismissed: todayAlerts.filter((a) => dismissed(a.status)).length,
    avgHandleMinutes,
    trend: [...trendMap.entries()].map(([date, v]) => ({ date, ...v })),
    activeSlots: hourSum.map((level, hour) => ({ hour, level })),
    statusDistribution,
    disclaimer: ACTIVITY_DISCLAIMER,
  };
}

/** 引流漏斗（契约 §13.6 GET /admin/activity/funnel，7 层 + 三维归因）
 *
 * 【channelKey 口径 —— 主理人裁定 2026-10，归属维度必须是 community_code】
 *
 * `byCommunity` 的 channelKey 取 `communities.community_code`（如 GZ_TH_HUAYING），
 * channelLabel 取 `communities.community_name`（如「天河区华颖社区」）。
 *
 * 为什么不能用别的：
 *  1. **绝不能用自增 id**：换库/重建数据 id 就变，运营的投放归因与去重口径会断。
 *  2. **绝不能用数组下标**：真接后端后社区表返回顺序由 SQL 决定（无 ORDER BY 时
 *     MySQL 不保证顺序），同一份代码在不同环境产出不同归因结果，**且这种不一致
 *     任何测试都发现不了 —— 因为每个环境里它都是自洽的**。
 *
 * 为什么必须显式 JOIN communities 而不是从别处拼：
 *  community_code 只存在于 communities 表，触点表里存的是 community_id。
 *  任何"从别处拼"的写法（从团长表拼、从配置文件读）都是第二处事实源，必漂移。
 *
 * 【ORDER BY 是口径的一部分，不是性能优化】
 * 出参顺序必须跨环境稳定，否则运营看到的两个渠道会互换位置。
 * 排序键用 community_code（稳定业务主键），不用 count（会随数据量变动）。
 *
 *未关联社区的触点归入 `UNASSIGNED` 桶（真实业务态：媒体触点可能先于档案关联落库）。
 * **不丢弃、不兜假社区名** —— 丢弃会让「未关联」看起来像「没投放」。
 */
/**
 * 🔴 归因候选集上限。
 *
 * 【为什么必须截断】社区维度需要逐条读 `community_code`（不是 groupBy source_channel，
 *   那是采集通道，语义不同），只能 findMany + 内存聚合，故必须有上限保护。
 *
 * 【危害与其它两类截断不同 —— 这是本条最要紧的一点】
 *   不是「少看几行」，而是**统计数字本身偏小**：
 *   截掉的是触点记录，聚合后**每个社区的 count 都会少算**，
 *   且看上去完全像「这个小区本来就人少」，**没有任何异常特征**。
 *   若漏斗页再配一句「尾部社区样本偏小」的提示，就等于给截断提供了完美托辞 ——
 *   运营看到数字偏小，页面已经告诉他「样本本来就小」，于是更不会怀疑数据。
 *   故必须出参显式告知（attributionTruncated），由前端决定怎么呈现，
 *   **不在服务端用日志代替**：日志只有开发方看得到，运营看不到。
 */
const ATTRIBUTION_LIMIT = 5000;

export async function getFunnel(days: number): Promise<{
  stages: Array<{ stage: string; eventType: string; count: number }>;
  /** 三维归因：社区 / 触发器 / 日期 */
  byCommunity: Array<{ channelKey: string; channelLabel: string; count: number }>;
  byTrigger: Array<{ funnelStage: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
  acquisitionCost: {
    account: string;
    totalFen: string;
    touchpointCount: number;
    note: string;
  };
  /**
   * 🔴 **归因聚合结果**可能被截断（不是「候选集被截断」）。
   *
   * 【为什么字段名是 attributionTruncated 而非 truncated】
   *   三处截断同名不同义，危害方向也不同：
   *     candidateTruncated    候选集被截 → 应用层筛 operator/keyword（危害：数字偏大）
   *     detailTruncated       明细行被截 → details.slice(0,500)（危害：少显示）
   *     attributionTruncated  归因聚合被截 → take:上限（危害：**数字偏小**）
   *   同名会被运营在接口文档里混读，故字段名必须自带语义。
   *
   * 【与orderBy 的关系 —— 两者缺一不可，置了标记不等于问题解决】
   *   截断标记只说明「样本可能被截」，不说明「截的是哪部分」。
   *   若排序键不完整，同一份数据两次查询可能返回**不同的上限条数**，
   *   那就不仅「偏小」而是**不可复现** —— 置了标记也只是让人知道「样本不确定」，
   *   不知道是哪不确定。故必须同时补稳定次级排序键（见orderBy 的 id）。
   */
  attributionTruncated: boolean;
}> {
  const windowDays = Math.min(Math.max(1, days), 90);
  const since = new Date(Date.now() - (windowDays - 1) * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const [byEvent, byCommunityRaw, byStage, byDate, cost] = await Promise.all([
    prisma.activity_touchpoints.groupBy({
      by: ['event_type', 'funnel_stage'],
      where: { touchpoint_at: { gte: since } },
      _count: { _all: true },
    }),
    // 社区维度：**显式 JOIN communities 取 community_code**。
    // 不用 groupBy(source_channel)：那是「采集通道」（数据从哪条通道上来），
    // 与「我们从哪触到用户」语义不同，不可复用同一列（schema 注释已明确）。
    prisma.activity_touchpoints.findMany({
      where: { touchpoint_at: { gte: since } },
      select: {
        community: { select: { community_code: true, community_name: true } },
      },
      // 🔴 orderBy 必须**完整**：community_code 只是分组键，**同一社区内部无序**。
      //   若无完整排序，MySQL 对`take: N` 的返回集**不保证稳定** ——
      //   同一份数据两次查询可能返回不同的 N 条 → 结果**不可复现**。
      //   这比「偏小」更严重：偏小至少方向一致，不可复现则连趋势都读不出来
      //   （今天 1200 人、明天 1180 人，无法判断是投放变化还是取数抖动）。
      //   `id` 是主键，天然唯一且与业务无关，作稳定次级排序键最合适。
      orderBy: [{ community: { community_code: 'asc' } }, { id: 'asc' }],
      take: ATTRIBUTION_LIMIT,
    }),
    prisma.activity_touchpoints.groupBy({
      by: ['funnel_stage'],
      where: { touchpoint_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.activity_touchpoints.groupBy({
      by: ['touchpoint_at'],
      where: { touchpoint_at: { gte: since } },
      _count: { _all: true },
      orderBy: { touchpoint_at: 'asc' },
      take: 500,
    }),
    prisma.activity_touchpoints.aggregate({
      where: { cost_account: 'ACQUISITION_LEAD_INCENTIVE' },
      _sum: { incentive_amount_fen: true },
      _count: { _all: true },
    }),
  ]);

  // 内存聚合（候选集上限 ATTRIBUTION_LIMIT；排序键完整，聚合后再排序亦可）
  //
  // 🔴 截断判据用「**恰好取满上限**」而非「> 上限」——
  //   因为 findMany + take 的语义是「最多返回 N 条」，返回 N 条时无法区分
  //   「正好有 N 条全部返回」与「超过 N 条被截断了」。
  //   所以 `=== N` 是**保守判据**：可能误报（正好 N 条时），但**绝不漏报**。
  //   误报的代价是前端多显示一句提示；漏报的代价是数字错了没人知道。
  //   判据方向选错时，代价是对称的—— 这条规则适用于所有「上限类」标记。
  const attributionTruncated = byCommunityRaw.length >= ATTRIBUTION_LIMIT;
  if (attributionTruncated) {
    // 打日志不代替出参：日志只有开发方看得到，运营在页面上看不到
    log.warn('funnel 归因候选集已截断，byCommunity 的 count 偏小，不可用于投放决策', {
      windowDays,
      limit: ATTRIBUTION_LIMIT,
      returned: byCommunityRaw.length,
    });
  }

  const commAgg = new Map<string, { label: string; count: number }>();
  for (const r of byCommunityRaw) {
    // 未关联社区 → UNASSIGNED 桶（真实业务态，不丢弃也不编造社区名）
    const key = r.community?.community_code ?? 'UNASSIGNED';
    const label = r.community?.community_name ?? '未关联社区';
    const cur = commAgg.get(key);
    if (cur) cur.count += 1;
    else commAgg.set(key, { label, count: 1 });
  }
  const byCommunity = [...commAgg.entries()]
    .map(([channelKey, v]) => ({ channelKey, channelLabel: v.label, count: v.count }))
    // 稳定排序：按 channelKey 字典序，UNASSIGNED 自然落在最后
    .sort((a, b) => (a.channelKey < b.channelKey ? -1 : a.channelKey > b.channelKey ? 1 : 0));

  return {
    windowDays,
    stages: byEvent.map((r) => ({
      stage: r.funnel_stage,
      eventType: r.event_type,
      count: r._count._all,
    })),
    byCommunity,

    byTrigger: byStage.map((r) => ({ funnelStage: r.funnel_stage, count: r._count._all })),
    byDate: byDate.map((r) => ({
      date: r.touchpoint_at.toISOString().slice(0, 10),
      count: r._count._all,
    })),
    acquisitionCost: {
      account: 'ACQUISITION_LEAD_INCENTIVE',
      totalFen: (cost._sum.incentive_amount_fen ?? 0).toString(),
      touchpointCount: cost._count._all,
      note: '获客成本科目，不进陪聊分账池（Q8 裁定②）',
    },
    attributionTruncated,
  };
}

/** 越权守卫：子女端可见性判定失败统一 23004（契约 §13.6.1） */
export function denyActivityRead(): AppError {
  return new AppError(23004, '无权查看该老人的健康活动数据');
}