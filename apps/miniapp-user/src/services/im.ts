// ============================================================================
// IM 服务（对齐契约 §6.1）
// ----------------------------------------------------------------------------
// 红线：会话必须挂订单；联系方式交换由服务端同步拦截（§8.2），
// 客户端不做任何「放行」逻辑，仅展示拦截提示。
// ============================================================================

import { http } from './request'
import type { ConversationDTO, MessageDTO, PrivacyBindingDTO } from '@/types'

/** 会话 + 消息（端侧聚合视图：列表接口不含消息体） */
export interface ConversationDetail extends ConversationDTO {
  messages: MessageDTO[]
}

/** 按订单取/建会话（1:1；隐私号 AXB 绑定随会话生命周期） */
export async function getOrCreateConversation(orderId: string): Promise<ConversationDetail> {
  return http.post<ConversationDetail>(`/im/conversations/order/${orderId}`)
}

/** 消息历史 */
export async function fetchMessages(conversationId: string): Promise<MessageDTO[]> {
  return http.get<MessageDTO[]>(`/im/conversations/${conversationId}/messages`)
}

/** 发消息（TEXT / VOICE；服务端同步风控） */
export async function sendMessage(
  conversationId: string,
  payload: { msgType: 'TEXT' | 'VOICE'; content: string; voiceDurationMs?: number },
): Promise<MessageDTO[]> {
  return http.post<MessageDTO[]>(`/im/conversations/${conversationId}/messages`, payload as Record<string, unknown>)
}

/** 已读回执 */
export async function markRead(conversationId: string): Promise<void> {
  await http.post(`/im/conversations/${conversationId}/read`)
}

/** 隐私号绑定状态（拨打用虚拟号；完成 +24h 解绑） */
export async function fetchPrivacyBinding(orderId: string): Promise<PrivacyBindingDTO> {
  return http.get<PrivacyBindingDTO>(`/im/privacy-binding/order/${orderId}`)
}
