import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import EmptyState from '@/components/empty-state'
import { fetchMyOrders } from '@/services/order'
import { useRequireCompanion } from '@/utils/hooks'
import { fenToYuan, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { COMPANION_ORDER_TABS, SUSPEND_TIP } from '@/constants'
import type { CompanionOrderView } from '@/types'
import { order_status } from '@linban/shared'

// ============================================================================
// 我的订单（服务端按 role=COMPANION 视角分流：只看自己接的单）
// ----------------------------------------------------------------------------
// 挂起态（SUSPENDED）：醒目红底提示「已紧急挂起，平台值守介入中」，
// 端上不可自行恢复（团队 SOS 规则）。
// ============================================================================

export default function OrdersPage() {
  useRequireCompanion()
  const [tab, setTab] = useState('all')
  const [list, setList] = useState<CompanionOrderView[]>([])

  const load = useCallback(async () => {
    const res = await fetchMyOrders().catch(() => null)
    const all = res?.list || []
    const def = COMPANION_ORDER_TABS.find((t) => t.key === tab)
    setList(def && def.statuses.length ? all.filter((o) => def.statuses.includes(o.status)) : all)
  }, [tab])

  useDidShow(load)
  usePullDownRefresh(load)

  return (
    <PageWrap>
      {/* tab 筛选 */}
      <View className="row px-28" style="padding: 24rpx 0; gap: 32rpx;">
        {COMPANION_ORDER_TABS.map((t) => (
          <Text
            key={t.key}
            className={tab === t.key ? 't-strong t-brand' : 't-sub'}
            style={tab === t.key ? 'border-bottom: 4rpx solid var(--brand); padding-bottom: 8rpx;' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Text>
        ))}
      </View>

      {list.length === 0 ? (
        <EmptyState
          icon="📋"
          title="暂无相关订单"
          desc="去「接单」看看附近的可接订单"
          actionText="去接单"
          onAction={() => Taro.switchTab({ url: '/pages/hall/index' })}
        />
      ) : (
        list.map((o) => (
          <View
            key={o.id}
            className="card col gap-16"
            onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${o.id}` })}
          >
            <View className="row-between">
              <View className="row gap-16">
                <Text className="t-strong">{o.elderNickname || '长辈'}</Text>
                <OrderStatusTag status={o.status} />
                {o.nightOrder ? <View className="tag-plain">夜间单</View> : null}
              </View>
              <Text className="t-brand">›</Text>
            </View>

            <View className="row-between">
              <Text className="t-sub">服务时间</Text>
              <Text className="t-body">
                {formatDateWithWeekday(o.serviceDate)} {formatTime(o.slotStart)}–{formatTime(o.slotEnd)}
              </Text>
            </View>
            <View className="row-between">
              <Text className="t-sub">时长</Text>
              <Text className="t-body">{durationText(o.durationMinutes)}</Text>
            </View>
            <View className="row-between">
              <Text className="t-sub">订单金额</Text>
              <Text className="t-strong">{fenToYuan(o.totalAmountFen, true)}</Text>
            </View>
            {o.sharing ? (
              <View className="row-between">
                <Text className="t-sub">我的收入</Text>
                <Text className="t-strong" style="color: var(--success);">
                  {fenToYuan(o.sharing.companionIncomeFen, true)}
                  {o.sharing.status === 'FROZEN' ? '（待入账）' : ''}
                </Text>
              </View>
            ) : null}
            {o.status === order_status.SUSPENDED ? (
              <View className="col gap-8" style="background: var(--danger-bg); border-radius: 16rpx; padding: 20rpx;">
                <Text className="t-body" style="color: var(--danger);">
                  {SUSPEND_TIP}
                </Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </PageWrap>
  )
}
