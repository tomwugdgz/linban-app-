import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import EmptyState from '@/components/empty-state'
import { fetchOrders } from '@/services/order'
import { useRequireAuth } from '@/utils/hooks'
import { fenToYuan, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { ORDER_TABS } from '@/constants'
import type { OrderDetailView } from '@/types'

// ============================================================================
// 订单列表：tab 筛选（全部/待服务/服务中/已完成）
// ============================================================================

export default function OrdersPage() {
  useRequireAuth()
  const [tab, setTab] = useState('all')
  const [list, setList] = useState<OrderDetailView[]>([])

  const load = useCallback(async () => {
    const res = await fetchOrders(tab as 'all' | 'pending' | 'serving' | 'done')
    setList(res.list)
  }, [tab])

  useDidShow(load)
  usePullDownRefresh(load)

  return (
    <PageWrap>
      {/* tab 筛选 */}
      <View className="row px-28" style="padding: 24rpx 0; gap: 32rpx;">
        {ORDER_TABS.map((t) => (
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
          title="还没有订单"
          desc="去首页找位陪聊员，或先和小邻聊聊"
          actionText="去找陪聊员"
          onAction={() => Taro.switchTab({ url: '/pages/home/index' })}
        />
      ) : (
        list.map((o) => (
          <View
            key={o.id}
            className="card"
            onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${o.id}` })}
          >
            <View className="row-between">
              <Text className="t-strong ellipsis flex-1">{o.companion?.nickname || '待派单'}</Text>
              <OrderStatusTag status={o.status} />
            </View>
            <View className="row-between mt-16">
              <Text className="t-sub">
                {formatDateWithWeekday(o.serviceDate)} {formatTime(o.slotStart)} · {durationText(o.durationMinutes)}
              </Text>
              <Text className="t-strong">{fenToYuan(o.totalAmountFen, true)}</Text>
            </View>
            <Text className="t-weak mt-16" style="display: block;">
              单号 {o.orderNo} · {o.nightOrder ? '夜间单' : '日间单'}
            </Text>
          </View>
        ))
      )}
    </PageWrap>
  )
}
