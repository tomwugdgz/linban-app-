import { View } from '@tarojs/components'
import { useSettingsStore } from '@/stores/settings'
import type { PropsWithChildren } from 'react'

// ============================================================================
// 页面根容器：统一挂载大字模式类名 + 安全区适配
// 用法：每个页面最外层 <PageWrap> ... </PageWrap>
// ============================================================================

export default function PageWrap({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  const fontScaleClass = useSettingsStore((s) => s.fontScaleClass)
  return <View className={`page-wrap ${fontScaleClass} ${className}`}>{children}</View>
}
