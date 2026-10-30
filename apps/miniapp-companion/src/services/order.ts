// ============================================================================
// 订单服务（契约 §4.2 陪聊员动作 + §4.3 核验生产）
// ----------------------------------------------------------------------------
// 动作链：接单大厅 grab → 到岗核销 arrive（三关）→ 开始 start → 结束 finish
//        → 双方确认 confirm（→ COMPLETED 后分账入账）
// 红线 §7.2.3：时段冲突即失败（14003），不做静默覆盖。
// 红线 §7.2.1：服务核销完成前「待入账」可见但不可提现（前端仅展示，不放款）。
// ============================================================================

import { http } from './request'
import { CS_PHONE } from '@/constants'
import type {
  ArriveInput,
  ArriveResult,
  CompanionOrderView,
  DispatchPoolItem,
  PageResult,
  SosResult,
} from '@/types'
import { order_status } from '@linban/shared'

/** 接单大厅（GET /orders/dispatch/pool） */
export async function fetchDispatchPool(): Promise<DispatchPoolItem[]> {
  return http.get<DispatchPoolItem[]>('/orders/dispatch/pool')
}

/** 我的订单列表（服务端按 role=COMPANION 视角分流） */
export async function fetchMyOrders(status?: order_status): Promise<PageResult<CompanionOrderView>> {
  const q = status ? `?status=${status}` : ''
  return http.get<PageResult<CompanionOrderView>>(`/orders${q}`)
}

/** 订单详情 */
export async function fetchOrderDetail(id: string): Promise<CompanionOrderView> {
  return http.get<CompanionOrderView>(`/orders/${id}`)
}

/** 抢单（失败 14003 = 该时段已被占用；夜间单未确认 14007） */
export async function grabOrder(id: string): Promise<CompanionOrderView> {
  return http.post<CompanionOrderView>(`/orders/${id}/grab`)
}

/** 到岗核销（动态码 + 人脸 + GPS 三关，阈值服务端判定） */
export async function arriveOrder(id: string, input: ArriveInput): Promise<ArriveResult> {
  return http.post<ArriveResult>(`/orders/${id}/arrive`, input as unknown as Record<string, unknown>)
}

/** 开始服务（→ IN_SERVICE） */
export async function startService(id: string): Promise<{ status: string }> {
  return http.post<{ status: string }>(`/orders/${id}/start`)
}

/** 结束服务（→ PENDING_CONFIRM，等待双方确认） */
export async function finishService(id: string): Promise<{ status: string }> {
  return http.post<{ status: string }>(`/orders/${id}/finish`)
}

/** 完成确认（陪聊员侧确认；双方都确认才 COMPLETED） */
export async function confirmComplete(id: string): Promise<{ status: string; completed?: boolean }> {
  return http.post(`/orders/${id}/confirm`)
}

/** 取消订单（ACCEPTED 前免费，后收 10% 违约金） */
export async function cancelOrder(
  id: string,
  reason: string,
): Promise<{ status: string; cancelFeeFen: string; refundAmountFen: string }> {
  return http.post(`/orders/${id}/cancel`, { reason })
}

/**
 * 陪聊员侧发起 SOS（POST /risk/sos）
 *
 * ⚠ 不可撤销动作：服务端一次调用即触发「CRITICAL 风控事件 + 到岗态立即 SUSPENDED
 * + URGENT 投诉工单 + 紧急联系人模板短信 + 绑定子女 IM 通知」，**服务端不做二次确认**，
 * 所以防误触必须由前端负责（页面需红色浮层 + 倒计时 + 二次确认）。
 *
 * 请求体严格对齐服务端 zod schema（apps/server/src/modules/risk/risk.routes.ts）：
 *   { orderId: string(必填), lat?: number, lng?: number, description?: string(max 500) }
 * zod 默认 strip 未声明字段，所以：
 *   - 字段名必须是 `description`，传 `reason` 会被静默丢弃 →
 *     陪聊员填的求助原因进不了客服工单（安全场景丢关键信息）；
 *   - 不能传 `type: 'SOS'`，服务端没声明这个键（类型已由路由固定为 SOS）。
 *
 * 返回体对齐 risk.routes.ts：
 *   { eventNo, level: 'CRITICAL', suspended: boolean, complaintNo }
 * `suspended` 决定订单是否真被挂起（仅到岗态可挂起），页面据此给不同文案：
 *   true → 「订单已挂起，平台值守正在介入」；false → 「求助已发出，平台值守正在介入」
 */
export async function reportSos(input: {
  orderId: string
  /** 求助详情（用户可填，服务端 max 500；不填时服务端兜底「一键求助」） */
  description?: string
  lat?: number
  lng?: number
}): Promise<SosResult> {
  const res = await http.post<{
    eventNo?: string
    level?: string
    suspended?: boolean
    complaintNo?: string
  }>('/risk/sos', {
    orderId: input.orderId,
    ...(input.description ? { description: input.description.slice(0, 500) } : {}),
    ...(typeof input.lat === 'number' ? { lat: input.lat } : {}),
    ...(typeof input.lng === 'number' ? { lng: input.lng } : {}),
  })
  return {
    eventNo: res.eventNo || '',
    // 服务端 risk_events.level 固定 CRITICAL（不是 URGENT，那是 complaints.priority）
    level: res.level || 'CRITICAL',
    // suspended 只在到岗态才为 true，其余状态兜底 false，页面必须区分文案
    suspended: res.suspended === true,
    complaintNo: res.complaintNo || '',
    csPhone: CS_PHONE,
  }
}

/** 请求老人端出示动态码 / 回查核验记录 —— 委托 verification.ts（契约 §3.4 / §4.3） */
export { requestArrivalCode, fetchOrderVerification, fetchVerifications } from './verification'

/**
 * 隐私号（仅本方视角虚拟号，红线 §7.1.4：陪聊员端永远拿不到老人完整手机号）
 *
 * 路径必须是 `/im/privacy-binding/order/:orderId` ——
 * 服务端 imRouter.get('/privacy-binding/order/:orderId')（im.routes.ts:214），
 * 漏掉中间的 `order/` 段会 404。这条由 endpoint-contract.test.ts 守住。
 */
export async function fetchPrivacyBinding(orderId: string): Promise<{
  virtualNumber: string
  status: string
  expiredAt: string | null
}> {
  return http.get(`/im/privacy-binding/order/${orderId}`)
}
