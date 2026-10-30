// ============================================================================
// IM 服务（契约 §6.1，会话必须挂订单，禁止脱离订单私聊）
// ----------------------------------------------------------------------------
// 风控：服务端同步拦截手机号/微信号/外链，命中返回 BLOCKED，客户端只展示。
// ============================================================================

import { http } from './request'
import type { CompanionConversation, MessageDTO, PageResult } from '@/types'

/** 按订单取/建会话 */
export async function getOrCreateConversation(orderId: string): Promise<CompanionConversation> {
  return http.post<CompanionConversation>(`/im/conversations/order/${orderId}`)
}

/** 我的会话列表 */
export async function fetchConversations(): Promise<PageResult<CompanionConversation>> {
  return http.get<PageResult<CompanionConversation>>('/im/conversations')
}

/** 消息历史 */
export async function fetchMessages(conversationId: string): Promise<MessageDTO[]> {
  return http.get<MessageDTO[]>(`/im/conversations/${conversationId}/messages`)
}

/** 发消息（同步风控拦截） */
export async function sendMessage(
  conversationId: string,
  payload: { msgType: 'TEXT' | 'VOICE' | 'IMAGE'; content: string; voiceDurationMs?: number },
): Promise<MessageDTO[]> {
  return http.post<MessageDTO[]>(
    `/im/conversations/${conversationId}/messages`,
    payload as unknown as Record<string, unknown>,
  )
}

/** 已读回执 */
export async function markRead(conversationId: string): Promise<void> {
  await http.post(`/im/conversations/${conversationId}/read`)
}
