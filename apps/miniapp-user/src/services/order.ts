// ============================================================================
// 订单服务（对齐契约 §3.2 / §3.3）
// ----------------------------------------------------------------------------
// 计价（架构 §7.2）：时长 × 时薪 − 优惠券 − 时长卡抵扣；
// 平台抽成 = round(订单实收 × 5%)，抵扣部分不参与分成基数（平台营销预算承担）。
// 下单走 POST /orders（服务端算钱），本文件的 quote 仅为页面预览估算。
// ============================================================================

import { http, config } from './request'
import { wxPay } from './wx/wechat'
import type {
  CreateOrderRequest,
  OrderDetailView,
  PageResult,
  PaymentBriefDTO,
  PaymentPrepayDTO,
  PriceQuote,
  ProfitSharingBriefDTO,
} from '@/types'
import { order_status } from '@linban/shared'

/** 下单（服务端计算金额与时段锁） */
export async function createOrder(payload: CreateOrderRequest): Promise<OrderDetailView> {
  return http.post<OrderDetailView>('/orders', payload as unknown as Record<string, unknown>)
}

/** 我的订单列表 */
export async function fetchOrders(tab: 'all' | 'pending' | 'serving' | 'done' = 'all'): Promise<PageResult<OrderDetailView>> {
  return http.get<PageResult<OrderDetailView>>(`/orders?tab=${tab}`)
}

/** 订单详情 */
export async function fetchOrderDetail(id: string): Promise<OrderDetailView> {
  return http.get<OrderDetailView>(`/orders/${id}`)
}

/** 取消订单（ACCEPTED 后收 10% 违约金，服务端计算） */
export async function cancelOrder(id: string, reason: string): Promise<OrderDetailView> {
  return http.post<OrderDetailView>(`/orders/${id}/cancel`, { reason })
}

/**
 * 夜间单子女确认（22:00–06:00）
 * - 仅对「生效绑定中的子女」开放：服务端校验绑定，非绑定账号返回 12004；
 * - 老人本人账号下单且档案生日满 18 岁 → 创建即自确认，端上无交互（豁免口径 A）。
 */
export async function nightConfirm(id: string): Promise<OrderDetailView> {
  return http.post<OrderDetailView>(`/orders/${id}/night-confirm`, { boundFamily: true })
}

/** 完成确认（老人侧；支持语音「满意」ASR 文本透传） */
export async function confirmComplete(id: string, asrText?: string): Promise<OrderDetailView> {
  return http.post<OrderDetailView>(`/orders/${id}/confirm`, { asrText })
}

/**
 * 支付订单：prepay → wx.requestPayment（mock 为模拟弹窗）。
 * 注意：订单置 PAID 由微信支付回调驱动（服务端），前端不直接写支付态。
 */
export async function payOrder(orderId: string): Promise<void> {
  const prepay = await http.post<PaymentPrepayDTO>('/payments/prepay', { orderId })
  await wxPay(prepay, config.USE_MOCK)
}

/** 支付/分账流水（只读） */
export async function fetchPaymentRecords(orderId: string): Promise<{
  payment: PaymentBriefDTO | null
  sharing: ProfitSharingBriefDTO | null
}> {
  return http.get(`/payments/order/${orderId}`)
}

/**
 * 演示专用：推进订单状态（无陪聊员端时点通链路）。
 * 仅 mock 模式可用；真实环境删除（见 mock/router 注释）。
 */
export async function demoAdvance(id: string, action: 'accept' | 'arrive' | 'start' | 'finish'): Promise<OrderDetailView> {
  return http.post<OrderDetailView>(`/orders/${id}/demo-advance`, { action })
}

/**
 * 页面预览估价（mock 与真实模式都先用前端估算展示；
 * 真实金额以下单接口返回为准）。
 */
export function quotePrice(params: {
  hourlyRateFen: string
  durationMinutes: number
  coupon?: { type: 'FULL_REDUCTION' | 'DURATION'; value: number; minSpendFen: string } | null
  giftCardBalanceFen?: string
}): PriceQuote {
  const rate = Number(params.hourlyRateFen)
  const original = Math.round((rate * params.durationMinutes) / 60)
  let couponDeduct = 0
  if (params.coupon) {
    if (params.coupon.type === 'FULL_REDUCTION' && original >= Number(params.coupon.minSpendFen)) {
      couponDeduct = Math.min(params.coupon.value, original)
    } else if (params.coupon.type === 'DURATION') {
      couponDeduct = Math.round((rate * Math.min(params.coupon.value, params.durationMinutes)) / 60)
    }
  }
  const giftCardDeduct = Math.min(Number(params.giftCardBalanceFen || 0), original - couponDeduct)
  const total = Math.max(0, original - couponDeduct - giftCardDeduct)
  const commission = Math.round(total * 0.05)
  return {
    durationMinutes: params.durationMinutes,
    hourlyRateFen: params.hourlyRateFen,
    originalAmountFen: String(original),
    couponDeductFen: String(couponDeduct),
    giftCardDeductFen: String(giftCardDeduct),
    totalAmountFen: String(total),
    platformCommissionFen: String(commission),
    companionIncomeFen: String(total - commission),
  }
}

/** 状态是否允许支付 */
export function canPay(status: order_status): boolean {
  return status === order_status.CREATED
}

/** 状态是否允许取消（用户侧） */
export function canCancel(status: order_status): boolean {
  return ([order_status.CREATED, order_status.PAID, order_status.DISPATCHED, order_status.ACCEPTED] as order_status[]).includes(status)
}
