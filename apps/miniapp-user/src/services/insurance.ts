// ============================================================================
// 保险服务（契约 §3.5）与风控上报（SOS/举报/投诉，§5.5）
// ============================================================================

import { http } from './request'
import type { PolicyDTO } from '@linban/shared'

/** 我的保单列表 */
export async function fetchPolicies(): Promise<PolicyDTO[]> {
  return http.get<PolicyDTO[]>('/insurance/policies')
}

/** 订单保单查询 */
export async function fetchOrderPolicy(orderId: string): Promise<PolicyDTO | null> {
  return http.get<PolicyDTO | null>(`/insurance/orders/${orderId}`)
}

/** 出险报案（半自动：登记 + 经纪 API TODO） */
export async function claimPolicy(policyNo: string): Promise<{ ok: boolean }> {
  return http.post<{ ok: boolean }>(`/insurance/policies/${policyNo}/claim`)
}

/** SOS 一键求助（建 CRITICAL 风控事件 + 值守通知，P0） */
export async function reportSos(orderId: string): Promise<{ eventNo: string }> {
  return http.post<{ eventNo: string }>('/risk/sos', { type: 'SOS', orderId, reason: '用户端一键求助' })
}

/** 举报（飞单/违规） */
export async function submitReport(orderId: string, reason: string): Promise<{ reportNo: string }> {
  return http.post<{ reportNo: string }>('/risk/reports', { type: 'REPORT', orderId, reason })
}

/** 投诉 */
export async function submitComplaint(orderId: string, reason: string): Promise<{ complaintNo: string }> {
  return http.post<{ complaintNo: string }>('/risk/complaints', { type: 'COMPLAINT', orderId, reason })
}
