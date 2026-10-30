// ============================================================================
// 登录态 Store（zustand）
// ----------------------------------------------------------------------------
// 选型理由（zustand 而非 Context/Redux）：
// 1. 登录态/适老设置是低频变更的跨页面共享数据，zustand hooks 直连无 Provider
//    样板，页面按需订阅，避免 Context 全树重渲染；
// 2. 体积极小（~1KB gzip），不引入中间件即可满足需求；
// 3. TS 推导友好，store 即类型。
// 注意：小程序渲染层对 setData 敏感，store 只放低频数据；
// 页面高频交互数据（输入、动画状态）一律留在页面 useState。
// ============================================================================

import { create } from 'zustand'
import type { CompanionLoginUser } from '@/types'
import { storage } from '@/utils/storage'

const TOKEN_KEY = 'companion_auth_token'
const REFRESH_KEY = 'companion_auth_refresh_token'
const USER_KEY = 'companion_auth_user'

interface AuthState {
  accessToken: string
  refreshToken: string
  user: CompanionLoginUser | null
  setLogin: (result: { accessToken: string; refreshToken: string; user: CompanionLoginUser }) => void
  updateUser: (patch: Partial<CompanionLoginUser>) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: storage.get<string>(TOKEN_KEY, ''),
  refreshToken: storage.get<string>(REFRESH_KEY, ''),
  user: storage.get<CompanionLoginUser | null>(USER_KEY, null),

  setLogin: (result) => {
    storage.set(TOKEN_KEY, result.accessToken)
    storage.set(REFRESH_KEY, result.refreshToken)
    storage.set(USER_KEY, result.user)
    set({ accessToken: result.accessToken, refreshToken: result.refreshToken, user: result.user })
  },
  updateUser: (patch) =>
    set((s) => {
      if (!s.user) return s
      const next = { ...s.user, ...patch }
      storage.set(USER_KEY, next)
      return { user: next }
    }),
  logout: () => {
    storage.remove(TOKEN_KEY)
    storage.remove(REFRESH_KEY)
    storage.remove(USER_KEY)
    set({ accessToken: '', refreshToken: '', user: null })
  },
}))

/** 非 hooks 场景（service 层）读取 token */
export function getToken(): string {
  return useAuthStore.getState().accessToken
}
