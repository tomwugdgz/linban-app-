import { useLaunch } from '@tarojs/taro'
import type { PropsWithChildren, ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth'
import './app.css'

// 邻伴·陪聊员端小程序入口
// - useLaunch：恢复登录态（storage 同步读取，模块加载已完成）
// - 适老化：陪聊员多为中老年从业者，默认大字模式（stores/settings 默认 large）
function App({ children }: PropsWithChildren<ReactNode>) {
  useLaunch(() => {
    const { accessToken, user } = useAuthStore.getState()
    if (!accessToken || !user) {
      console.log('[linban-companion] 未登录态启动')
    }
    console.log('[linban-companion] 陪聊员端启动', { role: user?.role })
  })

  return children
}

export default App
