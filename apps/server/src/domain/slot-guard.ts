// ============================================================================
// 邻伴 · 时段防重守卫（架构 §6.1 4 / DATABASE.md §2.8 / §4.1 索引①）
// ----------------------------------------------------------------------------
// 双防线（架构 §6.1 4）：
//   第一道：Redis 时段锁 lock:slot:<companionId>:<slot>（成交即锁）；
//   第二道：DB 唯一索引 (companion_id, service_date, slot_start, slot_guard)
//           —— slot_guard 守卫列实现「占用中唯一、取消后可重售」：
//           占用中存 'L'；CANCELLED/REFUNDED 置 NULL 释放。
//           MySQL 唯一索引中多个 NULL 互不冲突 → 释放后可重新售出。
//           COMPLETED/CLOSED 的历史单保留 'L'（service_date 已过去，
//           不影响未来售出；如做「改期」须引入改期流水，MVP 不做）。
//
// 本文件提供守卫列的纯映射 + 时段重叠/日程覆盖判断（零 IO）；
// 锁竞争与 DB 落库在 infra/redis 与 order service。
// ============================================================================

import type { order_status } from '@linban/shared';

/** 守卫列取值：'L' = 占用中；null = 已释放 */
export type SlotGuard = 'L' | null;

/**
 * 订单状态 → slot_guard 映射（DATABASE.md §2.8）。
 * CANCELLED / REFUNDED 释放时段（可重售）；其余（含 SUSPENDED 客服裁决中、
 * COMPLETED/CLOSED 历史单）保持占用。
 */
export function slotGuardForStatus(status: order_status): SlotGuard {
  return status === 'CANCELLED' || status === 'REFUNDED' ? null : 'L';
}

/** 时段（本地广州语义：service_date + "HH:mm" 起止，不涉及 UTC 换算） */
export interface Slot {
  serviceDate: string; // YYYY-MM-DD
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

/** 解析 "HH:mm" 为当日分钟数（0–1439）；非法返回 NaN */
export function parseHm(hm: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 时段是否良构（起 < 止、同日） */
export function isValidSlot(slot: Slot): boolean {
  const s = parseHm(slot.startTime);
  const e = parseHm(slot.endTime);
  return Number.isFinite(s) && Number.isFinite(e) && s < e;
}

/** 时段时长（分钟） */
export function slotDurationMinutes(slot: Slot): number {
  return parseHm(slot.endTime) - parseHm(slot.startTime);
}

/**
 * 两个时段是否重叠（半开区间 [start, end)：相接不算重叠）。
 * 仅同 service_date 才可能重叠（单次服务 ≤8h，不跨日）。
 */
export function slotsOverlap(a: Slot, b: Slot): boolean {
  if (a.serviceDate !== b.serviceDate) return false;
  const aStart = parseHm(a.startTime);
  const aEnd = parseHm(a.endTime);
  const bStart = parseHm(b.startTime);
  const bEnd = parseHm(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 在既有占用列表中查找与候选时段冲突的占用（返回第一个冲突项）。
 * 已释放（slot_guard=null）的占用不应传入本函数。
 */
export function findSlotConflict<T extends Slot>(candidate: Slot, occupied: readonly T[]): T | null {
  for (const o of occupied) {
    if (slotsOverlap(candidate, o)) return o;
  }
  return null;
}

/** 日期 → 星期（0=周日…6=周六；按日期字面量解析，不受时区影响） */
export function weekdayOfDate(serviceDate: string): number {
  const t = Date.parse(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(t)) return Number.NaN;
  return new Date(t).getUTCDay();
}

/** 日程窗口（companion_schedules 投影） */
export interface ScheduleWindow {
  /** 指定日期特例（YYYY-MM-DD）或 null=周期模板 */
  date: string | null;
  /** 周期模板的星期（0=周日）；date 非空时忽略 */
  weekday: number | null;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  status: 'AVAILABLE' | 'BLACKOUT';
}

/**
 * 候选时段是否被日程覆盖（可约）。
 * 规则：
 *   1. 指定日期特例优先：BLACKOUT → 直接不可约（停接）；
 *      AVAILABLE 且 slot ⊆ 窗口 → 可约；
 *   2. 无当日特例时看周期模板：weekday 命中 + AVAILABLE + slot ⊆ 窗口；
 *   3. 「覆盖」= 候选时段完整落在窗口内（slot.start ≥ win.start 且
 *      slot.end ≤ win.end）。
 */
export function isSlotCoveredBySchedules(slot: Slot, schedules: readonly ScheduleWindow[]): boolean {
  if (!isValidSlot(slot)) return false;
  const dayOfWeek = weekdayOfDate(slot.serviceDate);

  // 1) 当日特例
  const dayExceptions = schedules.filter((w) => w.date === slot.serviceDate);
  for (const w of dayExceptions) {
    if (w.status === 'BLACKOUT') return false;
    if (w.status === 'AVAILABLE' && slotWithinWindow(slot, w)) return true;
  }

  // 2) 周期模板
  for (const w of schedules) {
    if (w.date !== null) continue;
    if (w.weekday !== dayOfWeek) continue;
    if (w.status === 'AVAILABLE' && slotWithinWindow(slot, w)) return true;
  }
  return false;
}

function slotWithinWindow(slot: Slot, w: ScheduleWindow): boolean {
  const ws = parseHm(w.startTime);
  const we = parseHm(w.endTime);
  const ss = parseHm(slot.startTime);
  const se = parseHm(slot.endTime);
  if (![ws, we, ss, se].every(Number.isFinite)) return false;
  return ss >= ws && se <= we;
}

/**
 * 时段占用键（DB 唯一索引第三列 slot_start 的入参形态）。
 * 统一以「本地 HH:mm」参与比较，避免 UTC 换算把 23:30 的单切到次日
 * （DATABASE.md §2.6：service_date 存本地日，时段字符串本地语义）。
 */
export function slotOccupancyKey(slot: Slot): string {
  return `${slot.serviceDate}#${slot.startTime}`;
}
