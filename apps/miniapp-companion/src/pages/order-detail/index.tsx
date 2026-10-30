import { useCallback, useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'
import Taro, { usePullDownRefresh } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import ConfirmModal from '@/components/confirm-modal'
import SosLayer from '@/components/sos-layer'
import {
  cancelOrder,
  confirmComplete,
  fetchOrderDetail,
  fetchPrivacyBinding,
  finishService,
  reportSos,
  startService,
} from '@/services/order'
import { useRequireCompanion } from '@/utils/hooks'
import { makePrivacyCall } from '@/services/wx/wechat'
import { fenToYuan, formatDateTime, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { CS_PHONE, ORDER_STATUS_META, PRIVACY_NUMBER_TIP, SUSPEND_TIP } from '@/constants'
import type { CompanionOrderView } from '@/types'
import { order_status } from '@linban/shared'

// ============================================================================
// 陪聊员端订单详情
// ----------------------------------------------------------------------------
// 动作链：到岗核销（→ arrive 页）→ 开始服务 → 结束服务 → 确认完成。
// 红线：
// - §7.2.1 服务核销完成前「待入账」可见但不可提现；
// - SOS：任一端触发 → 订单立即 SUSPENDED，端上醒目红色入口 + 挂起态说明，
//   不可自行恢复（团队 SOS 规则）；
// - 取消违约金：ACCEPTED 前免费，之后 10%（服务端计算，前端只展示金额）。
// ============================================================================

const ACTION_LABELS: Record<string, string> = {
  create: '长辈下单',
  pay: '支付成功',
  accept: '我已接单',
  verify: '到岗核销通过',
  start: '开始服务',
  finish: '服务结束',
  confirm: '完成确认',
  cancel: '订单取消',
  sos_suspend: '紧急挂起（SOS）',
  auto_suspend: '服务超时自动挂起',
  suspend: '平台挂起处理',
  'night-confirm': '夜间单子女确认',
  review: '收到评价',
}

/** 可通话/可 IM 的订单态 */
const CALLABLE: order_status[] = [order_status.ACCEPTED, order_status.ARRIVED, order_status.IN_SERVICE]

export default function OrderDetailPage() {
  useRequireCompanion()
  const router = Taro.getCurrentInstance().router
  const id = router?.params?.id || ''
  const [order, setOrder] = useState<CompanionOrderView | null>(null)
  const [virtualNumber, setVirtualNumber] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const [showSos, setShowSos] = useState(false)
  /** SOS 提交中：浮层按钮 loading 且禁止重复点击 */
  const [sosSubmitting, setSosSubmitting] = useState(false)
  const [showFinish, setShowFinish] = useState(false)
  /** SOS 触发后的风控事件号（用于向客服报进度，非空时展示挂起回执） */
  const [sosEventNo, setSosEventNo] = useState<string | null>(null)
  /** SOS 自动生成的 URGENT 投诉工单号（客服裁决凭据） */
  const [sosComplaintNo, setSosComplaintNo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const o = await fetchOrderDetail(id)
    setOrder(o)
    if (CALLABLE.includes(o.status)) {
      fetchPrivacyBinding(o.id)
        .then((b) => setVirtualNumber(b.virtualNumber || ''))
        .catch(() => setVirtualNumber(''))
    } else {
      setVirtualNumber('')
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])
  usePullDownRefresh(load)

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    try {
      await fn()
      Taro.showToast({ title: okText, icon: 'success' })
      await load()
    } catch (e) {
      Taro.showToast({
        title: e instanceof Error ? e.message : '操作失败，请重试',
        icon: 'none',
        duration: 2500,
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * 提交 SOS（红色浮层 → 3秒倒计时 → 这里发起）。
   *
   * ⚠ 错误处理刻意**不自己弹 toast**：request.ts 对 silent 非 true 的失败会
   * 自动弹全局 toast，这里再弹一次就是双 toast（小程序里两个 toast 会叠在一起，
   * 用户只看到后一个，真实的失败原因反而被盖掉）。
   *
   * 成功文案按服务端 suspended 分两支（只有到岗态才会真挂起单）：
   *   true  → 订单已挂起，平台值守正在介入
   *   false → 求助已发出，平台值守正在介入
   */
  const submitSos = async (description: string) => {
    if (!order || sosSubmitting) return
    setSosSubmitting(true)
    try {
      const res = await reportSos({
        orderId: order.id,
        ...(description ? { description } : {}),
      })
      setShowSos(false)
      setSosEventNo(res.eventNo)
      setSosComplaintNo(res.complaintNo)
      Taro.showModal({
        title: res.suspended ? '订单已挂起' : '求助已发出',
        content: res.suspended
          ? '订单已挂起，平台值守正在介入。请保持电话畅通，恢复或终止由客服裁决。'
          : '求助已发出，平台值守正在介入。当前订单不处于服务中，未触发挂起，请留意客服来电。',
        confirmText: '我知道了',
        showCancel: false,
      })
      await load()
    } catch {
      // 失败文案已由 request 层全局 toast 统一处理，这里不重复弹
    } finally {
      setSosSubmitting(false)
    }
  }

  if (!order) {
    return (
      <PageWrap>
        <Text className="t-sub px-28 mt-24">加载中…</Text>
      </PageWrap>
    )
  }

  const meta = ORDER_STATUS_META[order.status]
  const suspended = order.status === order_status.SUSPENDED

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
          {suspended ? SUSPEND_TIP : meta.desc}
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

      {/* 服务信息 */}
      <View className="card">
        <View className="row-between">
          <Text className="t-sub">服务对象</Text>
          <Text className="t-strong">{order.elderNickname || '长辈'}</Text>
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
          <Text className="t-sub">服务地址</Text>
          <Text className="t-body">{order.addressMasked || '—'}</Text>
        </View>
        <View className="row-between mt-16">
          <Text className="t-sub">距离</Text>
          <Text className="t-body">{order.distanceM ? `${order.distanceM} 米` : '—'}</Text>
        </View>
        <View className="divider" />
        <View className="row-between">
          <Text className="t-sub">订单金额</Text>
          <Text className="t-price">{fenToYuan(order.totalAmountFen, true)}</Text>
        </View>
        {order.sharing ? (
          <>
            <View className="row-between mt-16">
              <Text className="t-sub">我的收入</Text>
              <Text className="t-strong" style="color: var(--success);">
                {fenToYuan(order.sharing.companionIncomeFen, true)}
              </Text>
            </View>
            <Text className="t-weak mt-16" style="display: block;">
              {order.sharing.status === 'FROZEN'
                ? '服务核销完成前为「待入账」，暂不可提现。'
                : order.sharing.status === 'SHARED'
                ? '已结算入账，可在收入中心提现。'
                : '分账已回退。'}
            </Text>
          </>
        ) : null}
        {Number(order.cancelFeeFen) > 0 ? (
          <View className="row-between mt-16">
            <Text className="t-sub">违约金</Text>
            <Text className="t-body" style="color: var(--danger);">
              {fenToYuan(order.cancelFeeFen, true)}（退款 {fenToYuan(order.refundAmountFen, true)}）
            </Text>
          </View>
        ) : null}
      </View>

      {/* 核销结果 */}
      {order.verification ? (
        <View className="card">
          <Text className="t-strong">到岗核销</Text>
          <View className="row-between mt-16">
            <Text className="t-sub">核验结果</Text>
            <Text className="t-body">
              {order.verification.status === 'PASSED' ? '三关已通过' : order.verification.status}
            </Text>
          </View>
          {order.verification.faceScore != null ? (
            <View className="row-between mt-16">
              <Text className="t-sub">人脸分</Text>
              <Text className="t-body">{order.verification.faceScore}</Text>
            </View>
          ) : null}
          {order.verification.gpsDeviationM != null ? (
            <View className="row-between mt-16">
              <Text className="t-sub">定位偏差</Text>
              <Text className="t-body">{order.verification.gpsDeviationM} 米</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 状态时间线 */}
      <View className="card">
        <Text className="t-strong">订单进度</Text>
        <View className="col mt-16">
          {[...order.timeline].reverse().map((t, i) => (
            <View key={t.id} className="row gap-16" style="align-items: flex-start;">
              <View className="col" style="align-items: center; width: 24rpx;">
                <View
                  className="timeline-dot"
                  style={i === 0 ? 'background: var(--brand);' : 'background: var(--text-weak);'}
                />
                {i < order.timeline.length - 1 ? <View className="timeline-line" /> : null}
              </View>
              <View className="flex-1 col gap-8" style="padding-bottom: 24rpx;">
                <Text className="t-body">{ACTION_LABELS[t.action] || t.action}</Text>
                {t.reason ? <Text className="t-weak">{t.reason}</Text> : null}
                <Text className="t-weak">{formatDateTime(t.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* 操作区 */}
      <View className="px-28 col gap-24" style="padding-bottom: 200rpx;">
        {order.status === order_status.ACCEPTED ? (
          <>
            <View
              className="btn-primary btn-block"
              onClick={() => Taro.navigateTo({ url: `/pages/arrive/index?id=${order.id}` })}
            >
              到岗核销（动态码 + 人脸 + 定位）
            </View>
            <View className="btn-danger btn-block" onClick={() => setShowCancel(true)}>
              取消订单
            </View>
            <Text className="t-weak" style="text-align: center;">
              接单后取消将收 10% 违约金，并扣减信用分。
            </Text>
          </>
        ) : null}

        {order.status === order_status.ARRIVED ? (
          <View className="btn-primary btn-block" onClick={() => run(() => startService(order.id), '已开始服务')}>
            开始服务
          </View>
        ) : null}

        {order.status === order_status.IN_SERVICE ? (
          <>
            <View className="btn-primary btn-block" onClick={() => setShowFinish(true)}>
              结束服务
            </View>
            <Text className="t-weak" style="text-align: center;">
              结束后需双方确认，确认完成收入才入账。
            </Text>
          </>
        ) : null}

        {order.status === order_status.PENDING_CONFIRM ? (
          <View className="btn-primary btn-block" onClick={() => run(() => confirmComplete(order.id), '已确认完成')}>
            确认服务完成
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

        {/* SOS 醒目入口（团队规则：陪聊员端接单页需醒目 SOS 入口） */}
        {CALLABLE.includes(order.status) ? (
          <View className="btn-danger btn-block" onClick={() => setShowSos(true)}>
            🆘 紧急求助（SOS）
          </View>
        ) : null}

        {virtualNumber ? <Text className="t-weak" style="text-align: center;">{PRIVACY_NUMBER_TIP}</Text> : null}
      </View>

      <ConfirmModal
        visible={showCancel}
        title="确认取消订单？"
        content="已接单的订单取消将收取 10% 违约金（由平台代扣），并扣减 5 分信用分。请先与长辈沟通。"
        confirmText="确认取消"
        danger
        onConfirm={async () => {
          setShowCancel(false)
          await run(() => cancelOrder(order.id, '陪聊员主动取消'), '订单已取消')
        }}
        onCancel={() => setShowCancel(false)}
      />

      <ConfirmModal
        visible={showFinish}
        title="确认结束服务？"
        content="结束后订单进入待确认状态，需长辈确认后才会计入收入。"
        confirmText="确认结束"
        onConfirm={async () => {
          setShowFinish(false)
          await run(() => finishService(order.id), '服务已结束')
        }}
        onCancel={() => setShowFinish(false)}
      />

      {/*
        SOS 二次确认浮层：红色全屏 + 订单回显 + 3 秒倒计时 + 提交中防重复点击。
        服务端一次调用即不可撤销触发，前端是唯一防线，细节见 components/sos-layer。
      */}
      <SosLayer
        visible={showSos}
        orderNo={order.orderNo}
        elderName={order.elderUser?.nickname || '老人'}
        submitting={sosSubmitting}
        onCancel={() => setShowSos(false)}
        onConfirm={submitSos}
      />

      {/* SOS 触发后的处置回执：给客服凭据 + 一键联系人工（前端不得自行恢复订单） */}
      {sosEventNo ? (
        <View className="px-28">
          <View className="card col gap-12" style="background: var(--danger-bg);">
            <Text className="t-strong" style="color: var(--danger);">
              已发出紧急求助，平台值守介入中
            </Text>
            <Text className="t-weak">
              风控事件号 {sosEventNo}
              {sosComplaintNo ? ` · 工单号 ${sosComplaintNo}` : ''}。恢复或终止由客服裁决，
              请保持电话畅通；你无法在端上自行恢复订单。
            </Text>
            <View className="btn-danger btn-block" onClick={() => Taro.makePhoneCall({ phoneNumber: CS_PHONE })}>
              联系平台客服 {CS_PHONE}
            </View>
          </View>
        </View>
      ) : null}

      {busy ? (
        <View className="modal-mask">
          <View className="modal-box">
            <Text className="t-strong">处理中，请稍候…</Text>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
