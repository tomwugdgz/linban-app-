// ============================================================================
// 核验配合服务（用户侧只读，对齐契约 §3.4）
// ----------------------------------------------------------------------------
// 红线 §7.1.4：动态码仅老人端展示；人脸/GPS 阈值服务端判定，前端不感知。
// ============================================================================

import { http } from './request'
import type { OrderVerificationView } from '@/types'

/** 订单核验记录（三关：动态码/人脸/GPS） */
export async function fetchOrderVerification(orderId: string): Promise<OrderVerificationView | null> {
  return http.get<OrderVerificationView | null>(`/verifications/order/${orderId}`)
}
