import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import ConfirmModal from '@/components/confirm-modal'
import { useRequireAuth } from '@/utils/hooks'
import { logout } from '@/services/auth'
import { fetchMyGiftCards } from '@/services/marketing'
import { fetchMyCoupons } from '@/services/marketing'
import { fetchPolicies } from '@/services/insurance'
import { useAuthStore } from '@/stores/auth'
import { fenToYuan } from '@/utils/format'
import { CS_PHONE } from '@/constants'
import { useState } from 'react'
import type { GiftCardDTO, PolicyDTO, UserCouponDTO } from '@/types'

// ============================================================================
// 我的：资料卡 + 资产入口 + 客服 + 设置 + 退出登录
// ============================================================================

interface MenuItem {
  icon: string
  label: string
  onClick: () => void
}

export default function ProfilePage() {
  useRequireAuth()
  const user = useAuthStore((s) => s.user)
  const [cards, setCards] = useState<GiftCardDTO[]>([])
  const [coupons, setCoupons] = useState<UserCouponDTO[]>([])
  const [policies, setPolicies] = useState<PolicyDTO[]>([])
  const [showLogout, setShowLogout] = useState(false)

  useDidShow(() => {
    Promise.all([
      fetchMyGiftCards().catch(() => [] as GiftCardDTO[]),
      fetchMyCoupons().catch(() => [] as UserCouponDTO[]),
      fetchPolicies().catch(() => [] as PolicyDTO[]),
    ]).then(([c, cp, p]) => {
      setCards(c)
      setCoupons(cp)
      setPolicies(p)
    })
  })

  const activeCard = cards.find((c) => c.status === 'ACTIVE')
  const unusedCoupons = coupons.filter((c) => c.status === 'UNUSED')

  const menus: MenuItem[] = [
    {
      icon: '🎫',
      label: '孝心时长卡',
      onClick: () => Taro.navigateTo({ url: '/pages/marketing/index?tab=card' }),
    },
    {
      icon: '🎟️',
      label: '优惠券',
      onClick: () => Taro.navigateTo({ url: '/pages/marketing/index?tab=coupon' }),
    },
    {
      icon: '🛡️',
      label: '我的保险',
      onClick: () => Taro.navigateTo({ url: '/pages/marketing/index?tab=insurance' }),
    },
    {
      icon: '👨‍👩‍👧',
      label: '家人绑定',
      onClick: () => Taro.switchTab({ url: '/pages/family/index' }),
    },
    {
      icon: '📞',
      label: '联系客服',
      onClick: () =>
        Taro.showModal({ title: '联系客服', content: `拨打客服热线 ${CS_PHONE}？`, confirmText: '拨打' }).then((r) => {
          if (r.confirm) Taro.makePhoneCall({ phoneNumber: CS_PHONE })
        }),
    },
    {
      icon: '⚙️',
      label: '设置（大字模式/语音）',
      onClick: () => Taro.navigateTo({ url: '/pages/settings/index' }),
    },
  ]

  return (
    <PageWrap>
      {/* 资料卡 */}
      <View className="card row gap-24">
        <View className="avatar avatar-lg">{user?.nickname?.slice(0, 1) || '我'}</View>
        <View className="col gap-8 flex-1">
          <Text className="t-title">{user?.nickname || '未登录'}</Text>
          <Text className="t-sub">
            {user?.role === 'FAMILY' ? '子女账号 · 代父母操作' : '老人账号'} ·{' '}
            {user?.phoneMasked || '未绑定手机'}
          </Text>
        </View>
      </View>

      {/* 资产摘要 */}
      <View className="card row" style="gap: 24rpx;">
        <View className="col flex-1" style="align-items: center;">
          <Text className="t-price">{activeCard ? fenToYuan(activeCard.balanceAmountFen, true) : '¥0.00'}</Text>
          <Text className="t-weak">时长卡余额</Text>
        </View>
        <View className="col flex-1" style="align-items: center;">
          <Text className="t-price">{unusedCoupons.length}</Text>
          <Text className="t-weak">可用优惠券</Text>
        </View>
        <View className="col flex-1" style="align-items: center;">
          <Text className="t-price">{policies.filter((p) => p.status === 'ACTIVE').length}</Text>
          <Text className="t-weak">生效保单</Text>
        </View>
      </View>

      {/* 菜单 */}
      <View className="card" style="padding: 0;">
        {menus.map((m, i) => (
          <View key={m.label}>
            {i > 0 ? <View className="divider" style="margin: 0;" /> : null}
            <View className="row gap-24" style="padding: 28rpx;" onClick={m.onClick}>
              <Text style="font-size: 40rpx;">{m.icon}</Text>
              <Text className="t-body flex-1">{m.label}</Text>
              <Text className="t-weak">›</Text>
            </View>
          </View>
        ))}
      </View>

      <View className="px-28" style="padding-bottom: 60rpx;">
        <View className="btn-danger btn-block" onClick={() => setShowLogout(true)}>
          退出登录
        </View>
      </View>

      <ConfirmModal
        visible={showLogout}
        title="退出登录？"
        content="退出后需重新登录；进行中的订单不受影响。"
        confirmText="退出"
        danger
        onConfirm={async () => {
          await logout()
          Taro.reLaunch({ url: '/pages/login/index' })
        }}
        onCancel={() => setShowLogout(false)}
      />
    </PageWrap>
  )
}
