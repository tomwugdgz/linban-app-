// ============================================================================
// 邻伴 · 健康活动感知 · 活动查询（service 层，架构 §13 / PRD 红线⑤）
// ----------------------------------------------------------------------------
// 纪律：
//   · **只出聚合，不出原始特征**——本文件不查 activity_signals 的 features；
//     日报/趋势只读 activity_daily_summary（红线③原始特征不出户）；
//   · **强制携带 disclaimer**（"参考指标，非医疗诊断"）——DB 的 is_reference_only
//     为false 时（异常数据）也不得输出结论，一律降级为 UNKNOWN + disclaimer；
//   · **不出健康诊断结论**——只返回五级状态 + 置信度 + 新鲜度 + explain_code，
//     且置信度来自 domain 的 computeConfidence（单通道上限 0.6）；
//   · 数据未积累（<3 天）→ 23001，不硬凑结论。
// ============================================================================

import { AppError } from '@linban/shared';
import type { activity_status } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { computeConfidence } from '../../domain/activity';
import type { ActivityWindowStats } from '../../domain/activity';

const log = moduleLogger('activity');

/** 红线⑤统一文案（服务端下发，端上不得隐藏） */
export const ACTIVITY_DISCLAIMER = '以上为参考指标，非医疗诊断。如有不适请及时就医。';

/** 数据就绪所需的最少有效天数（PRD：3–7 天积累窗口，取下限 3） */
export const MIN_SIGNAL_DAYS = 3;

/** 置信度展示下限（低于此值仅回分级与依据码，23002） */
export const CONFIDENCE_DISPLAY_FLOOR = 0.3;

/** 日报出参（契约 §13.3） */
export interface DailyReport {
  date: string;
  status: activity_status;
  /** 置信度 0–1（domain 口径；schema 存 0–100，出参统一 0–1） */
  confidence: number;
  /** 数据新鲜度（分钟） */
  freshnessMinutes: number;
  /** 依据码（可审计） */
  explainCode: string;
  /** 活跃时段分布（24 段聚合，非实时轨迹） */
  activeSlots: Array<{ hour: number; level: number }>;
  activityScore: number;
  stillCount: number;
  awayCount: number;
  homeDwellMinutes: number;
  signalCount: number;
  channelMask: number;
  disclaimer: string;
}

/** 趋势出参（契约 §13.3） */
export interface TrendReport {
  from: string;
  to: string;
  days: number;
  list: Array<{
    date: string;
    status: activity_status;
    confidence: number;
    activityScore: number;
    stillCount: number;
    awayCount: number;
  }>;
  disclaimer: string;
}

/** 通道位图 → 通道数（bit0=A, bit1=B） */
function channelCountOf(channelMask: number): number {
  let n = 0;
  if (channelMask & 1) n += 1;
  if (channelMask & 2) n += 1;
  return n;
}

/**
 * 由日聚合行还原 domain 分级入参（活跃分布 → 窗口统计）。
 * 说明：日聚合是「按日聚合」而非「按窗」，此处用当日分布反推窗口统计量，
 * 是**聚合层复用domain 分级**的做法——不引入第二套判定逻辑。
 */
export function statsFromSummary(row: {
  active_slots: unknown;
  activity_score: number;
  still_count: number;
  away_count: number;
}): ActivityWindowStats {
  const slots = Array.isArray(row.active_slots)
    ? (row.active_slots as Array<{ hour: number; level: number }>)
    : [];
  const activeMinutes = slots.reduce((sum, s) => sum + (Number(s.level) || 0), 0);
  const windowMinutes = slots.length > 0 ? slots.length * 60 : 1440;
  return {
    windowMinutes,
    activeMinutes,
    // 活跃时段数= 有活动的 1 小时段数（网络切换次数的聚合近似）
    networkSwitchCount: slots.filter((s) => (Number(s.level) || 0) > 0).length,
    // 无连接稳定性原始值时用「有分布数据」作为稳定性代理
    connectionStability: slots.length > 0 ? 0.8 : 0.5,
    activityCount: row.activity_score,
    // away_count>0 且无活跃分布 → 视为离家；否则未知（不猜测）
    atHomeBssid: row.away_count > 0 && activeMinutes === 0 ? false : null,
  };
}

/**
 * 日报（契约 §13.3 GET /activity/report/daily）。
 * 数据未积累 → 23001；无记录 → 23005。
 */
export async function getDailyReport(
  elderUserId: bigint,
  date: Date,
  ttlSec: number,
): Promise<DailyReport> {
  const row = await prisma.activity_daily_summary.findUnique({
    where: { elder_user_id_summary_date: { elder_user_id: elderUserId, summary_date: date } },
  });
  if (!row) {
    const ready = await prisma.activity_daily_summary.count({
      where: { elder_user_id: elderUserId, signal_count: { gt: 0 } },
    });
    if (ready < MIN_SIGNAL_DAYS) {
      throw new AppError(23001, '感知数据尚未就绪（需 3–7 天积累），暂不展示结论');
    }
    throw new AppError(23005, '暂无活动日报');
  }

  // 红线⑤：异常数据（is_reference_only=false）一律不出结论
  const degraded = row.is_reference_only === false;
  const stats = statsFromSummary(row);
  const confidence = degraded
    ? 0
    : computeConfidence({
        freshnessSec: row.data_freshness_minutes * 60,
        signalTtlSec: ttlSec,
        channelCount: channelCountOf(row.channel_mask),
        crossVerified: channelCountOf(row.channel_mask) >= 2,
      });

  // 置信度不足：仅回分级与依据码，不出趋势结论（23002 由路由层判定是否抛）
  return {
    date: row.summary_date.toISOString().slice(0, 10),
    status: degraded ? 'UNKNOWN' : row.status,
    confidence,
    freshnessMinutes: row.data_freshness_minutes,
    explainCode: degraded ? 'DATA_NOT_REFERENCE_ONLY' : explainOf(row.status),
    activeSlots: Array.isArray(row.active_slots)
      ? (row.active_slots as Array<{ hour: number; level: number }>)
      : [],
    activityScore: row.activity_score,
    stillCount: row.still_count,
    awayCount: row.away_count,
    homeDwellMinutes: row.home_dwell_minutes,
    signalCount: row.signal_count,
    channelMask: row.channel_mask,
    disclaimer: ACTIVITY_DISCLAIMER,
  };
}

/** 依据码映射（与 domain/activity.ts 的 ACTIVITY_EXPLAIN 语义一致） */
function explainOf(status: activity_status): string {
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

/**
 * 趋势（契约 §13.3 GET /activity/report/trend）。
 * 非法范围 → 23003；数据未就绪 → 23001。
 */
export async function getTrendReport(
  elderUserId: bigint,
  from: Date,
  days: number,
  ttlSec: number,
): Promise<TrendReport> {
  if (days <= 0 || days > 90) {
    throw new AppError(23003, '日期范围不合法（days 需在 1–90 之间）');
  }
  const to = new Date(from.getTime() + (days - 1) * 86400000);
  const rows = await prisma.activity_daily_summary.findMany({
    where: { elder_user_id: elderUserId, summary_date: { gte: from, lte: to } },
    orderBy: { summary_date: 'asc' },
  });
  if (rows.length < MIN_SIGNAL_DAYS) {
    throw new AppError(23001, '感知数据尚未就绪（需 3–7 天积累），暂不展示结论');
  }
  log.debug({ event: 'activity-trend', elder: String(elderUserId), rows: rows.length }, '活动趋势查询');

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days,
    list: rows.map((r) => ({
      date: r.summary_date.toISOString().slice(0, 10),
      status: r.is_reference_only === false ? ('UNKNOWN' as activity_status) : r.status,
      confidence:
        r.is_reference_only === false
          ? 0
          : computeConfidence({
              freshnessSec: r.data_freshness_minutes * 60,
              signalTtlSec: ttlSec,
              channelCount: channelCountOf(r.channel_mask),
              crossVerified: channelCountOf(r.channel_mask) >= 2,
            }),
      activityScore: r.activity_score,
      stillCount: r.still_count,
      awayCount: r.away_count,
    })),
    disclaimer: ACTIVITY_DISCLAIMER,
  };
}