// ============================================================================
// 认证服务（对齐契约 §3.1）
// ============================================================================

import { http } from './request'
import { wxLoginCode } from './wx/wechat'
import { useAuthStore } from '@/stores/auth'
import { user_role } from '@linban/shared'
import type { LoginResult, LoginUser, UserProfileDTO } from '@/types'

/**
 * 微信一键登录（老人/子女同一入口，role 区分视角）。
 * 流程：Taro.login 拿 code → POST /auth/wx-login → accessToken。
 */
export async function wxLogin(role: 'ELDER' | 'FAMILY'): Promise<LoginResult> {
  const code = await wxLoginCode()
  const result = await http.post<LoginResult>('/auth/wx-login', { code, role })
  useAuthStore.getState().setLogin(result)
  return result
}

/** 手机号 + 验证码登录（备用通道） */
export async function phoneLogin(phone: string, code: string): Promise<LoginResult> {
  const result = await http.post<LoginResult>('/auth/phone-login', { phone, code })
  useAuthStore.getState().setLogin(result)
  return result
}

/** 发送短信验证码（演示固定 123456） */
export async function sendSmsCode(phone: string): Promise<void> {
  await http.post('/auth/sms-code', { phone })
}

/** 登出（清理本地登录态） */
export async function logout(): Promise<void> {
  try {
    await http.post('/auth/logout', {}, true)
  } catch {
    /* 忽略网络错误，本地态照常清理 */
  }
  useAuthStore.getState().logout()
}

/** 我的令牌视图（UserProfileDTO：脱敏 + 老人档案） */
export async function fetchProfile(): Promise<UserProfileDTO> {
  const profile = await http.get<UserProfileDTO>('/auth/profile')
  useAuthStore.getState().updateUser({
    id: profile.id,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl,
    // 服务端 role 是 user_role 枚举（含 SYSTEM：后台/系统账号，不走小程序登录）。
    // 端上模型只承认三种可登录角色，SYSTEM 落到 unknown 分支不写入，
    // 避免把不可登录的角色混进 store 后让页面判断失效。
    role: toLoginRole(profile.role),
    phoneMasked: profile.phoneMasked,
  })
  return profile
}

/** user_role → 端侧 LoginUser.role 的窄化（SYSTEM/COMPANION 之外的都视为不可登录） */
function toLoginRole(role: user_role): LoginUser['role'] {
  if (role === user_role.ELDER || role === user_role.FAMILY || role === user_role.COMPANION) return role
  return user_role.ELDER
}
