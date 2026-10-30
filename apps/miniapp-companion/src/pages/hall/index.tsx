import { useCallback, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import EmptyState from '@/components/empty-state'
import ConfirmModal from '@/components/confirm-modal'
import { fetchDispatchPool, grabOrder } from '@/services/order'
import { useRequireCompanion } from '@/utils/hooks'
import { fenToYuan, formatDateWithWeekday, formatTime, durationText, distanceText } from '@/utils/format'
import type { DispatchPoolItem } from '@/types'

// ============================================================================
// 接单大厅（契约 §4.2 GET /orders/dispatch/pool + POST /orders/:id/grab）
// ----------------------------------------------------------------------------
// 规则落地：
// - 夜间单（22:00–06:00）未完成子女确认 → 按钮置灰 + 提示「待子女确认」，
//   服务端会以 14007 拒绝接单（契约 §8 夜间单口径）；
// - 抢单失败 14003 = 该时段已被占用，不做静默覆盖（红线 §7.2.3）。
// ============================================================================

export default function HallPage() {
  useRequireCompanion()
  const [list, setList] = useState<DispatchPoolItem[]>([])
  const [target, setTarget] = useState<DispatchPoolItem | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    const pool = await fetchDispatchPool().catch(() => [] as DispatchPoolItem[])
    setList(pool)
  }, [])

  useDidShow(load)
  usePullDownRefresh(load)

  const handleGrab = async () => {
    if (!target) return
    setLoading(true)
    try {
      await grabOrder(target.id)
      setTarget(null)
      Taro.showToast({ title: '接单成功', icon: 'success' })
      Taro.navigateTo({ url: `/pages/order-detail/index?id=${target.id}` })
      load()
    } catch (e) {
      setTarget(null)
      Taro.showToast({
        title: e instanceof Error ? e.message : '接单失败',
        icon: 'none',
        duration: 2500,
      })
      load()
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageWrap>
      <View className="card">
        <Text className="t-strong">附近可接订单</Text>
        <Text className="t-weak mt-16" style="display: block;">
          列表为平台按距离与时段匹配的待接订单。接单成功即锁定该时段，请准时到达。
        </Text>
      </View>

      {list.length === 0 ? (
        <EmptyState icon="🕐" title="暂时没有可接的订单" desc="稍后再来看看，或先完善日程提高匹配度" />
      ) : (
        list.map((item) => {
          const blocked = item.nightOrder && !item.familyConfirmed
          return (
            <View key={item.id} className="card col gap-16">
              <View className="row-between">
                <View className="row gap-16">
                  <Text className="t-strong">陪伴服务</Text>
                  {item.nightOrder ? <View className="tag-plain">夜间单</View> : null}
                </View>
                <Text className="t-price">{fenToYuan(item.estimateIncomeFen, true)}</Text>
              </View>

              <View className="row-between">
                <Text className="t-sub">时间</Text>
                <Text className="t-body">
                  {formatDateWithWeekday(item.serviceDate)} {formatTime(item.slotStart)}–
                  {formatTime(item.slotEnd)}
                </Text>
              </View>
              <View className="row-between">
                <Text className="t-sub">时长</Text>
                <Text className="t-body">{durationText(item.durationMinutes)}</Text>
              </View>
              <View className="row-between">
                <Text className="t-sub">距离</Text>
                <Text className="t-body">{distanceText(item.distanceM)}</Text>
              </View>

              {blocked ? (
                <View className="col gap-8">
                  <View
                    className="btn-primary btn-block"
                    style="background: #e8dcd2; color: #fff;"
                  >
                    待子女确认，暂不可接单
                  </View>
                  <Text className="t-weak" style="text-align: center;">
                    夜间单需由绑定的子女在 30 分钟内确认，未确认前不可接单。
                  </Text>
                </View>
              ) : (
                <View className="btn-primary btn-block" onClick={() => setTarget(item)}>
                  立即接单
                </View>
              )}
            </View>
          )
        })
      )}

      <ConfirmModal
        visible={!!target}
        title="确认接单？"
        content={
          target
            ? `${formatDateWithWeekday(target.serviceDate)} ${formatTime(target.slotStart)}–${formatTime(
                target.slotEnd,
              )}，预计收入 ${fenToYuan(target.estimateIncomeFen, true)}。接单后请按时到达，逾期取消将扣减信用分。`
            : ''
        }
        confirmText="确认接单"
        onConfirm={handleGrab}
        onCancel={() => setTarget(null)}
      />

      {loading ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">接单中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
