// 时段防重守卫单测：守卫列映射、重叠半开区间、日程覆盖（DATABASE.md §2.8/§4.1①）
import { describe, expect, it } from 'vitest';
import type { order_status } from '@linban/shared';
import {
  findSlotConflict,
  isSlotCoveredBySchedules,
  isValidSlot,
  parseHm,
  slotDurationMinutes,
  slotGuardForStatus,
  slotOccupancyKey,
  slotsOverlap,
  weekdayOfDate,
} from './slot-guard';
import type { ScheduleWindow, Slot } from './slot-guard';

const slot = (serviceDate: string, startTime: string, endTime: string): Slot => ({
  serviceDate,
  startTime,
  endTime,
});

describe('时段守卫 · slot_guard 列映射（§2.8）', () => {
  it('占用态存 L：CREATED/PAID/DISPATCHED/ACCEPTED/ARRIVED/IN_SERVICE/PENDING_CONFIRM/SUSPENDED/COMPLETED/CLOSED', () => {
    const occupying: order_status[] = [
      'CREATED',
      'PAID',
      'DISPATCHED',
      'ACCEPTED',
      'ARRIVED',
      'IN_SERVICE',
      'PENDING_CONFIRM',
      'SUSPENDED',
      'COMPLETED',
      'CLOSED',
    ];
    for (const s of occupying) {
      expect(slotGuardForStatus(s)).toBe('L');
    }
  });

  it('释放态置 NULL：CANCELLED/REFUNDED（时段可重新售出）', () => {
    expect(slotGuardForStatus('CANCELLED')).toBeNull();
    expect(slotGuardForStatus('REFUNDED')).toBeNull();
  });

  it('历史单 COMPLETED/CLOSED 保留 L（service_date 已过，不影响未来售出，§4.1 注）', () => {
    expect(slotGuardForStatus('COMPLETED')).toBe('L');
    expect(slotGuardForStatus('CLOSED')).toBe('L');
  });
});

describe('时段守卫 · 重叠判断（半开区间）', () => {
  const a = slot('2026-10-01', '09:00', '11:00');

  it('完全包含 → 重叠', () => {
    expect(slotsOverlap(a, slot('2026-10-01', '10:00', '10:30'))).toBe(true);
  });

  it('部分重叠（左/右）→ 重叠', () => {
    expect(slotsOverlap(a, slot('2026-10-01', '08:00', '09:30'))).toBe(true);
    expect(slotsOverlap(a, slot('2026-10-01', '10:30', '12:00'))).toBe(true);
  });

  it('完全包含候选 → 重叠', () => {
    expect(slotsOverlap(a, slot('2026-10-01', '08:00', '12:00'))).toBe(true);
  });

  it('首尾相接（半开区间）→ 不重叠', () => {
    expect(slotsOverlap(a, slot('2026-10-01', '11:00', '12:00'))).toBe(false);
    expect(slotsOverlap(a, slot('2026-10-01', '07:00', '09:00'))).toBe(false);
  });

  it('不同日期 → 不重叠', () => {
    expect(slotsOverlap(a, slot('2026-10-02', '09:00', '11:00'))).toBe(false);
  });

  it('findSlotConflict 返回首个冲突占用', () => {
    const occupied = [slot('2026-10-01', '14:00', '16:00'), slot('2026-10-01', '09:30', '10:00')];
    const conflict = findSlotConflict(a, occupied);
    expect(conflict).not.toBeNull();
    expect(conflict!.startTime).toBe('09:30');
  });

  it('findSlotConflict 无冲突返回 null', () => {
    const occupied = [slot('2026-10-01', '11:00', '12:00'), slot('2026-10-02', '09:00', '10:00')];
    expect(findSlotConflict(a, occupied)).toBeNull();
  });
});

describe('时段守卫 · 解析与谓词', () => {
  it('parseHm 合法/非法', () => {
    expect(parseHm('00:00')).toBe(0);
    expect(parseHm('09:30')).toBe(570);
    expect(parseHm('23:59')).toBe(1439);
    expect(Number.isNaN(parseHm('24:00'))).toBe(true);
    expect(Number.isNaN(parseHm('9:00'))).toBe(true); // 严格两位
    expect(Number.isNaN(parseHm('abc'))).toBe(true);
  });

  it('isValidSlot：起 < 止', () => {
    expect(isValidSlot(slot('2026-10-01', '09:00', '10:00'))).toBe(true);
    expect(isValidSlot(slot('2026-10-01', '10:00', '10:00'))).toBe(false); // 零长
    expect(isValidSlot(slot('2026-10-01', '11:00', '10:00'))).toBe(false); // 倒挂
  });

  it('slotDurationMinutes', () => {
    expect(slotDurationMinutes(slot('2026-10-01', '09:00', '11:30'))).toBe(150);
  });

  it('weekdayOfDate：2026-10-01 是周四（4）', () => {
    expect(weekdayOfDate('2026-10-01')).toBe(4);
    expect(weekdayOfDate('2026-10-04')).toBe(0); // 周日
  });

  it('占用键：serviceDate#startTime', () => {
    expect(slotOccupancyKey(slot('2026-10-01', '09:00', '11:00'))).toBe('2026-10-01#09:00');
  });
});

describe('时段守卫 · 日程覆盖', () => {
  const windows: ScheduleWindow[] = [
    // 每周四 08:00–12:00 可约
    { date: null, weekday: 4, startTime: '08:00', endTime: '12:00', status: 'AVAILABLE' },
    // 2026-10-08 当天停接（覆盖周期模板）
    { date: '2026-10-08', weekday: null, startTime: '08:00', endTime: '12:00', status: 'BLACKOUT' },
  ];

  it('周期模板命中 + slot ⊆ 窗口 → 可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-01', '09:00', '11:00'), windows)).toBe(true);
  });

  it('超出窗口边界 → 不可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-01', '11:00', '13:00'), windows)).toBe(false);
    expect(isSlotCoveredBySchedules(slot('2026-10-01', '07:00', '09:00'), windows)).toBe(false);
  });

  it('星期不命中 → 不可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-05', '09:00', '11:00'), windows)).toBe(false); // 周一
  });

  it('当日 BLACKOUT 特例覆盖周期模板 → 不可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-08', '09:00', '11:00'), windows)).toBe(false);
  });

  it('当日 AVAILABLE 特例在无模板日也可约', () => {
    const withSpecial: ScheduleWindow[] = [
      { date: '2026-10-05', weekday: null, startTime: '13:00', endTime: '18:00', status: 'AVAILABLE' },
    ];
    expect(isSlotCoveredBySchedules(slot('2026-10-05', '14:00', '16:00'), withSpecial)).toBe(true);
    expect(isSlotCoveredBySchedules(slot('2026-10-05', '19:00', '20:00'), withSpecial)).toBe(false);
  });

  it('非法候选时段 → 直接不可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-01', '11:00', '11:00'), windows)).toBe(false);
  });

  it('空日程表 → 不可约', () => {
    expect(isSlotCoveredBySchedules(slot('2026-10-01', '09:00', '10:00'), [])).toBe(false);
  });
});
