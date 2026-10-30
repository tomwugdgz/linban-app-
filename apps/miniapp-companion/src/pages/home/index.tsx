import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import { fetchMyApplication, fetchMyCompanion } from '@/services/companion'
import { fetchMyOrders } from '@/services/order'
import { fetchIncomeOverview } from '@/services/income'
import { useRequireCompanion } from '@/utils/hooks'
import { fenToYuan, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { APPLICATION_STAGE_META, COMPANION_STATUS_META, ONBOARDING_STEPS } from '@/constants'
import type { ApplicationStatusDTO, CompanionOrderView, CompanionSelfView, IncomeOverview } from '@/types'
import { order_status } from '@linban/shared'

// ============================================================================
// 陪聊员工作台（首页）
// - 顶部：主档状态 + 信用分 + 今日收入概览；
// - 中部：待办（待到岗/服务中/待确认）订单，一键进入；
// - 底部：四审进度条（未通过时引导入驻）与常用入口。
// ============================================================================

const TODO_STATUSES: order_status[] = [
  order_status.ACCEPTED,
  order_status.ARRIVED,
  order_status.IN_SERVICE,
  order_status.PENDING_CONFIRM,
]

export default function HomePage() {
  useRequireCompanion()
  const [self, setSelf] = useState<CompanionSelfView | null>(null)
  const [app, setApp] = useState<ApplicationStatusDTO | null>(null)
  const [todo, setTodo] = useState<CompanionOrderView[]>([])
  const [income, setIncome] = useState<IncomeOverview | null>(null)

  const load = useCallback(async () => {
    const [s, a, o, inc] = await Promise.all([
      fetchMyCompanion().catch(() => null),
      fetchMyApplication().catch(() => null),
      fetchMyOrders().catch(() => null),
      fetchIncomeOverview().catch(() => null),
    ])
    setSelf(s)
    setApp(a)
    setTodo((o?.list || []).filter((x) => TODO_STATUSES.includes(x.status)))
    setIncome(inc)
  }, [])

  useDidShow(load)
  usePullDownRefresh(load)

  const statusMeta = self ? COMPANION_STATUS_META[self.status as keyof typeof COMPANION_STATUS_META] : null
  const stageMeta = app ? APPLICATION_STAGE_META[app.stage] : null
  // 四审是否已上架
  const onboarded = app?.stage === 'ACTIVE' || app?.stage === 'SUSPENDED' || app?.stage === 'DEPOSIT_OK'

  return (
    <PageWrap>
      {/* 主档卡 */}
      <View className="card" style={statusMeta ? `background: ${statusMeta.bg};` : ''}>
        <View className="row-between">
          <View className="col gap-8">
            <Text className="t-title">张阿姨，您好</Text>
            <Text className="t-sub">
              {statusMeta ? `当前状态：${statusMeta.label}` : '状态加载中…'}
            </Text>
          </View>
          {self ? (
            <View className="col" style={{ alignItems: 'center' }}>
              <Text className="t-price">{self.creditScore}</Text>
              <Text className="t-weak">信用分</Text>
            </View>
          ) : null}
        </View>

        {self ? (
          <View className="row mt-16" style="flex-wrap: wrap; gap: 16rpx;">
            <View className="tag-plain">完成 {self.completedOrders} 单</View>
            <View className="tag-plain">评分 {self.ratingAvg}</View>
            <View className="tag-plain">保证金 {fenToYuan(self.depositBalanceFen, true)}</View>
            <View className="tag-plain">时薪 {fenToYuan(self.hourlyRateFen, true)}/时</View>
          </View>
        ) : null}
      </View>

      {/* 收入概览 */}
      {income ? (
        <View className="card">
          <Text className="t-strong">收入概览</Text>
          <View className="row-between mt-16">
            <View className="col" style={{ alignItems: 'center', flex: 1 }}>
              <Text className="t-price">{fenToYuan(income.availableFen, true)}</Text>
              <Text className="t-weak">可提现</Text>
            </View>
            <View className="col" style={{ alignItems: 'center', flex: 1 }}>
              <Text className="t-strong" style="color: var(--warning);">
                {fenToYuan(income.pendingFen, true)}
              </Text>
              <Text className="t-weak">待入账</Text>
            </View>
            <View className="col" style={{ alignItems: 'center', flex: 1 }}>
              <Text className="t-strong">{fenToYuan(income.monthSharedFen, true)}</Text>
              <Text className="t-weak">本月入账</Text>
            </View>
          </View>
          <Text className="t-weak mt-16" style="display: block;">
            服务核销完成前为「待入账」，暂不可提现。
          </Text>
        </View>
      ) : null}

      {/* 待办订单 */}
      <View className="card">
        <View className="row-between">
          <Text className="t-strong">今日待办</Text>
          <Text className="t-weak" onClick={() => Taro.switchTab({ url: '/pages/orders/index' })}>
            全部订单 ›
          </Text>
        </View>
        {todo.length === 0 ? (
          <Text className="t-sub mt-16" style="display: block;">
            暂无待办。去「接单」看看附近的可接订单吧。
          </Text>
        ) : (
          <View className="col mt-16">
            {todo.map((o) => (
              <View
                key={o.id}
                className="row-between"
                style="padding: 20rpx 0; border-bottom: 1rpx solid var(--line);"
                onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${o.id}` })}
              >
                <View className="col flex-1 gap-8">
                  <View className="row gap-16">
                    <Text className="t-strong">{o.elderNickname || '长辈'}</Text>
                    <OrderStatusTag status={o.status} />
                    {o.nightOrder ? <View className="tag-plain">夜间单</View> : null}
                  </View>
                  <Text className="t-sub">
                    {formatDateWithWeekday(o.serviceDate)} {formatTime(o.slotStart)}–{formatTime(o.slotEnd)} ·{' '}
                    {durationText(o.durationMinutes)}
                  </Text>
                </View>
                <Text className="t-brand">›</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 入驻进度 */}
      {!onboarded ? (
        <View className="card" onClick={() => Taro.navigateTo({ url: '/pages/onboarding/index' })}>
          <View className="row-between">
            <Text className="t-strong">入驻审核进度</Text>
            <Text className="t-brand">{stageMeta?.label || '去完成'} ›</Text>
          </View>
          <View className="row mt-16" style="flex-wrap: wrap; gap: 12rpx;">
            {ONBOARDING_STEPS.map((s, i) => {
              const done = (stageMeta?.step ?? 0) > i
              const current = (stageMeta?.step ?? 0) === i
              return (
                <View
                  key={s.key}
                  className="tag"
                  style={
                    done
                      ? 'background: var(--success-bg); color: var(--success);'
                      : current
                      ? 'background: var(--brand); color: #fff;'
                      : 'background: #f6efe9; color: var(--text-weak);'
                  }
                >
                  {done ? '✓' : i + 1}. {s.title}
                </View>
              )
            })}
          </View>
          <Text className="t-weak mt-16" style="display: block;">
            全部审核通过并缴纳保证金后即可上架接单。
          </Text>
        </View>
      ) : null}

      {/* 功能入口 */}
      <View className="card">
        <Text className="t-strong">常用功能</Text>
        <View className="row mt-16" style="flex-wrap: wrap;">
          {[
            { icon: '📅', label: '我的日程', url: '/pages/schedule/index' },
            { icon: '💰', label: '收入中心', url: '/pages/income/index' },
            { icon: '⭐', label: '信用分', url: '/pages/credit/index' },
            { icon: '⚙️', label: '设置', url: '/pages/settings/index' },
          ].map((e) => (
            <View
              key={e.label}
              className="grid-entry"
              onClick={() => Taro.navigateTo({ url: e.url })}
            >
              <View className="grid-entry-icon" style="background: var(--brand-light);">
                {e.icon}
              </View>
              <Text className="t-sub">{e.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </PageWrap>
  )
}
