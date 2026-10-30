// ============================================================================
// 邻伴 · 订单状态机（12 态，架构 §6.5 单一事实源）
// ----------------------------------------------------------------------------
// 转移表来源：
//   · §6.5 状态图（mermaid）逐边收录；
//   · §7.4 退款规则表补充两条状态图未画但业务必需的边：
//     - PAID → CANCELLED（已支付、接单前取消，全额原路退）
//     - DISPATCHED → CANCELLED（已支付、已派单未接单时取消/客服介入后取消）
//   · 到岗三态 → SUSPENDED（ACCEPTED/ARRIVED/IN_SERVICE）：team-lead 裁定③
//     （2026-09）——任一端 SOS 立即挂起、服务超时+IM 静默自动挂起，统一走
//     SUSPENDED 客服裁决出口。原「IN_SERVICE→SUSPENDED 未纳入」的注释按裁定
//      supersede；ARCHITECTURE.md §6.5 状态图回改由顾图南随文档同步闭环
//     （单一事实源纪律：代码已按产品裁定落地，文档回写不阻塞实现）。
//
// 状态推进只允许经本模块的 canTransition/assertTransition 校验，
// 服务层负责写 order_timeline 留痕（架构铁律 4）。
// ============================================================================

import { AppError } from '@linban/shared';
import type { order_status } from '@linban/shared';

/** 订单状态转移表（合法 from → to 集合） */
export const ORDER_TRANSITIONS: Readonly<Record<order_status, readonly order_status[]>> = Object.freeze({
  CREATED: ['PAID', 'CANCELLED'], // 支付成功 / 超时或主动取消
  PAID: ['DISPATCHED', 'CANCELLED'], // 派单 TopN / 接单前取消（§7.4 全额退）
  DISPATCHED: ['ACCEPTED', 'PAID', 'CANCELLED'], // 接单 / 30min 无人接重派 / 未接单取消
  ACCEPTED: ['ARRIVED', 'SUSPENDED', 'CANCELLED'], // 核销通过 / SOS·异常挂起（裁定③）/ 违约取消（§7.4 部分退）
  ARRIVED: ['IN_SERVICE', 'SUSPENDED'], // 开始服务 / SOS·异常挂起（裁定③）
  IN_SERVICE: ['PENDING_CONFIRM', 'SUSPENDED'], // 服务结束待确认 / SOS·超时挂起（裁定③）
  PENDING_CONFIRM: ['COMPLETED', 'SUSPENDED'], // 双方确认 / 异常挂起
  COMPLETED: ['CLOSED'], // 评价完成或超时关闭
  SUSPENDED: ['COMPLETED', 'REFUNDED'], // 客服裁决：完成 / 退款（分账回退）
  CANCELLED: ['REFUNDED'], // 已付退款（分账回退）
  CLOSED: [], // 终态
  REFUNDED: [], // 终态
});

/** 判断一次状态转移是否合法（纯函数） */
export function canTransition(from: order_status, to: order_status): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** 某状态的合法后继集合 */
export function nextStatuses(from: order_status): readonly order_status[] {
  return ORDER_TRANSITIONS[from];
}

/** 终态（不可再流转）：CLOSED / REFUNDED */
export function isTerminal(status: order_status): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * 取消是否伴随资金退回（架构 §7.4）：
 *   CREATED → CANCELLED：未动账，直接关单，无退款；
 *   PAID/DISPATCHED/ACCEPTED → CANCELLED：已支付，需「解除待分账 + 原路退」。
 */
export function cancelNeedsRefund(from: order_status): boolean {
  return from === 'PAID' || from === 'DISPATCHED' || from === 'ACCEPTED';
}

/** 进入该状态是否触发分账执行（orders=COMPLETED，架构 §6.2 6a；门闩另校） */
export function triggersSharing(to: order_status): boolean {
  return to === 'COMPLETED';
}

/** 进入该状态是否触发分账回退/解冻（CANCELLED 已付 / REFUNDED，架构 §7.4） */
export function triggersUnfreezeOrReturn(to: order_status, from: order_status): boolean {
  if (to === 'REFUNDED') return true;
  if (to === 'CANCELLED') return cancelNeedsRefund(from);
  return false;
}

/** 断言转移合法，非法抛 AppError(14002)（接入层/服务层统一使用） */
export function assertTransition(from: order_status, to: order_status): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      14002,
      `${from} → ${to}`,
      { from, to, allowed: [...ORDER_TRANSITIONS[from]] },
    );
  }
}

/** 服务中是否允许取消（MVP 规则：IN_SERVICE 起不可自由取消，须走异常挂起裁决） */
export function cancellableStatuses(): readonly order_status[] {
  return ['CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED'] as const;
}

export function isCancellable(status: order_status): boolean {
  return cancellableStatuses().includes(status);
}
