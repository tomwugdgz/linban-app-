import { useLaunch } from '@tarojs/taro'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '@/stores/auth'
import './app.css'

// 邻伴·用户端小程序入口
// - useLaunch：小程序启动时恢复登录态（storage 同步读取，模块加载已完成）
// - 老人优先原则：启动即进入首页（已登录）或登录页（未登录）
function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => {
    const { accessToken, user } = useAuthStore.getState()
    if (!accessToken || !user) {
      // 未登录：不在这里跳转（避免与 tab 页竞争），由页面守卫处理
      console.log('[linban] 未登录态启动')
    }
    console.log('[linban] 用户端启动', { role: user?.role })
  })

  // children 必须返回（Taro React 渲染页面容器）
  return children
}

export default App
