import { useCallback, useMemo, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import EmptyState from '@/components/empty-state'
import { fetchSchedules, updateSchedules } from '@/services/companion'
import { fetchMyOrders } from '@/services/order'
import { useRequireCompanion } from '@/utils/hooks'
import { durationText, nextDays } from '@/utils/format'
import { order_status, schedule_status } from '@linban/shared'
import type { CompanionOrderView, ScheduleDTO } from '@/types'

// ============================================================================
// 我的日程（契约 §4.4 GET /companion/schedules + PUT /companion/schedules）
// ----------------------------------------------------------------------------
// 规则：时段防重 —— 与存量单冲突返回 14003，不做静默覆盖（红线 §7.2.3）。
//
// 页面两块内容：
// 1. **周视图时间格**：一屏看全 7 天 × 时段格（08:00–20:00 逐小时），
//    绿=可接单、灰=停接、白=未开放。目的是让陪聊员一眼看出「这周哪天有空」，
//    逐条列表看不出来。
// 2. **本月已接单时长与可接单时段占比**：接单量与开放率要能被看见，
//    否则「没单」分不清是自己没开放时段还是平台没派单。
// ============================================================================

const WEEK_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 周视图时间格覆盖的整点范围（08:00–20:00） */
const GRID_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]

/** HH:mm 转小时数（分钟忽略：日程粒度为整点/半点，这里只判是否覆盖该小时） */
function hourOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2))
}

/** 本月 key，形如 2026-10 */
function monthKey(d: string): string {
  return d.slice(0, 7)
}

export default function SchedulePage() {
  useRequireCompanion()
  const [list, setList] = useState<ScheduleDTO[]>([])
  const [days, setDays] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [orders, setOrders] = useState<CompanionOrderView[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, o] = await Promise.all([
      fetchSchedules().catch(() => [] as ScheduleDTO[]),
      fetchMyOrders().catch(() => null),
    ])
    setList(s)
    setOrders(o?.list || [])
    if (!selected && s.length) setSelected(s[0].date || '')
  }, [selected])

  useDidShow(() => {
    setDays(nextDays(7))
    load()
  })
  usePullDownRefresh(load)

  /** 某天的日程条目 */
  const dayItems = list.filter((s) => s.date === selected)
  const templateItems = list.filter((s) => !s.date && s.weekday === new Date(selected).getDay())

  /** 周视图时间格：某天某小时的状态（AVAILABLE / BLACKOUT / 未开放） */
  const cellState = useCallback(
    (date: string, hour: number): 'AVAILABLE' | 'BLACKOUT' | 'CLOSED' => {
      const hit = list.filter((s) => {
        const sameDay = s.date === date
        const sameWeekday = !s.date && s.weekday === new Date(date).getDay()
        if (!sameDay && !sameWeekday) return false
        return hour >= hourOf(s.startTime) && hour < hourOf(s.endTime)
      })
      if (!hit.length) return 'CLOSED'
      // 同一天/同一模板内多条命中时，黑out 优先（更保守：宁可少接也不误接）
      return hit.some((s) => s.status === schedule_status.BLACKOUT) ? 'BLACKOUT' : 'AVAILABLE'
    },
    [list],
  )

  /**
   * 本月已接单时长 + 可接单时段占比。
   * 口径：
   * - 已接单时长 = 本月内 status 走到 ACCEPTED 及之后的订单 durationMinutes 之和
   *   （含服务中/待确认，避免「今天在服务」不算进本月成绩）；
   * - 可接单时段占比 = 本月内 AVAILABLE 的日程小时数 / 本月已过期的总小时数。
   *   分母只算「到今天为止」的小时，否则月初看永远是 0%。
   */
  const monthStat = useMemo(() => {
    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const servedMinutes = orders
      .filter((o) => monthKey(o.serviceDate) === ym)
      .filter((o) => o.status !== order_status.CREATED && o.status !== order_status.PAID)
      .filter((o) => o.status !== order_status.DISPATCHED)
      .reduce((acc, o) => acc + (o.durationMinutes || 0), 0)

    // 本月已过去的整点数（含今天 0 点起到当前小时）
    const elapsedHours = (now.getDate() - 1) * 24 + now.getHours()
    const availableHours = list
      .filter((s) => {
        if (!s.date) return false // 周期模板不计入「本月已开放」统计
        return monthKey(s.date) === ym
      })
      .filter((s) => s.status === schedule_status.AVAILABLE)
      .reduce((acc, s) => acc + Math.max(0, hourOf(s.endTime) - hourOf(s.startTime)), 0)

    const ratio = elapsedHours > 0 ? Math.min(1, availableHours / elapsedHours) : 0
    return {
      servedMinutes,
      availableHours,
      elapsedHours,
      percent: Math.round(ratio * 100),
    }
  }, [orders, list])

  const toggle = async (item: ScheduleDTO) => {
    setBusy(true)
    try {
      const next = list.map((s) =>
        s.id === item.id
          ? {
              ...s,
              status: s.status === schedule_status.AVAILABLE ? schedule_status.BLACKOUT : schedule_status.AVAILABLE,
            }
          : s,
      )
      await updateSchedules(next)
      setList(next)
      Taro.showToast({ title: '已更新', icon: 'success' })
    } catch (e) {
      Taro.showToast({
        title: e instanceof Error ? e.message : '更新失败',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageWrap>
      <View className="card">
        <Text className="t-strong">可接单时段</Text>
        <Text className="t-weak mt-16" style="display: block;">
          停接时段不会出现在接单大厅。修改将与已有订单做冲突校验（冲突将拒绝保存）。
        </Text>
      </View>

      {/* 本月成绩：已接单时长 + 可接单时段占比 */}
      <View className="px-28">
        <View className="card col gap-12">
          <View className="row-between">
            <Text className="t-sub">本月已接单时长</Text>
            <Text className="t-strong">{durationText(monthStat.servedMinutes)}</Text>
          </View>
          <View className="row-between">
            <Text className="t-sub">本月可接单时段占比</Text>
            <Text className="t-strong">{monthStat.percent}%</Text>
          </View>
          <View
            style="'height': '16rpx'; border-radius: 8rpx; background: #f0e8e1; overflow: hidden;"
          >
            <View
              style={`height: 100%; width: ${monthStat.percent}%; background: var(--brand);`}
            />
          </View>
          <Text className="t-weak">
            占比偏低说明你开放的时段少，接单大厅里可选的单也少。适当多开放时段能提高接单率。
          </Text>
        </View>
      </View>

      {/* 周视图时间格：一屏看全 7 天 × 08:00–20:00 */}
      <View className="px-28">
        <View className="card col gap-12">
          <View className="row-between">
            <Text className="t-strong">本周时间格</Text>
            <View className="row" style={{ 'gap': '12rpx' }}>
              <View className="row" style={{ 'gap': '6rpx', alignItems: 'center' }}>
                <View
                  style={{ 'width': '14rpx', 'height': '14rpx', 'borderRadius': '4rpx', background: '#1F7A4D' }}
                />
                <Text className="t-weak">可接</Text>
              </View>
              <View className="row" style={{ 'gap': '6rpx', alignItems: 'center' }}>
                <View
                  style={{ 'width': '14rpx', 'height': '14rpx', 'borderRadius': '4rpx', background: '#C9BCB0' }}
                />
                <Text className="t-weak">停接</Text>
              </View>
              <View className="row" style={{ 'gap': '6rpx', alignItems: 'center' }}>
                <View
                  style={{
                    'width': '14rpx',
                    'height': '14rpx',
                    'borderRadius': '4rpx',
                    background: '#F3EDE7',
                  }}
                />
                <Text className="t-weak">未开放</Text>
              </View>
            </View>
          </View>

          {/* 表头：日期列 */}
          <View className="row" style={{ gap: '6rpx', paddingLeft: '68rpx' }}>
            {days.map((d) => (
              <View
                key={d}
                className="col"
                style={{ flex: 1, alignItems: 'center' }}
                onClick={() => setSelected(d)}
              >
                <Text
                  style={{
                    fontSize: 'calc(20rpx * var(--font-scale))',
                    color: selected === d ? 'var(--brand-deep)' : '#8A7B6E',
                  }}
                >
                  {WEEK_LABEL[new Date(d).getDay()]}
                </Text>
                <Text
                  style={{
                    fontSize: 'calc(18rpx * var(--font-scale))',
                    color: selected === d ? 'var(--brand-deep)' : '#B5A79A',
                  }}
                >
                  {d.slice(8)}
                </Text>
              </View>
            ))}
          </View>

          {/* 时间格：行=小时，列=7 天 */}
          {GRID_HOURS.map((h) => (
            <View key={h} className="row" style={{ 'gap': '6rpx', alignItems: 'center' }}>
              <Text className="t-weak" style={{ 'width': '68rpx', fontSize: 'calc(18rpx * var(--font-scale))' }}>
                {String(h).padStart(2, '0')}:00
              </Text>
              {days.map((d) => {
                const st = cellState(d, h)
                const bg =
                  st === 'AVAILABLE'
                    ? '#1F7A4D'
                    : st === 'BLACKOUT'
                      ? '#C9BCB0'
                      : '#F3EDE7'
                return (
                  <View
                    key={`${d}-${h}`}
                    style={{ flex: 1, 'height': '20rpx', 'borderRadius': '4rpx', background: bg }}
                  />
                )
              })}
            </View>
          ))}
        </View>
      </View>

      {/* 日期选择 */}
      <View className="row px-28" style="'padding': '24rpx' 28rpx; 'gap': '16rpx'; flex-wrap: wrap;">
        {days.map((d) => {
          const wd = new Date(d).getDay()
          return (
            <View
              key={d}
              className={`date-chip ${selected === d ? 'active' : ''}`}
              onClick={() => setSelected(d)}
            >
              <Text style={{ fontSize: 'calc(24rpx * var(--font-scale))' }}>{WEEK_LABEL[wd]}</Text>
              <Text style={{ fontSize: 'calc(22rpx * var(--font-scale))' }}>{d.slice(5)}</Text>
            </View>
          )
        })}
      </View>

      {dayItems.length === 0 && templateItems.length === 0 ? (
        <EmptyState icon="📅" title="当天暂无可约时段" desc="可在后台配置周期模板，或联系平台客服加开" />
      ) : (
        <View className="card col gap-16">
          {templateItems.map((s) => (
            <View key={s.id} className="row-between" style="opacity: 0.75;">
              <View className="col gap-8">
                <Text className="t-body">
                  {s.startTime}–{s.endTime}
                </Text>
                <Text className="t-weak">周期模板（每周{WEEK_LABEL[s.weekday ?? 0]}）</Text>
              </View>
              <View className="tag-plain">只读</View>
            </View>
          ))}
          {dayItems.map((s) => (
            <View key={s.id} className="row-between">
              <View className="col gap-8">
                <Text className="t-body">
                  {s.startTime}–{s.endTime}
                </Text>
                <Text className="t-weak">{s.note || '可接单时段'}</Text>
              </View>
              <View
                className={s.status === schedule_status.AVAILABLE ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}
                onClick={() => toggle(s)}
              >
                {s.status === schedule_status.AVAILABLE ? '可接单（点击停接）' : '已停接（点击恢复）'}
              </View>
            </View>
          ))}
        </View>
      )}

      {busy ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">保存中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
