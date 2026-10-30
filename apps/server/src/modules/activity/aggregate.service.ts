// ============================================================================
// 邻伴 · 健康活动感知 · 日聚合与留存清理（service 层，架构 §13.7 / PRD 红线⑥）
// ----------------------------------------------------------------------------
// 两个 cron 处理器：
//   1. sweepDailyAggregate —— 昨日信号 → activity_daily_summary（日聚合）
//   2. sweepRetention—— 清理超期未聚合原始特征（≤14 天硬红线），写 audit_logs
//
// 为什么日聚合要单独一层：activity_signals 是高频原始特征（红线不出户），
// activity_daily_summary 是对外唯一读源（红线③的代码级落点）。
// **只此一处**从 signals 读 features，其余读路径一律走聚合表。
//
// 分级纪律：置信度经 domain 的 computeConfidence（单通道上限 0.6），
// **不因单通道而输出健康结论**；is_reference_only 恒true。
// ============================================================================

import { activity_consent_status, activity_purge_status, Prisma } from '@prisma/client';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { classifyActivityStatus, computeConfidence } from '../../domain/activity';
import type { ActivityWindowStats } from '../../domain/activity';

const log = moduleLogger('activity');

/** 硬红线：原始特征留存上限 14 天，配置调大也按 14 截断 */
const RETENTION_HARD_CAP_DAYS = 14;

/**
 * 信号特征（activity_signals.features 的 JSON 形状，宽松解析）。
 * 未知字段一律忽略——features 的白名单在 ingest 侧已把关。
 */
interface StoredFeatures {
  windowMinutes?: number;
  activeMinutes?: number;
  networkSwitchCount?: number;
  connectionStability?: number;
  activityCount?: number;
  [k: string]: unknown;
}

function parseFeatures(raw: unknown): StoredFeatures {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as StoredFeatures;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? (p as StoredFeatures) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** 日聚合单个老人的统计结果 */
interface DailyAgg {
  status: 'ACTIVE' | 'LOW' | 'STILL' | 'AWAY' | 'UNKNOWN';
  confidence: number;
  freshnessMinutes: number;
  activeSlots: Array<{ hour: number; level: number }>;
  activityScore: number;
  stillCount: number;
  awayCount: number;
  homeDwellMinutes: number;
  signalCount: number;
  deviceCount: number;
  channelMask: number;
}

/**
 * 把某老人某日的全部信号聚合成一行。
 * 判定口径：
 *   · 当日活跃分钟之和/ 窗口分钟之和 = 活跃占比 → 主判定；
 *   · 有away 证据（全天无活跃）→ AWAY；
 *   · 无有效信号 / 探针离线 → UNKNOWN（不猜测）。
 */
export function aggregateSignals(args: {
  signals: Array<{
    window_start: Date;
    window_minutes: number;
    features: unknown;
    data_freshness_seconds: number;
    channel: string;
    device_id: bigint | null;
    probeOnline: boolean;
  }>;
  ttlSec: number;
}): DailyAgg {
  const empty: DailyAgg = {
    status: 'UNKNOWN',
    confidence: 0,
    freshnessMinutes: 0,
    activeSlots: [],
    activityScore: 0,
    stillCount: 0,
    awayCount: 0,
    homeDwellMinutes: 0,
    signalCount: 0,
    deviceCount: 0,
    channelMask: 0,
  };
  if (args.signals.length === 0) return empty;

  // 离线探针优先：任何离线信号 → UNKNOWN（不混用过期数据）
  if (args.signals.some((s) => !s.probeOnline)) {
    return { ...empty, signalCount: args.signals.length };
  }

  let activeMinutes = 0;
  let windowMinutes = 0;
  let switchCount = 0;
  let stabilitySum = 0;
  let activityCountSum = 0;
  let freshnessMax = 0;
  const devices = new Set<string>();
  let channelMask = 0;
  // 有效特征信号数：**区分「零活跃」与「无数据」**——
  // features 全脏/null 时无任何正面证据表明人在家，必须落 UNKNOWN 而不是 AWAY。
  let validFeatureSignals = 0;

  for (const s of args.signals) {
    const f = parseFeatures(s.features);
    // 有任一可解析的数值特征即视为有效信号
    if (Object.keys(f).length > 0) validFeatureSignals += 1;
    activeMinutes += Number(f.activeMinutes ?? 0);
    windowMinutes += Number(f.windowMinutes ?? s.window_minutes ?? 0);
    switchCount += Number(f.networkSwitchCount ?? 0);
    stabilitySum += Number(f.connectionStability ?? 0);
    activityCountSum += Number(f.activityCount ?? 0);
    freshnessMax = Math.max(freshnessMax, s.data_freshness_seconds);
    if (s.device_id !== null) devices.add(s.device_id.toString());
    if (s.channel === 'CHANNEL_A_APP') channelMask |= 1;
    else if (s.channel === 'CHANNEL_B_GATEWAY') channelMask |= 2;
  }

  const n = args.signals.length;
  const stats: ActivityWindowStats = {
    windowMinutes,
    activeMinutes,
    networkSwitchCount: switchCount,
    connectionStability: n > 0 ? stabilitySum / n : 0.5,
    activityCount: activityCountSum,
    // 无BSSID 证据时置null（不猜测在家/离家）——离家由「全天零活跃」判定
    atHomeBssid: null,
  };

  const graded = classifyActivityStatus({
    stats,
    freshnessSec: freshnessMax,
    probeOnline: true,
    signalTtlSec: args.ttlSec,
  });
  const channelCount = (channelMask & 1 ? 1 : 0) + (channelMask & 2 ? 1 : 0);
  const confidence = computeConfidence({
    freshnessSec: freshnessMax,
    signalTtlSec: args.ttlSec,
    channelCount,
    crossVerified: channelCount >= 2,
  });

  // 全天零活跃 → 视为外出/离线（AWAY）。
  // 必须同时满足三条，缺一即回落 UNKNOWN（红线：不得用缺数据断言「外出」）：
  //   ① 探针在线（上面已拦截）；② 至少一条有效特征信号；③ 有窗口时长。
  const hasPositiveEvidence = validFeatureSignals > 0 && windowMinutes > 0;
  const zeroActive = hasPositiveEvidence && activeMinutes === 0;
  const awayCount = zeroActive ? 1 : 0;
  const status =
    zeroActive && graded.status === 'STILL'
      ? ('AWAY' as const)
      : hasPositiveEvidence
        ? graded.status
        : ('UNKNOWN' as const);

  // 24 段活跃分布（把窗口按小时摊到段上——聚合，非实时轨迹）
  const hourBuckets = new Array<number>(24).fill(0);
  if (windowMinutes > 0) {
    for (const s of args.signals) {
      const f = parseFeatures(s.features);
      const am = Number(f.activeMinutes ?? 0);
      const hour = s.window_start.getUTCHours();
      hourBuckets[hour] = (hourBuckets[hour] ?? 0) + am;
    }
  }

  return {
    status: status as DailyAgg['status'],
    confidence,
    freshnessMinutes: Math.round(freshnessMax / 60),
    activeSlots: hourBuckets.map((level, hour) => ({ hour, level })),
    activityScore: activeMinutes,
    stillCount: status === 'STILL' ? 1 : 0,
    awayCount,
    homeDwellMinutes: activeMinutes,
    signalCount: n,
    deviceCount: devices.size,
    channelMask,
  };
}

/**
 * 日聚合 sweep：把指定日期的信号聚合成 activity_daily_summary。
 * @param date 聚合日期（UTC 零点），默认昨日
 */
export async function sweepDailyAggregate(date = yesterdayUtc()): Promise<{
  date: string;
  processed: number;
  upserted: number;
}> {
  const ttlSec = await getConfigInt('activity_signal_ttl', 21600);
  const end = new Date(date.getTime() + 86400000);

  const signals = await prisma.activity_signals.findMany({
    where: { window_start: { gte: date, lt: end } },
    orderBy: { window_start: 'asc' },
    select: {
      elder_user_id: true,
      window_start: true,
      window_minutes: true,
      features: true,
      data_freshness_seconds: true,
      channel: true,
      device_id: true,
    },
  });
  if (signals.length === 0) {
    return { date: isoDate(date), processed: 0, upserted: 0 };
  }

  // 设备在线态（离线探针的信号不参与聚合 → 落UNKNOWN）
  const deviceIds = [...new Set(signals.map((s) => s.device_id).filter((x): x is bigint => x !== null))];
  const devices = deviceIds.length
    ? await prisma.wifi_devices.findMany({
        where: { id: { in: deviceIds } },
        select: { id: true, status: true, collect_enabled: true },
      })
    : [];
  const deviceMap = new Map(devices.map((d) => [d.id.toString(), d]));

  // 按老人分组
  const byElder = new Map<string, typeof signals>();
  for (const s of signals) {
    const k = s.elder_user_id.toString();
    const cur = byElder.get(k);
    if (!cur) byElder.set(k, [s]);
    else cur.push(s);
  }

  let upserted = 0;
  for (const [elderKey, group] of byElder) {
    const withProbe = group.map((s) => {
      const d = s.device_id !== null ? deviceMap.get(s.device_id.toString()) : undefined;
      return {
        window_start: s.window_start,
        window_minutes: s.window_minutes,
        features: s.features,
        data_freshness_seconds: s.data_freshness_seconds,
        channel: s.channel,
        device_id: s.device_id,
        probeOnline: d ? d.status === 'ONLINE' && d.collect_enabled : true,
      };
    });
    const agg = aggregateSignals({ signals: withProbe, ttlSec });
    await prisma.activity_daily_summary.upsert({
      where: {
        elder_user_id_summary_date: {
          elder_user_id: BigInt(elderKey),
          summary_date: date,
        },
      },
      create: {
        elder_user_id: BigInt(elderKey),
        summary_date: date,
        status: agg.status,
        status_confidence: Math.round(agg.confidence * 100),
        data_freshness_minutes: agg.freshnessMinutes,
        active_slots: agg.activeSlots as never,
        activity_score: agg.activityScore,
        still_count: agg.stillCount,
        away_count: agg.awayCount,
        home_dwell_minutes: agg.homeDwellMinutes,
        signal_count: agg.signalCount,
        device_count: agg.deviceCount,
        channel_mask: agg.channelMask,
        is_reference_only: true, // 红线⑤恒真
        computed_at: new Date(),
      },
      update: {
        status: agg.status,
        status_confidence: Math.round(agg.confidence * 100),
        data_freshness_minutes: agg.freshnessMinutes,
        active_slots: agg.activeSlots as never,
        activity_score: agg.activityScore,
        still_count: agg.stillCount,
        away_count: agg.awayCount,
        home_dwell_minutes: agg.homeDwellMinutes,
        signal_count: agg.signalCount,
        device_count: agg.deviceCount,
        channel_mask: agg.channelMask,
        is_reference_only: true,
        computed_at: new Date(),
      },
    });
    upserted += 1;
  }

  log.info({ event: 'activity-daily-aggregate', date: isoDate(date), upserted, processed: byElder.size }, '活动日聚合完成');
  return { date: isoDate(date), processed: byElder.size, upserted };
}

/**
 * 留存清理 sweep（红线⑥：原始特征 ≤14 天）。
 * · 清理的是 `features` JSON 与网络标识 HMAC（置 NULL），**保留行与窗口元数据**
 *   ——行级证据（何时采过、有没有采）仍有审计价值，清掉反而不利于追溯；
 * · 每批写 audit_logs（module=activity，action=purge_signals）；
 * · 清理完成后把对应 consents 的清理确认态回写（A4）。
 */
export async function sweepRetention(now = new Date()): Promise<{
  purgedSignals: number;
  purgedConsents: number;
}> {
  const cfgDays = await getConfigInt('activity_signal_retention_days', 14);
  const days = Math.min(cfgDays, RETENTION_HARD_CAP_DAYS);

  // 1) 清未聚合原始特征
  const expired = await prisma.activity_signals.findMany({
    where: { retained_until: { lte: now }, purged_at: null },
    select: { id: true, elder_user_id: true },
    take: 5000,
  });
  let purgedSignals = 0;
  if (expired.length > 0) {
    const r = await prisma.activity_signals.updateMany({
      where: { id: { in: expired.map((e) => e.id) }, purged_at: null },
      data: {
        purged_at: now,
        features: Prisma.JsonNull,
        ssid_hmac: null,
        bssid_hmac: null,
      },
    });
    purgedSignals = r.count;
    await prisma.audit_logs.create({
      data: {
        action: 'purge_activity_signals',
        module: 'activity',
        target_type: 'activity_signals',
        target_id: `${expired.length} rows`,
        before_json: { pendingCount: expired.length, retentionDays: days },
        after_json: { purgedCount: purgedSignals, purgedAt: now.toISOString() },
      },
    });
  }

  // 2) 回写授权侧的清理确认态（A4：撤销与清理解耦，此处是「解耦」的收口）
  const consents = await prisma.activity_consents.findMany({
    where: {
      status: activity_consent_status.REVOKED,
      purge_status: {
        in: [
          activity_purge_status.NOT_STARTED,
          activity_purge_status.RUNNING,
          activity_purge_status.FAILED,
        ],
      },
    },
    select: { id: true, elder_user_id: true, purge_status: true },
    take: 2000,
  });
  let purgedConsents = 0;
  for (const c of consents) {
    // 该老人名下的未清理信号是否已全部清完
    const remaining = await prisma.activity_signals.count({
      where: { elder_user_id: c.elder_user_id, purged_at: null, retained_until: { lte: now } },
    });
    const done = remaining === 0;
    await prisma.activity_consents.update({
      where: { id: c.id },
      data: done
        ? { purge_status: activity_purge_status.CONFIRMED, unaggregated_purged_at: now, purge_error: null }
        : { purge_status: activity_purge_status.RUNNING },
    });
    if (done) purgedConsents += 1;
  }

  if (purgedSignals > 0 || purgedConsents > 0) {
    log.info(
      { event: 'activity-retention-sweep', purgedSignals, purgedConsents, retentionDays: days },
      '留存清理完成',
    );
  }
  return { purgedSignals, purgedConsents };
}

/** 昨日 UTC 零点 */
function yesterdayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 读配置整数（DB 优先回落默认） */
async function getConfigInt(key: string, fallback: number): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  const n = row ? Number(row.config_value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}