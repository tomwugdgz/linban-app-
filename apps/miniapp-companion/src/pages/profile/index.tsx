import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import { fetchDepositTxs, fetchMyCompanion } from '@/services/companion'
import { useRequireCompanion } from '@/utils/hooks'
import { fenToYuan, formatDateTime } from '@/utils/format'
import { COMPANION_STATUS_META, DEPOSIT_TX_META, CS_PHONE } from '@/constants'
import type { CompanionSelfView, DepositTxDTO } from '@/types'

// ============================================================================
// 我的（陪聊员主档 + 保证金流水 + 入口）
// ============================================================================

export default function ProfilePage() {
  useRequireCompanion()
  const [self, setSelf] = useState<CompanionSelfView | null>(null)
  const [deposits, setDeposits] = useState<DepositTxDTO[]>([])

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      fetchMyCompanion().catch(() => null),
      fetchDepositTxs().catch(() => [] as DepositTxDTO[]),
    ])
    setSelf(s)
    setDeposits(d)
  }, [])

  useDidShow(load)

  const statusMeta = self
    ? COMPANION_STATUS_META[self.status as keyof typeof COMPANION_STATUS_META]
    : null

  return (
    <PageWrap>
      {/* 主档 */}
      <View className="card row gap-24">
        <View className="avatar avatar-lg">张</View>
        <View className="col flex-1 gap-8">
          <Text className="t-title">张阿姨</Text>
          <Text className="t-sub">
            {statusMeta ? `状态：${statusMeta.label}` : '加载中…'} · 信用分 {self?.creditScore ?? '-'}
          </Text>
          <View className="row gap-16" style="flex-wrap: wrap;">
            {self?.tags?.map((t) => (
              <View key={t} className="tag-plain">
                {t}
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 数据卡 */}
      <View className="card row-between">
        <View className="col" style={{ alignItems: 'center', flex: 1 }}>
          <Text className="t-strong">{self?.totalOrders ?? 0}</Text>
          <Text className="t-weak">累计接单</Text>
        </View>
        <View className="col" style={{ alignItems: 'center', flex: 1 }}>
          <Text className="t-strong">{self?.ratingAvg ?? '—'}</Text>
          <Text className="t-weak">评分</Text>
        </View>
        <View className="col" style={{ alignItems: 'center', flex: 1 }}>
          <Text className="t-strong">{fenToYuan(self?.hourlyRateFen || '0', true)}</Text>
          <Text className="t-weak">时薪</Text>
        </View>
      </View>

      {/* 保证金 */}
      <View className="card">
        <View className="row-between">
          <Text className="t-strong">保证金</Text>
          <Text className="t-price">{fenToYuan(self?.depositBalanceFen || '0', true)}</Text>
        </View>
        {deposits.length === 0 ? (
          <Text className="t-weak mt-16" style="display: block;">
            暂无保证金流水
          </Text>
        ) : (
          <View className="col mt-16">
            {deposits.map((d) => (
              <View
                key={d.id}
                className="row-between"
                style="padding: 16rpx 0; border-bottom: 1rpx solid var(--line);"
              >
                <View className="col gap-8">
                  <Text className="t-body">
                    {DEPOSIT_TX_META[d.type]} {fenToYuan(d.amountFen, true)}
                  </Text>
                  <Text className="t-weak">
                    {d.txNo} · {formatDateTime(d.createdAt)}
                  </Text>
                </View>
                <Text className="t-sub">余额 {fenToYuan(d.balanceAfterFen, true)}</Text>
              </View>
            ))}
          </View>
        )}
        <Text className="t-weak mt-16" style="display: block;">
          正常退出且 30 天无纠纷，保证金原路退还。
        </Text>
      </View>

      {/* 入口 */}
      <View className="card col gap-16">
        {[
          { icon: '📅', label: '我的日程', url: '/pages/schedule/index' },
          { icon: '💰', label: '收入中心', url: '/pages/income/index' },
          { icon: '⭐', label: '信用分与规则', url: '/pages/credit/index' },
          { icon: '📋', label: '入驻审核进度', url: '/pages/onboarding/index' },
          { icon: '⚙️', label: '设置', url: '/pages/settings/index' },
        ].map((e) => (
          <View
            key={e.label}
            className="row-between"
            style="padding: 24rpx 0; border-bottom: 1rpx solid var(--line);"
            onClick={() => Taro.navigateTo({ url: e.url })}
          >
            <View className="row gap-16">
              <Text style="font-size: calc(36rpx * var(--font-scale));">{e.icon}</Text>
              <Text className="t-body">{e.label}</Text>
            </View>
            <Text className="t-weak">›</Text>
          </View>
        ))}
      </View>

      {/* 客服 */}
      <View className="card">
        <Text className="t-strong">联系客服</Text>
        <Text className="t-sub mt-16" style="display: block;">
          客服热线 {CS_PHONE}（每日 8:00–22:00）
        </Text>
        <View
          className="btn-ghost btn-block mt-16"
          onClick={() => Taro.makePhoneCall({ phoneNumber: CS_PHONE })}
        >
          📞 拨打客服热线
        </View>
      </View>
    </PageWrap>
  )
}
