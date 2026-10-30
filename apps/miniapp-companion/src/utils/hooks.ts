// ============================================================================
// 页面通用 hooks
// ============================================================================

import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { useAuthStore } from '@/stores/auth'
import { fetchMyCompanion } from '@/services/companion'
import type { CompanionSelfView } from '@/types'

/** 允许未完成入驻审核访问的页面（四审未通过时只有这几页能进） */
const ONBOARDING_ALLOWED = [
  '/pages/login/index',
  '/pages/onboarding/index',
]

/** 当前路径是否在白名单里（Taro getCurrentInstance 在各端返回结构略有差异，容错取） */
function currentPath(): string {
  try {
    const inst = Taro.getCurrentInstance()
    return (inst as { router?: { path?: string }; page?: { path?: string } }).router?.path
      || (inst as { page?: { path?: string } }).page?.path
      || ''
  } catch {
    return ''
  }
}

/**
 * 登录守卫：未登录页面 reLaunch 到登录页。
 * tab 页（首页/订单/家人/我的）在 useDidShow 中调用。
 */
export function useRequireAuth(): boolean {
  const accessToken = useAuthStore((s) => s.accessToken)
  useEffect(() => {
    if (!accessToken) {
      Taro.reLaunch({ url: '/pages/login/index' })
    }
  }, [accessToken])
  return !!accessToken
}

/**
 * 入驻四审闸门：未 approved（companion.status !== 'ACTIVE'）时，除
 * login / onboarding 外所有页面统一跳入驻向导（主理人派单二硬性规则）。
 *
 * 为什么用 hook 而不是全局拦截：小程序没有路由守卫能力，只能逐页调；
 * 集中在这里是为了让新增页面只需记得调一次 useRequireCompanion()。
 *
 * 返回值给页面用：approved=false 时页面应渲染空态/loading，不要继续拉业务数据。
 */
export function useRequireCompanion(): { approved: boolean; self: CompanionSelfView | null } {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [self, setSelf] = useState<CompanionSelfView | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    fetchMyCompanion()
      .then((s) => {
        if (cancelled) return
        setSelf(s)
        setChecked(true)
        // 只有「已上架 / 暂停接单但曾通过审核」算通过四审。
        // PENDING（审核中）未缴保证金等一律回入驻向导。
        if (s.status !== 'ACTIVE' && s.status !== 'SUSPENDED') {
          const path = currentPath()
          if (path && !ONBOARDING_ALLOWED.includes(path)) {
            Taro.reLaunch({ url: '/pages/onboarding/index' })
          }
        }
      })
      .catch(() => {
        // 主档拉取失败（如 token 过期）时不做跳转，交给 request 层的统一处理
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken])

  const approved = !!self && (self.status === 'ACTIVE' || self.status === 'SUSPENDED')
  return { approved: checked ? approved : false, self }
}

/** 下拉刷新 + 停止刷新封装 */
export function usePullRefresh(onRefresh: () => void | Promise<void>) {
  useEffect(() => {
    Taro.startPullDownRefresh()
    Promise.resolve(onRefresh()).finally(() => Taro.stopPullDownRefresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
