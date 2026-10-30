// 安全挂起 / 夜间单确认纯函数单测（team-lead 裁定③④）
import { describe, expect, it } from 'vitest';
import type { order_status } from '@linban/shared';
import {
  isAdult,
  nightConfirmDeadline,
  nightConfirmOverdue,
  nightSelfConfirmExempt,
  serviceOvertimeSuspendDue,
  sosSuspendable,
} from './safety-suspend';

const NOW = new Date('2026-09-15T12:00:00.000Z');

describe('isAdult · 成年判定', () => {
  it('满 18 周岁当天算成年', () => {
    expect(isAdult(new Date('2008-09-15T00:00:00.000Z'), NOW)).toBe(true);
  });
  it('差一天满 18 → 未成年', () => {
    expect(isAdult(new Date('2008-09-16T00:00:00.000Z'), NOW)).toBe(false);
  });
  it('整 17 岁 → 未成年；19 岁 → 成年', () => {
    expect(isAdult(new Date('2009-01-01T00:00:00.000Z'), NOW)).toBe(false);
    expect(isAdult(new Date('2007-01-01T00:00:00.000Z'), NOW)).toBe(true);
  });
  it('生日为空 / 非法日期 → 未成年（保守：不放行豁免）', () => {
    expect(isAdult(null, NOW)).toBe(false);
    expect(isAdult(undefined, NOW)).toBe(false);
    expect(isAdult(new Date('not-a-date'), NOW)).toBe(false);
  });
  it('未来生日 → 未成年', () => {
    expect(isAdult(new Date('2030-01-01T00:00:00.000Z'), NOW)).toBe(false);
  });
});

describe('nightSelfConfirmExempt · 夜间单豁免口径 A', () => {
  const adult = new Date('1950-01-01T00:00:00.000Z');
  const minor = new Date('2012-01-01T00:00:00.000Z');

  it('老人本人下单 + 成年 → 豁免（自确认）', () => {
    expect(nightSelfConfirmExempt(true, adult, NOW)).toBe(true);
  });
  it('子女代下单 + 老人成年 → 不豁免（裁定④：一律走子女确认）', () => {
    expect(nightSelfConfirmExempt(false, adult, NOW)).toBe(false);
  });
  it('老人本人下单 + 未成年 → 不豁免', () => {
    expect(nightSelfConfirmExempt(true, minor, NOW)).toBe(false);
  });
  it('生日缺失 → 不豁免', () => {
    expect(nightSelfConfirmExempt(true, null, NOW)).toBe(false);
  });
});

describe('nightConfirmDeadline · 截止时刻', () => {
  it('下单时刻 + 30min', () => {
    const created = new Date('2026-09-15T13:59:00.000Z');
    expect(nightConfirmDeadline(created, 30).toISOString()).toBe('2026-09-15T14:29:00.000Z');
  });
});

describe('nightConfirmOverdue · 确认超时判定', () => {
  const createdAt = new Date('2026-09-15T11:00:00.000Z');
  const base = { nightOrder: true, familyConfirmedAt: null, status: 'CREATED' as order_status, createdAt };

  it('非夜间单 → 永不超时', () => {
    expect(nightConfirmOverdue({ ...base, nightOrder: false }, NOW, 30)).toBe(false);
  });
  it('已确认 → 不超时', () => {
    expect(
      nightConfirmOverdue({ ...base, familyConfirmedAt: new Date('2026-09-15T11:10:00.000Z') }, NOW, 30),
    ).toBe(false);
  });
  it('窗口内 → 不超时（29min）', () => {
    expect(nightConfirmOverdue(base, new Date('2026-09-15T11:29:59.000Z'), 30)).toBe(false);
  });
  it('整 30min 边界 → 超时', () => {
    expect(nightConfirmOverdue(base, new Date('2026-09-15T11:30:00.000Z'), 30)).toBe(true);
  });
  it('未支付超时（CREATED）→ 取消无退款', () => {
    expect(nightConfirmOverdue(base, NOW, 30)).toBe(true);
  });
  it('已支付超时（PAID）→ 取消走全额退款', () => {
    expect(nightConfirmOverdue({ ...base, status: 'PAID' }, NOW, 30)).toBe(true);
  });
  it('已派单及之后 → sweep 不自动取消（放行有漏交人工）', () => {
    for (const s of ['DISPATCHED', 'ACCEPTED', 'IN_SERVICE', 'COMPLETED'] as const) {
      expect(nightConfirmOverdue({ ...base, status: s }, NOW, 30)).toBe(false);
    }
  });
});

describe('serviceOvertimeSuspendDue · 服务超时挂起判定', () => {
  const slotEnd = new Date('2026-09-15T10:00:00.000Z');
  const base = { status: 'IN_SERVICE', slotEnd, lastActivityAt: new Date('2026-09-15T09:30:00.000Z') };

  it('非 IN_SERVICE → 不挂起', () => {
    expect(serviceOvertimeSuspendDue({ ...base, status: 'ACCEPTED' }, NOW, { overtimeMin: 60, silenceMin: 30 })).toBe(false);
    expect(serviceOvertimeSuspendDue({ ...base, status: 'PENDING_CONFIRM' }, NOW, { overtimeMin: 60, silenceMin: 30 })).toBe(false);
  });
  it('未超预约结束时间 → 不挂起', () => {
    const soon = new Date('2026-09-15T10:30:00.000Z');
    expect(serviceOvertimeSuspendDue(base, soon, { overtimeMin: 60, silenceMin: 30 })).toBe(false);
  });
  it('超时但 IM 刚有互动 → 不挂起（服务仍在推进）', () => {
    const now = new Date('2026-09-15T11:30:00.000Z'); // 超时 90min
    const recent = new Date('2026-09-15T11:10:00.000Z'); // 静默仅 20min
    expect(serviceOvertimeSuspendDue({ ...base, lastActivityAt: recent }, now, { overtimeMin: 60, silenceMin: 30 })).toBe(false);
  });
  it('超时 + IM 静默双条件满足 → 挂起', () => {
    // now-slotEnd = 120min ≥ 60；now-lastActivity = 150min ≥ 30
    expect(serviceOvertimeSuspendDue(base, NOW, { overtimeMin: 60, silenceMin: 30 })).toBe(true);
  });
  it('边界：两项都刚好卡线 → 挂起（>= 语义）', () => {
    const now = new Date('2026-09-15T11:00:00.000Z'); // 超时 60min、静默 90min
    expect(serviceOvertimeSuspendDue(base, now, { overtimeMin: 60, silenceMin: 30 })).toBe(true);
  });
  it('边界：静默差 1 分钟 → 不挂起', () => {
    const now = new Date('2026-09-15T11:00:00.000Z');
    const lastActivity = new Date('2026-09-15T10:31:00.000Z'); // 静默 29min
    expect(serviceOvertimeSuspendDue({ ...base, lastActivityAt: lastActivity }, now, { overtimeMin: 60, silenceMin: 30 })).toBe(false);
  });
  it('无 IM 消息时以回退时刻判定：久无动静 → 挂起', () => {
    // 回退 service_started_at=08:00；now-slotEnd=120min，now-08:00=240min
    const fallback = { ...base, lastActivityAt: new Date('2026-09-15T08:00:00.000Z') };
    expect(serviceOvertimeSuspendDue(fallback, NOW, { overtimeMin: 60, silenceMin: 30 })).toBe(true);
  });
});

describe('sosSuspendable · SOS 可挂起态', () => {
  it('到岗三态可挂起', () => {
    expect(sosSuspendable('ACCEPTED')).toBe(true);
    expect(sosSuspendable('ARRIVED')).toBe(true);
    expect(sosSuspendable('IN_SERVICE')).toBe(true);
  });
  it('未接单 / 已挂起 / 终态不重复挂', () => {
    for (const s of ['CREATED', 'PAID', 'DISPATCHED', 'PENDING_CONFIRM', 'SUSPENDED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'CLOSED']) {
      expect(sosSuspendable(s)).toBe(false);
    }
  });
});
