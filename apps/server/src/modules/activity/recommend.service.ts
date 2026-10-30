// ============================================================================
// 邻伴 · 健康活动感知 · 陪聊推荐（service 层，架构 §13.9 / PRD §4）
// ----------------------------------------------------------------------------
// 这是**引流侧**的读端：把「触发了哪个引流触发器」翻译成一句给老人看的软文案。
//
// 三条纪律（不可妥协，都是踩过才知道疼的点）：
//
//  1. **给老人的文案不得暗示健康依据**。
//     依据（状态分级/置信度/下降百分比）只给子女看；给老人的文案里出现
//     「您今天活动量下降 35%」等于把健康推断直接摊到老人面前——他看到就会
//     恐慌，而这条数据本来就只是参考指标（红线⑤）。文案库（A6）已按场景
//     分档，`scene` 决定给谁看：`FAMILY_NOTICE` 给子女，其余给老人。
//
//  2. **出参强制携带 disclaimer**（参考指标，非医疗诊断）。
//     与 report/dashboard 同一句，端上不得隐藏。
//
//  3. **不得因未付费而屏蔽安全兜底类推荐**（Q9）。
//     本模块不做订阅门闩：文案推荐是运营侧引流，不是安全能力。
//
// 数据来源：只读 activity_daily_summary（与 report.service 同纪律，零原始特征）。
// ============================================================================

import {
  activity_status,
  pickActivityCopy,
  ACTIVITY_LEAD_COPY,
} from '@linban/shared';
import type { ActivityCopy } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { detectLeadTriggers, LEAD_TRIGGER } from '../../domain/activity';
import type { DailyActivityPoint } from '../../domain/activity';
import { ACTIVITY_DISCLAIMER, MIN_SIGNAL_DAYS } from './report.service';

export type LeadTriggerKey = (typeof LEAD_TRIGGER)[keyof typeof LEAD_TRIGGER];

/**
 * 触发器 → 文案场景的映射（recommend 出参是给老人看的，故一律不用 FAMILY_NOTICE）。
 * 导出供单测断言「没有触发器被误映射到子女向文案」。
 */
export const TRIGGER_SCENE_MATRIX: Record<LeadTriggerKey, ActivityCopy['scene']> = {
  [LEAD_TRIGGER.ACTIVITY_DROP]: 'VISIT_INVITE',
  [LEAD_TRIGGER.LOW_TREND]: 'HOUR_CARD',
  [LEAD_TRIGGER.NEWINSTALL_EXPERIENCE]: 'REORDER_CARE',
};

/** 观察窗天数（与 §13.8 的 activity_low_trend_window_days 同口径） */
const TRIGGER_WINDOW_DAYS = 3;
/** 基线天数：取观察窗等长，保证「下降」有可比对象 */
const TRIGGER_BASELINE_DAYS = 3;

export interface RecommendItem {
  /** 稳定 ID，运营改文案时用于追溯 */
  copyId: string;
  /** 场景码（VISIT_INVITE / HOUR_CARD / REORDER_CARE） */
  scene: string;
  /** 软文案正文（不含任何健康断言） */
  text: string;
  /**
   * 命中的引流触发器（供后台归因用，**前端不要展示给老人**）。
   * 注意这里给的是「哪个触发器」，不是「你健康怎么了」。
   */
  trigger: LeadTriggerKey;
}

export interface RecommendResult {
  elderUserId: string;
  items: RecommendItem[];
  /** 数据是否够（不足时 items 为空，前端不显示推荐位而不是硬凑） */
  dataReady: boolean;
  disclaimer: string;
}

/**
 * 取陪聊推荐（契约 §13.4 `GET /activity/recommend`）。
 * @param elderUserId 老人（数据主体）
 * @param opts.newInstall 是否新装用户（触发器③）；调用方从用户注册时间判定
 */
export async function getRecommend(
  elderUserId: bigint,
  opts: { newInstall?: boolean } = {},
): Promise<RecommendResult> {
  // 取近 TRIGGER_WINDOW_DAYS + TRIGGER_BASELINE_DAYS 天日聚合（只读聚合表，零原始特征）
  const needDays = TRIGGER_WINDOW_DAYS + TRIGGER_BASELINE_DAYS;
  const rows = await prisma.activity_daily_summary.findMany({
    where: { elder_user_id: elderUserId },
    orderBy: { summary_date: 'desc' },
    take: needDays,
    // activity_score 落的就是聚合层算出的 activeMinutes（见 aggregate.service.ts）
    select: { summary_date: true, status: true, activity_score: true },
  });

  // 数据未积累：不硬凑推荐位（与日报23001 同纪律）
  if (rows.length < MIN_SIGNAL_DAYS) {
    return {
      elderUserId: elderUserId.toString(),
      items: [],
      dataReady: false,
      disclaimer: ACTIVITY_DISCLAIMER,
    };
  }

  // 升序（domain 的 series 要求按日期升序；上面的查询是降序）
  const series: DailyActivityPoint[] = rows
    .slice()
    .reverse()
    .map((r) => ({
      date: toLocalDate(r.summary_date),
      activeMinutes: Number(r.activity_score ?? 0),
      status: r.status as activity_status,
    }));

  const hits = detectLeadTriggers({
    series,
    windowDays: TRIGGER_WINDOW_DAYS,
    baselineDays: TRIGGER_BASELINE_DAYS,
    dropPctThreshold: 30,
    isNewInstall: opts.newInstall === true,
    newInstallChannelActive: true,
  });

  // 触发器 → 文案；同一触发器只取一条（多触发器时给多条，运营可轮换）
  const items: RecommendItem[] = [];
  for (const hit of hits) {
    let copy: ActivityCopy;
    try {
      copy = pickActivityCopy(hit.trigger, TRIGGER_SCENE_MATRIX[hit.trigger]);
    } catch {
      // 触发器有但文案未配：跳过而不是抛错（文案缺失不该让推荐接口整体 500）
      continue;
    }
    items.push({
      copyId: copy.id,
      scene: copy.scene,
      text: copy.text,
      trigger: hit.trigger,
    });
  }

  return {
    elderUserId: elderUserId.toString(),
    items,
    dataReady: true,
    disclaimer: ACTIVITY_DISCLAIMER,
  };
}

/** 供后台审校：当前生效的文案库全量 */
export function listLeadCopy(): readonly ActivityCopy[] {
  return Object.values(ACTIVITY_LEAD_COPY).flat();
}

/** Date → 本地日期字符串（广州 UTC+8，MVP 单城固定偏移无 DST） */
function toLocalDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}