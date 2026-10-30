// ============================================================================
// 核销服务（契约 §3.4 + §4.3，模块前缀 /verifications）
// ----------------------------------------------------------------------------
// 防飞单第一关「动态码」的请求与回查：
// - 陪聊员端**只收码、不显码**（红线 §7.1.4）：这里只负责「请老人端出示 6 位码」，
//   老人端在订单详情页展示动态码（TTL dynamic_code_ttl，默认 300s），
//   陪聊员拿到后在 POST /orders/:id/arrive 提交，服务端校验三关。
// - 三关阈值（人脸分 ≥80、GPS 偏差 ≤2000m、动态码有效期）全部**服务端判定**，
//   前端不缓存、不预判、不硬编码阈值，只展示服务端返回的 checks 与错误文案。
//
// TODO(联调)：faceVerifyId / faceScore / livenessScore 由微信慧眼 SDK 产出，
//             服务端二次校验；当前 mock 降级为固定值，正式环境必须走真实人脸核身。
// TODO(契约)：POST /verifications/arrival-code 的返回体契约未定义动态码下发结果字段
//             （陪聊员视角只拿 requested 布尔），端侧按此建模，待霍承钧补齐后对齐。
// ============================================================================

import { http } from './request'
import type { ArriveResult, CompanionVerificationView } from '@/types'

/** 请老人端出示到岗动态码的返回（陪聊员视角：拿不到码本身） */
export interface ArrivalCodeRequestResult {
  orderId: string
  /** 是否已成功通知老人端展示动态码 */
  requested: boolean
  /** 动态码有效期截止时间（ISO-8601 UTC），用于倒计时提示 */
  codeExpiresAt?: string | null
}

/**
 * 请求老人端出示到岗动态码（POST /verifications/arrival-code）
 * 说明：老人端展示动态码是唯一入口，陪聊员端主动请求可缩短等待。
 */
export async function requestArrivalCode(orderId: string): Promise<ArrivalCodeRequestResult> {
  return http.post<ArrivalCodeRequestResult>('/verifications/arrival-code', { orderId })
}

/**
 * 订单核验记录回查（GET /verifications/order/:orderId）
 * 三关明细：动态码是否通过 / 人脸是否通过 / GPS 偏差多少米。
 * 用于到岗页在提交失败后回查「到底哪一关没过」，避免陪聊员反复试码。
 */
export async function fetchOrderVerification(
  orderId: string,
): Promise<CompanionVerificationView | null> {
  return http.get<CompanionVerificationView | null>(`/verifications/order/${orderId}`)
}

/** 兼容别名：订单详情内已带 verification 时的便捷读取 */
export const fetchVerifications = fetchOrderVerification

export type { ArriveResult }