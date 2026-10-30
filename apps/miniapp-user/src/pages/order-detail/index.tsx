import { useCallback, useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import ConfirmModal from '@/components/confirm-modal'
import { cancelOrder, confirmComplete, demoAdvance, fetchOrderDetail, payOrder } from '@/services/order'
import { fetchPrivacyBinding } from '@/services/im'
import { reportSos } from '@/services/insurance'
import { useRequireAuth } from '@/utils/hooks'
import { config } from '@/services/request'
import { makePrivacyCall } from '@/services/wx/wechat'
import { fenToYuan, formatDateTime, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { ORDER_STATUS_META, PRIVACY_NUMBER_TIP, CS_PHONE, SUSPEND_TIP } from '@/constants'
import type { OrderDetailView } from '@/types'
import { order_status } from '@linban/shared'

// ============================================================================
// 订单详情：状态时间线 / 隐私号拨打 / 内置 IM / 动态码出示 / 确认完成 / 评价
// - mock 模式附带「演示控制台」：无陪聊员端也能点通 接单→核销→服务→确认 全链路；
// - 红线：前端只发起支付/取消；退款/分账由服务端驱动（§7.1.1）。
// ============================================================================

/** 可通话/可 IM 的订单态（隐私号与平台沟通仅在服务期内可用） */
const CALLABLE: order_status[] = [order_status.ACCEPTED, order_status.ARRIVED, order_status.IN_SERVICE]

const ACTION_LABELS: Record<string, string> = {
  create: '创建订单',
  pay: '支付成功',
  accept: '陪聊员接单',
  verify: '到岗核销通过',
  start: '开始服务',
  finish: '服务结束',
  confirm: '确认完成',
  cancel: '取消订单',
  'night-confirm': '夜间单确认',
  review: '评价完成',
}

export default function OrderDetailPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const id = router?.params?.id || ''
  const [order, setOrder] = useState<OrderDetailView | null>(null)
  const [virtualNumber, setVirtualNumber] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const [showConfirmDone, setShowConfirmDone] = useState(false)
  const [showSos, setShowSos] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const o = await fetchOrderDetail(id)
    setOrder(o)
    if (CALLABLE.includes(o.status)) {
      fetchPrivacyBinding(o.id).then((b) => setVirtualNumber(b.virtualNumber || '')).catch(() => setVirtualNumber(''))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])
  usePullDownRefresh(load)

  if (!order) {
    return (
      <PageWrap>
        <Text className="t-sub px-28 mt-24">加载中…</Text>
      </PageWrap>
    )
  }

  const meta = ORDER_STATUS_META[order.status]

  const handlePay = async () => {
    await payOrder(order.id)
    Taro.showToast({ title: '支付成功', icon: 'success' })
    load()
  }

  const handleCancel = async () => {
    await cancelOrder(order.id, '用户主动取消')
    setShowCancel(false)
    load()
  }

  const handleConfirmDone = async () => {
    await confirmComplete(order.id)
    setShowConfirmDone(false)
    Taro.showToast({ title: '已确认完成', icon: 'success' })
    load()
  }

  const handleSos = async () => {
    await reportSos(order.id)
    setShowSos(false)
  }

  const advance = async (action: 'accept' | 'arrive' | 'start' | 'finish') => {
    await demoAdvance(order.id, action)
    load()
  }

  return (
    <PageWrap>
      {/* 状态头 */}
      <View className="card" style={`background: ${meta.bg};`}>
        <View className="row-between">
          <Text className="t-title" style={`color: ${meta.color};`}>
            {meta.label}
          </Text>
          <OrderStatusTag status={order.status} size="large" />
        </View>
        <Text className="t-sub mt-16" style="display: block;">
          {order.status === order_status.SUSPENDED ? SUSPEND_TIP : meta.desc}
        </Text>
        {order.nightOrder ? (
          <View className="row gap-16 mt-16">
            <View className="tag-plain">夜间单</View>
            <View className="tag-plain">
              {order.familyConfirmed ? '子女已确认' : '待子女确认'}
            </View>
          </View>
        ) : null}
      </View>

      {/* 挂起态：平台值守介入 + 客服联系入口（前端不可自行恢复） */}
      {order.status === order_status.SUSPENDED ? (
        <View className="card" style="background: var(--danger-bg);">
          <Text className="t-strong" style="color: var(--danger);">
            已紧急挂起，平台值守介入中
          </Text>
          <Text className="t-body mt-16" style="display: block;">
            该订单已由平台接管处理，请保持电话畅通。恢复或终止由客服裁决，您这边无法自行操作。
          </Text>
          <View
            className="btn-danger btn-block mt-16"
            onClick={() => Taro.makePhoneCall({ phoneNumber: CS_PHONE })}
          >
            📞 联系平台客服（{CS_PHONE}）
          </View>
        </View>
      ) : null}

      {/* 动态码出示（老人侧：到岗核销） */}
      {order.status === order_status.ACCEPTED && order.verification?.status === 'PENDING' ? (
        <View className="card col" style="align-items: center; gap: 16rpx;">
          <Text className="t-strong">到岗核销动态码</Text>
          <Text className="t-sub">陪聊员到达后，请出示此 6 位数字码给 TA 输入</Text>
          <View className="row gap-16">
            {String(order.verification.dynamicCode || '------').split('').map((d, i) => (
              <View
                key={i}
                style="width: 72rpx; height: 96rpx; background: #fff; border: 2rpx solid var(--line); border-radius: 16rpx; display: flex; align-items: center; justify-content: center; font-size: 48rpx; font-weight: 700;"
              >
                {d}
              </View>
            ))}
          </View>
          <Text className="t-weak">
            {order.verification.codeExpiresAt
              ? `有效期至 ${formatDateTime(order.verification.codeExpiresAt)}`
              : '等待陪聊员到达后自动生成'}
          </Text>
        </View>
      ) : null}

      {/* 服务信息 */}
      <View className="card">
        <View className="row-between">
          <Text className="t-sub">陪聊员</Text>
          <Text className="t-strong">{order.companion?.nickname || '派单中'}</Text>
        </View>
        <View className="row-between mt-16">
          <Text className="t-sub">服务时间</Text>
          <Text className="t-body">
            {formatDateWithWeekday(order.serviceDate)} {formatTime(order.slotStart)}–{formatTime(order.slotEnd)}
          </Text>
        </View>
        <View className="row-between mt-16">
          <Text className="t-sub">时长</Text>
          <Text className="t-body">{durationText(order.durationMinutes)}</Text>
        </View>
        <View className="row-between mt-16">
          <Text className="t-sub">地址</Text>
          <Text className="t-body">{order.addressMasked}</Text>
        </View>
        <View className="divider" />
        <View className="row-between">
          <Text className="t-sub">订单金额</Text>
          <Text className="t-price">{fenToYuan(order.totalAmountFen, true)}</Text>
        </View>
        {Number(order.couponDeductFen) > 0 || Number(order.giftCardDeductFen) > 0 ? (
          <Text className="t-weak mt-16" style="display: block;">
            已抵扣：优惠券 {fenToYuan(order.couponDeductFen, true)} · 时长卡 {fenToYuan(order.giftCardDeductFen, true)}
          </Text>
        ) : null}
        {order.sharing ? (
          <Text className="t-weak mt-16" style="display: block;">
            分账状态：
            {order.sharing.status === 'FROZEN'
              ? `待结算冻结（陪聊员应收 ${fenToYuan(order.sharing.companionIncomeFen, true)}）`
              : order.sharing.status === 'SHARED'
              ? '已完成结算'
              : '已回退'}
          </Text>
        ) : null}
      </View>

      {/* 核销结果 */}
      {order.verification ? (
        <View className="card">
          <Text className="t-strong">到岗核销</Text>
          <View className="row-between mt-16">
            <Text className="t-sub">核验结果</Text>
            <Text className="t-body">
              {order.verification.status === 'PASSED'
                ? '已通过（人脸 + 动态码 + 定位）'
                : order.verification.status === 'PENDING'
                ? '待核验'
                : order.verification.status}
            </Text>
          </View>
          {order.verification.gpsDeviationM != null ? (
            <View className="row-between mt-16">
              <Text className="t-sub">定位偏差</Text>
              <Text className="t-body">{order.verification.gpsDeviationM} 米</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 状态时间线（order_timeline 只增不改） */}
      <View className="card">
        <Text className="t-strong">订单进度</Text>
        <View className="col mt-16">
          {[...order.timeline].reverse().map((t, i) => (
            <View key={t.id} className="row gap-16" style="align-items: flex-start;">
              <View className="col" style="align-items: center; width: 24rpx;">
                <View className="timeline-dot" style={i === 0 ? 'background: var(--brand);' : 'background: var(--text-weak);'} />
                {i < order.timeline.length - 1 ? <View className="timeline-line" /> : null}
              </View>
              <View className="flex-1 col gap-8" style="padding-bottom: 24rpx;">
                <Text className="t-body">{ACTION_LABELS[t.action] || t.action}</Text>
                <Text className="t-weak">{formatDateTime(t.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 操作区 */}
      <View className="px-28 col gap-24" style="padding-bottom: 200rpx;">
        {order.status === order_status.CREATED ? (
          <>
            <View className="btn-primary btn-block" onClick={handlePay}>
              去支付 {fenToYuan(order.totalAmountFen, true)}
            </View>
            <View className="btn-danger btn-block" onClick={() => setShowCancel(true)}>
              取消订单
            </View>
          </>
        ) : null}

        {order.status === order_status.PENDING_CONFIRM ? (
          <>
            <View className="btn-primary btn-block" onClick={() => setShowConfirmDone(true)}>
              确认服务完成
            </View>
            <Text className="t-weak" style="text-align: center;">
              确认后资金才会结算给陪聊员（也可语音说「满意」由系统识别）
            </Text>
          </>
        ) : null}

        {order.status === order_status.COMPLETED && !order.review ? (
          <View
            className="btn-primary btn-block"
            onClick={() => Taro.navigateTo({ url: `/pages/review/index?orderId=${order.id}` })}
          >
            评价这次陪伴
          </View>
        ) : null}

        {CALLABLE.includes(order.status) ? (
          <View className="row gap-16">
            <View
              className="btn-ghost flex-1"
              onClick={() => {
                if (!virtualNumber) {
                  Taro.showToast({ title: '隐私号暂不可用', icon: 'none' })
                  return
                }
                makePrivacyCall(virtualNumber)
              }}
            >
              📞 隐私号拨打
            </View>
            <View
              className="btn-ghost flex-1"
              onClick={() => Taro.navigateTo({ url: `/subpackages/chatModule/pages/im/index?orderId=${order.id}` })}
            >
              💬 平台沟通
            </View>
          </View>
        ) : null}

        {([...CALLABLE, order_status.PENDING_CONFIRM] as order_status[]).includes(order.status) ? (
          <View className="btn-danger btn-block" onClick={() => setShowSos(true)}>
            🆘 一键求助（SOS）
          </View>
        ) : null}

        {virtualNumber ? (
          <Text className="t-weak" style="text-align: center;">
            {PRIVACY_NUMBER_TIP}
          </Text>
        ) : null}

        {order.review ? (
          <View className="card">
            <Text className="t-strong">我的评价</Text>
            <Text className="t-brand mt-16">★ {order.review.rating}.0</Text>
            {order.review.content ? <Text className="t-body mt-16">{order.review.content}</Text> : null}
          </View>
        ) : null}

        {/* 演示控制台：仅 mock 模式，点通无陪聊员端时的状态流转 */}
        {config.USE_MOCK ? (
          <View className="card" style="background: #f6efe9;">
            <Text className="t-strong">演示控制台（仅 mock）</Text>
            <Text className="t-weak mt-16" style="display: block;">
              无陪聊员端时，手动推进订单状态以演示全链路
            </Text>
            <View className="row gap-16 mt-16" style="flex-wrap: wrap;">
              {order.status === order_status.PAID || order.status === order_status.DISPATCHED ? (
                <View className="btn-ghost btn-sm" onClick={() => advance('accept')}>
                  模拟陪聊员接单
                </View>
              ) : null}
              {order.status === order_status.ACCEPTED ? (
                <View className="btn-ghost btn-sm" onClick={() => advance('arrive')}>
                  模拟到岗核销通过
                </View>
              ) : null}
              {order.status === order_status.ARRIVED ? (
                <View className="btn-ghost btn-sm" onClick={() => advance('start')}>
                  模拟开始服务
                </View>
              ) : null}
              {order.status === order_status.IN_SERVICE ? (
                <View className="btn-ghost btn-sm" onClick={() => advance('finish')}>
                  模拟服务结束
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      <ConfirmModal
        visible={showCancel}
        title="取消订单？"
        content="已支付订单将原路退款；接单后取消将收 10% 违约金补偿陪聊员。"
        confirmText="确认取消"
        danger
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
      <ConfirmModal
        visible={showConfirmDone}
        title="确认服务完成？"
        content="确认后平台将按分账规则结算给陪聊员，完成后 7 天内可评价。"
        confirmText="确认完成"
        onConfirm={handleConfirmDone}
        onCancel={() => setShowConfirmDone(false)}
      />
      <ConfirmModal
        visible={showSos}
        title="发起一键求助？"
        content="将立即通知平台值守客服（P0），并同步短信告知您的紧急联系人。"
        confirmText="立即求助"
        danger
        onConfirm={handleSos}
        onCancel={() => setShowSos(false)}
      />
    </PageWrap>
  )
}
