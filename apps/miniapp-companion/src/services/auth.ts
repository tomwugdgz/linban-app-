// ============================================================================
// 认证服务（契约 §3.1）
// ----------------------------------------------------------------------------
// 陪聊员端与用户端共用 /auth/* 端点，登录后 role = COMPANION。
// ============================================================================

import { http } from './request'
import { wxLoginCode } from './wx/wechat'
import type { CompanionLoginResult } from '@/types'

/** 微信一键登录（陪聊员端） */
export async function wxLogin(nickname?: string): Promise<CompanionLoginResult> {
  const code = await wxLoginCode()
  return http.post<CompanionLoginResult>('/auth/wx-login', { code, role: 'COMPANION', nickname })
}

/** 手机号 + 验证码登录 */
export async function phoneLogin(phone: string, code: string): Promise<CompanionLoginResult> {
  return http.post<CompanionLoginResult>('/auth/phone-login', { phone, code, role: 'COMPANION' })
}

/** 发送短信验证码 */
export async function sendSmsCode(phone: string): Promise<void> {
  await http.post('/auth/sms-code', { phone })
}

/** 令牌载荷视图 */
export async function fetchProfile(): Promise<{
  userId: string
  role: string
  nickname: string
  avatarUrl: string | null
  phoneMasked: string | null
  companionId: string
}> {
  return http.get('/auth/profile')
}

/** 登出 */
export async function logout(): Promise<void> {
  await http.post('/auth/logout')
}
