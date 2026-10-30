import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import EmptyState from '@/components/empty-state'
import { fetchCompanionDetail } from '@/services/companion'
import { useRequireAuth } from '@/utils/hooks'
import { distanceText, fenToYuan, formatDateCN, formatDateWithWeekday, ratingText } from '@/utils/format'
import type { CompanionDetail } from '@/types'

// ============================================================================
// 陪聊员详情：资料/标签/评分/价格/可约时段/评价
// 红线：CompanionPublicDTO 脱敏口径，不展示证件/真名/手机号
// ============================================================================

export default function CompanionDetailPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const params = router?.params || {}
  const id = params.id || ''
  const elderUserId = params.elderUserId // 子女代下单入口带入
  const [detail, setDetail] = useState<CompanionDetail | null>(null)
  const [dateIdx, setDateIdx] = useState(0)
  const [slot, setSlot] = useState('')

  useEffect(() => {
    if (!id) return
    fetchCompanionDetail(id).then(setDetail).catch(() => setDetail(null))
  }, [id])

  const goBooking = () => {
    if (!slot) {
      Taro.showToast({ title: '请先选择可约时段', icon: 'none' })
      return
    }
    const day = detail?.slots[dateIdx]
    Taro.navigateTo({
      url: `/pages/booking/index?companionId=${id}&serviceDate=${day?.date || ''}&slotStart=${slot}${
        elderUserId ? `&elderUserId=${elderUserId}` : ''
      }`,
    })
  }

  if (!detail) {
    return (
      <PageWrap>
        <EmptyState icon="⌛" title="加载中…" desc="若长时间无响应请返回重试" />
      </PageWrap>
    )
  }

  const day = detail.slots[dateIdx]

  return (
    <PageWrap>
      {/* 头部资料卡 */}
      <View className="card">
        <View className="row gap-24">
          <View className="avatar avatar-lg">{detail.nickname.slice(0, 1)}</View>
          <View className="flex-1 col gap-8">
            <View className="row gap-16">
              <Text className="t-title">{detail.nickname}</Text>
              <Text className="tag">Lv.{detail.level}</Text>
            </View>
            <Text className="t-sub">
              ★ {ratingText(Number(detail.ratingAvg))} · {detail.ratingCount} 条评价 · 已服务{' '}
              {detail.totalOrders} 单
            </Text>
            <Text className="t-sub">距您 {distanceText(detail.distanceM ?? 0)} · 服务半径 {detail.serviceRadiusM} 米</Text>
          </View>
        </View>
        <View className="row gap-8 mt-16" style="flex-wrap: wrap;">
          {(detail.tags || []).map((t) => (
            <Text key={t} className="tag">
              {t}
            </Text>
          ))}
        </View>
        <Text className="t-body mt-16">{detail.intro}</Text>
        <View className="row-between mt-16">
          <Text className="t-price">{fenToYuan(detail.hourlyRateFen, true)}</Text>
          <Text className="t-sub">/ 小时 · 可开具平台发票</Text>
        </View>
      </View>

      {/* 可约时段 */}
      <View className="card">
        <Text className="t-strong">可约时段</Text>
        <View className="row gap-16 mt-16" style="overflow-x: auto; padding-bottom: 8rpx;">
          {detail.slots.map((s, i) => (
            <View
              key={s.date}
              className={`date-chip ${i === dateIdx ? 'active' : ''}`}
              onClick={() => {
                setDateIdx(i)
                setSlot('')
              }}
            >
              <Text className="t-strong" style="font-size: 26rpx;">
                {formatDateCN(s.date)}
              </Text>
              <Text className="t-weak" style="font-size: 22rpx;">
                {formatDateWithWeekday(s.date).split(' ')[1]}
              </Text>
            </View>
          ))}
        </View>
        <View className="row gap-16 mt-16" style="flex-wrap: wrap;">
          {(day?.slots || []).map((s) => (
            <Text
              key={s}
              className={`slot-chip ${slot === s ? 'active' : ''}`}
              onClick={() => setSlot(s)}
            >
              {s}
            </Text>
          ))}
          {day && day.slots.length === 0 ? <Text className="t-sub">当天已约满，看看其他日期</Text> : null}
        </View>
      </View>

      {/* 评价 */}
      <View className="card">
        <Text className="t-strong">老人评价</Text>
        {detail.reviews.length === 0 ? (
          <Text className="t-sub mt-16" style="display: block;">
            暂无评价
          </Text>
        ) : (
          detail.reviews.slice(0, 5).map((r) => (
            <View key={r.id} className="mt-16">
              <View className="row gap-16">
                <Text className="t-brand">★ {r.rating}.0</Text>
                <Text className="t-weak">
                  {r.isAnonymous ? '匿名老人' : '王阿姨'} · {formatDateWithWeekday(r.createdAt.slice(0, 10))}
                </Text>
              </View>
              {r.content ? (
                <Text className="t-body mt-16" style="display: block;">
                  {r.content}
                </Text>
              ) : null}
              {r.replyContent ? (
                <Text className="t-sub mt-16" style="display: block;">
                  陪聊员回复：{r.replyContent}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      {/* 底部预约栏 */}
      <View className="bottom-bar">
        <View className="col flex-1">
          <Text className="t-price">{fenToYuan(detail.hourlyRateFen, true)}</Text>
          <Text className="t-weak">每小时起</Text>
        </View>
        <View className="btn-primary" style="flex: 2;" onClick={goBooking}>
          立即预约
        </View>
      </View>
    </PageWrap>
  )
}
