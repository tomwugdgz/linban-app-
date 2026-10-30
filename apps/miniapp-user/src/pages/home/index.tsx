import { useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import CompanionCard from '@/components/companion-card'
import EmptyState from '@/components/empty-state'
import { fetchNearbyCompanions } from '@/services/companion'
import { fetchMyGiftCards } from '@/services/marketing'
import { useRequireAuth } from '@/utils/hooks'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { fenToYuan } from '@/utils/format'
import { CS_PHONE } from '@/constants'
import type { CompanionPublicDTO, GiftCardDTO } from '@/types'

// ============================================================================
// 首页（老人优先）
// - AI 陪聊大入口（按住说话直达，核心差异化）
// - 陪聊员推荐列表（附近加权）
// - 子女代下单入口 / 营销宫格 / 安全提示
// ============================================================================

export default function HomePage() {
  const authed = useRequireAuth()
  const user = useAuthStore((s) => s.user)
  const fontScale = useSettingsStore((s) => s.fontScale)
  const setFontScale = useSettingsStore((s) => s.setFontScale)
  const [companions, setCompanions] = useState<CompanionPublicDTO[]>([])
  const [giftCard, setGiftCard] = useState<GiftCardDTO | null>(null)

  const load = async () => {
    if (!authed) return
    const [nearby, cards] = await Promise.all([
      fetchNearbyCompanions({ sort: 'distance' }),
      fetchMyGiftCards().catch(() => [] as GiftCardDTO[]),
    ])
    setCompanions(nearby.list.slice(0, 3))
    setGiftCard(cards.find((c) => c.status === 'ACTIVE') ?? null)
  }

  // tab 页每次显示都刷新（下单/支付后回到首页需更新余额）
  useDidShow(() => {
    load()
  })

  const cycleFontScale = () => {
    const next = fontScale === 'normal' ? 'large' : fontScale === 'large' ? 'xlarge' : 'normal'
    setFontScale(next)
    Taro.showToast({
      title: next === 'normal' ? '标准字号' : next === 'large' ? '大字模式' : '特大字模式',
      icon: 'none',
    })
  }

  return (
    <PageWrap>
      {/* 顶部：问候 + 城市 + 大字切换 */}
      <View className="row-between px-28" style="padding-top: 24rpx;">
        <View className="col">
          <Text className="t-title">{user?.nickname ? `${user.nickname}，您好` : '您好'}</Text>
          <Text className="t-sub">广州 · 天河 ▾（演示城市）</Text>
        </View>
        <View className="btn-ghost btn-sm" onClick={cycleFontScale}>
          {fontScale === 'normal' ? 'A 标准' : fontScale === 'large' ? 'A+ 大字' : 'A++ 特大'}
        </View>
      </View>

      {/* AI 陪聊大入口（核心） */}
      <View className="card" style="background: linear-gradient(135deg, #fff1e8, #ffe3d1);">
        <View className="row-between">
          <View className="col gap-8 flex-1">
            <Text className="t-title">小邻陪聊</Text>
            <Text className="t-sub">7×24 语音陪伴，按住就能说</Text>
          </View>
          <View className="avatar" style="font-size: 56rpx;">
            🗣️
          </View>
        </View>
        <View
          className="btn-primary btn-block mt-16 press-breathe"
          onClick={() => Taro.navigateTo({ url: '/subpackages/aiModule/pages/ai-chat/index' })}
        >
          按住说话，陪您聊聊
        </View>
        <Text className="t-weak mt-16" style="display: block;">
          AI 陪聊免费；想见真人陪聊员，随时可以预约
        </Text>
      </View>

      {/* 功能宫格 */}
      <View className="card">
        <View className="row" style="flex-wrap: wrap;">
          <View
            className="grid-entry"
            onClick={() => Taro.navigateTo({ url: '/pages/companion-list/index' })}
          >
            <View className="grid-entry-icon" style="background: var(--brand-light);">
              👵
            </View>
            <Text className="t-sub">找陪聊员</Text>
          </View>
          <View className="grid-entry" onClick={() => Taro.switchTab({ url: '/pages/family/index' })}>
            <View className="grid-entry-icon" style="background: var(--info-bg);">
              👨‍👩‍👧
            </View>
            <Text className="t-sub">子女代下单</Text>
          </View>
          <View
            className="grid-entry"
            onClick={() => Taro.navigateTo({ url: '/pages/marketing/index?tab=card' })}
          >
            <View className="grid-entry-icon" style="background: var(--success-bg);">
              🎫
            </View>
            <Text className="t-sub">孝心时长卡</Text>
          </View>
          <View
            className="grid-entry"
            onClick={() => Taro.navigateTo({ url: '/pages/marketing/index?tab=coupon' })}
          >
            <View className="grid-entry-icon" style="background: var(--warning-bg);">
              🎟️
            </View>
            <Text className="t-sub">优惠券</Text>
          </View>
          <View
            className="grid-entry"
            onClick={() => Taro.navigateTo({ url: '/pages/marketing/index?tab=insurance' })}
          >
            <View className="grid-entry-icon" style="background: var(--purple-bg);">
              🛡️
            </View>
            <Text className="t-sub">保险</Text>
          </View>
          <View
            className="grid-entry"
            onClick={() =>
              Taro.showModal({ title: '联系客服', content: `拨打客服热线 ${CS_PHONE}？`, confirmText: '拨打' }).then((r) => {
                if (r.confirm) Taro.makePhoneCall({ phoneNumber: CS_PHONE })
              })
            }
          >
            <View className="grid-entry-icon" style="background: #f6efe9;">
              📞
            </View>
            <Text className="t-sub">客服</Text>
          </View>
        </View>
      </View>

      {/* 时长卡余额提示 */}
      {giftCard ? (
        <View className="card row-between">
          <View className="col">
            <Text className="t-strong">孝心时长卡 · 余额 {fenToYuan(giftCard.balanceAmountFen, true)}</Text>
            <Text className="t-sub">剩余 {giftCard.balanceDurationMinutes} 分钟陪伴时长</Text>
          </View>
          <View
            className="btn-ghost btn-sm"
            onClick={() => Taro.navigateTo({ url: '/pages/marketing/index?tab=card' })}
          >
            去使用
          </View>
        </View>
      ) : null}

      {/* 推荐陪聊员 */}
      <View className="row-between px-28 mt-24">
        <Text className="t-title">附近推荐</Text>
        <Text className="t-sub" onClick={() => Taro.navigateTo({ url: '/pages/companion-list/index' })}>
          查看全部 ›
        </Text>
      </View>
      {companions.length === 0 ? (
        <EmptyState icon="👵" title="附近陪聊员准备中" desc="广州单城 MVP 首批陪聊员正在上架" />
      ) : (
        companions.map((c) => (
          <CompanionCard
            key={c.id}
            companion={c}
            onClick={() => Taro.navigateTo({ url: `/pages/companion-detail/index?id=${c.id}` })}
          />
        ))
      )}

      {/* 安全提示 */}
      <View className="card" style="background: var(--info-bg);">
        <Text className="t-strong">平台保障</Text>
        <Text className="t-sub mt-16" style="display: block;">
          · 资金平台托管，双方确认完成后才结算
        </Text>
        <Text className="t-sub" style="display: block;">
          · 到岗人脸 + 动态码核销
        </Text>
        <Text className="t-sub" style="display: block;">
          · 隐私号通话，真实号码互不可见
        </Text>
      </View>
    </PageWrap>
  )
}
