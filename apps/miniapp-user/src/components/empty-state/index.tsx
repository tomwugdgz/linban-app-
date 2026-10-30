import { View } from '@tarojs/components'

// ============================================================================
// 空状态（老人端：图标用大字 emoji 字符 + 明确行动指引）
// ============================================================================

interface Props {
  icon?: string
  title: string
  desc?: string
  actionText?: string
  onAction?: () => void
}

export default function EmptyState({ icon = '🌱', title, desc, actionText, onAction }: Props) {
  return (
    <View className="col" style="align-items: center; padding: 120rpx 60rpx; gap: 16rpx;">
      <View className="t-hero">{icon}</View>
      <View className="t-strong">{title}</View>
      {desc ? <View className="t-sub" style="text-align: center;">{desc}</View> : null}
      {actionText && onAction ? (
        <View className="btn-primary btn-sm mt-16" onClick={onAction}>
          {actionText}
        </View>
      ) : null}
    </View>
  )
}
