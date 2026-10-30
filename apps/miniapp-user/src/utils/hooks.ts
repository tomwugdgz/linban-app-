// ============================================================================
// 页面通用 hooks
// ============================================================================

import { useEffect } from 'react'
import Taro from '@tarojs/taro'
import { useAuthStore } from '@/stores/auth'

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

/** 下拉刷新 + 停止刷新封装 */
export function usePullRefresh(onRefresh: () => void | Promise<void>) {
  useEffect(() => {
    Taro.startPullDownRefresh()
    Promise.resolve(onRefresh()).finally(() => Taro.stopPullDownRefresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
