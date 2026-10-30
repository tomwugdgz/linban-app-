// 订单状态机单测：合法流转全表、非法流转、终态、取消退款语义（架构 §6.5/§7.4）
import { describe, expect, it } from 'vitest';
import type { order_status } from '@linban/shared';
import {
  ORDER_TRANSITIONS,
  assertTransition,
  cancelNeedsRefund,
  cancellableStatuses,
  canTransition,
  isTerminal,
  nextStatuses,
  triggersSharing,
  triggersUnfreezeOrReturn,
} from './order-state-machine';

const ALL_STATUSES = Object.keys(ORDER_TRANSITIONS) as order_status[];

describe('订单状态机 · 转移表完整性', () => {
  it('覆盖 12 个状态（架构 §6.5）', () => {
    expect(ALL_STATUSES).toHaveLength(12);
    expect(new Set(ALL_STATUSES).size).toBe(12);
  });

  it('每条边的目标状态都在枚举内（无悬空转移）', () => {
    const statusSet = new Set<string>(ALL_STATUSES);
    for (const from of ALL_STATUSES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(statusSet.has(to)).toBe(true);
      }
    }
  });

  it('主链路合法流转全部通过（CREATED→…→CLOSED）', () => {
    const happyPath: [order_status, order_status][] = [
      ['CREATED', 'PAID'],
      ['PAID', 'DISPATCHED'],
      ['DISPATCHED', 'ACCEPTED'],
      ['ACCEPTED', 'ARRIVED'],
      ['ARRIVED', 'IN_SERVICE'],
      ['IN_SERVICE', 'PENDING_CONFIRM'],
      ['PENDING_CONFIRM', 'COMPLETED'],
      ['COMPLETED', 'CLOSED'],
    ];
    for (const [from, to] of happyPath) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('重派链路合法（30min 无人接单 DISPATCHED→PAID，§6.1）', () => {
    expect(canTransition('DISPATCHED', 'PAID')).toBe(true);
  });

  it('挂起裁决链路合法（§6.5：SUSPENDED→COMPLETED/REFUNDED）', () => {
    expect(canTransition('PENDING_CONFIRM', 'SUSPENDED')).toBe(true);
    expect(canTransition('SUSPENDED', 'COMPLETED')).toBe(true);
    expect(canTransition('SUSPENDED', 'REFUNDED')).toBe(true);
  });

  it('到岗三态可安全挂起（team-lead 裁定③：SOS 立即挂起 / 超时自动挂起）', () => {
    expect(canTransition('ACCEPTED', 'SUSPENDED')).toBe(true);
    expect(canTransition('ARRIVED', 'SUSPENDED')).toBe(true);
    expect(canTransition('IN_SERVICE', 'SUSPENDED')).toBe(true);
  });

  it('已付取消链路合法（§7.4：PAID/DISPATCHED/ACCEPTED → CANCELLED → REFUNDED）', () => {
    expect(canTransition('PAID', 'CANCELLED')).toBe(true);
    expect(canTransition('DISPATCHED', 'CANCELLED')).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'REFUNDED')).toBe(true);
  });
});

describe('订单状态机 · 非法流转拒绝', () => {
  it.each<[order_status, order_status]>([
    // 跳过中间态
    ['CREATED', 'ACCEPTED'],
    ['CREATED', 'COMPLETED'],
    ['PAID', 'COMPLETED'],
    ['PAID', 'ARRIVED'],
    ['DISPATCHED', 'ARRIVED'],
    // 回退（状态机不回退，改期/异常走专门路径）
    ['PAID', 'CREATED'],
    ['ACCEPTED', 'PAID'],
    ['COMPLETED', 'PENDING_CONFIRM'],
    ['ARRIVED', 'ACCEPTED'],
    // 终态不可再动
    ['CLOSED', 'PAID'],
    ['CLOSED', 'REFUNDED'],
    ['REFUNDED', 'CLOSED'],
    ['REFUNDED', 'COMPLETED'],
    // 未支付不能进服务态
    ['CREATED', 'ARRIVED'],
    ['CREATED', 'IN_SERVICE'],
    // 服务中不可直接完成/取消（须经 PENDING_CONFIRM）
    ['IN_SERVICE', 'COMPLETED'],
    ['IN_SERVICE', 'CANCELLED'],
    // CANCELLED 后不可复活成服务态
    ['CANCELLED', 'PAID'],
    ['CANCELLED', 'ACCEPTED'],
  ])('%s → %s 被拒绝', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrowError(/订单状态不允许该操作/);
  });

  it('assertTransition 携带 allowed 列表供排查', () => {
    try {
      assertTransition('CREATED', 'ARRIVED');
      expect.unreachable();
    } catch (e) {
      const err = e as { code: number; payload?: Record<string, unknown> };
      expect(err.code).toBe(14002);
      expect(err.payload?.allowed).toEqual(['PAID', 'CANCELLED']);
    }
  });
});

describe('订单状态机 · 终态与语义谓词', () => {
  it('CLOSED/REFUNDED 为终态', () => {
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('REFUNDED')).toBe(true);
  });

  it('非终态均有后继', () => {
    for (const s of ALL_STATUSES) {
      if (s === 'CLOSED' || s === 'REFUNDED') continue;
      expect(nextStatuses(s).length).toBeGreaterThan(0);
    }
  });

  it('CANCELLED 非终态（可 →REFUNDED 完成退款闭环，§7.4）', () => {
    expect(isTerminal('CANCELLED')).toBe(false);
  });

  it('取消退款语义：仅 CREATED 取消不动账', () => {
    expect(cancelNeedsRefund('CREATED')).toBe(false);
    expect(cancelNeedsRefund('PAID')).toBe(true);
    expect(cancelNeedsRefund('DISPATCHED')).toBe(true);
    expect(cancelNeedsRefund('ACCEPTED')).toBe(true);
  });

  it('COMPLETED 触发分账执行', () => {
    expect(triggersSharing('COMPLETED')).toBe(true);
    expect(triggersSharing('CLOSED')).toBe(false);
    expect(triggersSharing('PAID')).toBe(false);
  });

  it('解冻/回退触发语义', () => {
    expect(triggersUnfreezeOrReturn('CANCELLED', 'PAID')).toBe(true);
    expect(triggersUnfreezeOrReturn('CANCELLED', 'CREATED')).toBe(false);
    expect(triggersUnfreezeOrReturn('REFUNDED', 'SUSPENDED')).toBe(true);
    expect(triggersUnfreezeOrReturn('REFUNDED', 'CANCELLED')).toBe(true);
    expect(triggersUnfreezeOrReturn('COMPLETED', 'PENDING_CONFIRM')).toBe(false);
  });

  it('可取消状态集合 = CREATED/PAID/DISPATCHED/ACCEPTED（§6.2：接单后违约取消部分退）', () => {
    expect([...cancellableStatuses()].sort()).toEqual(['ACCEPTED', 'CREATED', 'DISPATCHED', 'PAID']);
  });
});
