import { Text, View } from '@tarojs/components'
import { distanceText, fenToYuan, ratingText } from '@/utils/format'
import type { CompanionPublicDTO } from '@/types'

// ============================================================================
// 陪聊员卡片（推荐列表/搜索结果）
// 脱敏口径：只展示昵称/标签/评分/价格/距离（CompanionPublicDTO）
// ============================================================================

interface Props {
  companion: CompanionPublicDTO
  onBook?: (companion: CompanionPublicDTO) => void
  onClick?: (companion: CompanionPublicDTO) => void
}

export default function CompanionCard({ companion, onBook, onClick }: Props) {
  return (
    <View className="card" onClick={() => onClick?.(companion)}>
      <View className="row gap-24">
        <View className="avatar">{companion.nickname.slice(0, 1)}</View>
        <View className="flex-1 col gap-8">
          <View className="row gap-16">
            <Text className="t-strong ellipsis">{companion.nickname}</Text>
            <Text className="tag">Lv.{companion.level}</Text>
          </View>
          <View className="row gap-16 t-sub">
            <Text className="t-brand">★ {ratingText(Number(companion.ratingAvg))}</Text>
            <Text>({companion.ratingCount} 单)</Text>
            {companion.distanceM != null ? <Text>· {distanceText(companion.distanceM)}</Text> : null}
          </View>
          <View className="row gap-8" style="flex-wrap: wrap;">
            {(companion.tags || []).slice(0, 3).map((t) => (
              <Text key={t} className="tag-plain">
                {t}
              </Text>
            ))}
          </View>
        </View>
        <View className="col" style="align-items: flex-end; gap: 8rpx;">
          <Text className="t-price">{fenToYuan(companion.hourlyRateFen, true)}</Text>
          <Text className="t-weak">/ 小时</Text>
        </View>
      </View>
      {onBook ? (
        <View className="row mt-16" style="justify-content: flex-end;">
          <View
            className="btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onBook(companion)
            }}
          >
            预约 TA
          </View>
        </View>
      ) : null}
    </View>
  )
}
