import { useEffect, useMemo, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import StepProgress from '@/components/step-progress'
import ConfirmModal from '@/components/confirm-modal'
import { fetchCompanionDetail } from '@/services/companion'
import { fetchMyCoupons, fetchMyGiftCards } from '@/services/marketing'
import { createOrder, payOrder, quotePrice } from '@/services/order'
import { useRequireAuth } from '@/utils/hooks'
import { fenToYuan, formatDateCN, formatDateWithWeekday, durationText } from '@/utils/format'
import { BOUNDARY_AGREEMENT_VERSION, DURATION_OPTIONS } from '@/constants'
import type { CompanionDetail, GiftCardDTO, UserCouponDTO } from '@/types'

// ============================================================================
// 预约流程（4 步）：选日期时段 → 选时长 → 时长卡/优惠券抵扣 → 确认并支付
// - 金额服务端算（POST /orders），前端 quote 仅预览；
// - 夜间单（22:00–06:00）提示子女确认（架构 §10.3）；
// - 支付：POST /payments/prepay → wx.requestPayment（mock 为模拟弹窗）。
// ============================================================================

const STEPS = ['选时段', '选时长', '抵扣', '确认支付']

export default function BookingPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const params = router?.params || {}
  const companionId = params.companionId || ''
  const elderUserId = params.elderUserId // 子女代下单时传入

  const [step, setStep] = useState(0)
  const [detail, setDetail] = useState<CompanionDetail | null>(null)
  const [dateIdx, setDateIdx] = useState(0)
  const [slot, setSlot] = useState(params.slotStart || '')
  const [duration, setDuration] = useState(60)
  const [coupons, setCoupons] = useState<UserCouponDTO[]>([])
  const [cards, setCards] = useState<GiftCardDTO[]>([])
  const [couponId, setCouponId] = useState('')
  const [cardNo, setCardNo] = useState('')
  const [address, setAddress] = useState('广州市天河区体育西路 xx 路 12 号 3 栋 502')
  const [agreed, setAgreed] = useState(false)
  const [paying, setPaying] = useState(false)
  const [confirmPay, setConfirmPay] = useState(false)

  useEffect(() => {
    if (!companionId) return
    Promise.all([
      fetchCompanionDetail(companionId),
      fetchMyCoupons().catch(() => [] as UserCouponDTO[]),
      fetchMyGiftCards().catch(() => [] as GiftCardDTO[]),
    ]).then(([d, c, g]) => {
      setDetail(d)
      setCoupons(c)
      setCards(g)
      // 若从列表带入了时段，定位到对应日期
      if (params.serviceDate) {
        const idx = d.slots.findIndex((s) => s.date === params.serviceDate)
        if (idx >= 0) setDateIdx(idx)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionId])

  const quote = useMemo(() => {
    if (!detail) return null
    const coupon = coupons.find((c) => c.userCouponId === couponId)
    const card = cards.find((g) => g.cardNo === cardNo)
    return quotePrice({
      hourlyRateFen: detail.hourlyRateFen,
      durationMinutes: duration,
      coupon: coupon ? { type: coupon.type, value: coupon.value, minSpendFen: coupon.minSpendFen } : null,
      giftCardBalanceFen: card?.balanceAmountFen,
    })
  }, [detail, duration, couponId, cardNo, coupons, cards])

  const slotHour = slot ? Number(slot.slice(0, 2)) : 0
  const isNight = slotHour >= 22 || slotHour < 6

  const handlePay = async () => {
    if (!detail || !quote) return
    setPaying(true)
    try {
      const order = await createOrder({
        companionId,
        durationMinutes: duration,
        serviceDate: detail.slots[dateIdx]?.date || '',
        slotStart: slot,
        elderUserId,
        giftCardNo: cardNo || undefined,
        userCouponId: couponId || undefined,
        address,
        boundaryAgreementVersion: BOUNDARY_AGREEMENT_VERSION,
      })
      await payOrder(order.id)
      Taro.showToast({ title: '支付成功', icon: 'success' })
      // 支付成功后 redirect 到订单详情（避免回退再次支付）
      Taro.redirectTo({ url: `/pages/order-detail/index?id=${order.id}` })
    } catch {
      /* request 层已 toast */
    } finally {
      setPaying(false)
      setConfirmPay(false)
    }
  }

  if (!detail || !quote) {
    return (
      <PageWrap>
        <Text className="t-sub px-28 mt-24">加载中…</Text>
      </PageWrap>
    )
  }

  const day = detail.slots[dateIdx]

  return (
    <PageWrap>
      <StepProgress steps={STEPS} current={step} />

      {/* ---------- 步骤 1：选日期时段 ---------- */}
      {step === 0 ? (
        <View className="card">
          <Text className="t-strong">选择服务日期与开始时间</Text>
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
              <Text key={s} className={`slot-chip ${slot === s ? 'active' : ''}`} onClick={() => setSlot(s)}>
                {s}
              </Text>
            ))}
          </View>
          {slot && isNight ? (
            <View className="mt-16" style="background: var(--warning-bg); border-radius: 16rpx; padding: 20rpx;">
              <Text className="t-sub" style="color: var(--warning);">
                夜间服务（22:00–06:00）需子女确认后生效，平台将通知绑定家属。
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ---------- 步骤 2：选时长 ---------- */}
      {step === 1 ? (
        <View className="card">
          <Text className="t-strong">选择服务时长</Text>
          <View className="row gap-16 mt-16" style="flex-wrap: wrap;">
            {DURATION_OPTIONS.map((d) => (
              <Text
                key={d}
                className={`slot-chip ${duration === d ? 'active' : ''}`}
                onClick={() => setDuration(d)}
              >
                {durationText(d)}
              </Text>
            ))}
          </View>
          <View className="divider" />
          <View className="row-between">
            <Text className="t-sub">时薪</Text>
            <Text className="t-body">{fenToYuan(detail.hourlyRateFen, true)} / 小时</Text>
          </View>
          <View className="row-between mt-16">
            <Text className="t-sub">原价（{durationText(duration)}）</Text>
            <Text className="t-strong">{fenToYuan(quote.originalAmountFen, true)}</Text>
          </View>
        </View>
      ) : null}

      {/* ---------- 步骤 3：抵扣 ---------- */}
      {step === 2 ? (
        <View className="card">
          <Text className="t-strong">孝心时长卡</Text>
          <Text className="t-sub mt-16" style="display: block;">
            抵扣部分不参与平台分成（由平台营销预算承担）
          </Text>
          <View className="col gap-16 mt-16">
            <Text
              className={`slot-chip ${cardNo === '' ? 'active' : ''}`}
              onClick={() => setCardNo('')}
            >
              不使用
            </Text>
            {cards
              .filter((c) => c.status === 'ACTIVE' && Number(c.balanceAmountFen) > 0)
              .map((c) => (
                <Text
                  key={c.cardNo}
                  className={`slot-chip ${cardNo === c.cardNo ? 'active' : ''}`}
                  onClick={() => setCardNo(c.cardNo)}
                >
                  {c.cardNo.slice(-4)} · 余额 {fenToYuan(c.balanceAmountFen, true)}（{c.balanceDurationMinutes} 分钟）
                </Text>
              ))}
          </View>
          <View className="divider" />
          <Text className="t-strong">优惠券</Text>
          <View className="col gap-16 mt-16">
            <Text className={`slot-chip ${couponId === '' ? 'active' : ''}`} onClick={() => setCouponId('')}>
              不使用
            </Text>
            {coupons
              .filter((c) => c.status === 'UNUSED')
              .map((c) => (
                <Text
                  key={c.userCouponId}
                  className={`slot-chip ${couponId === c.userCouponId ? 'active' : ''}`}
                  onClick={() => setCouponId(c.userCouponId)}
                >
                  {c.name}（{c.type === 'FULL_REDUCTION' ? `减 ${fenToYuan(c.value, true)}` : `抵 ${c.value} 分钟`}）
                </Text>
              ))}
          </View>
          <View className="divider" />
          <View className="row-between">
            <Text className="t-sub">原价</Text>
            <Text className="t-body">{fenToYuan(quote.originalAmountFen, true)}</Text>
          </View>
          <View className="row-between mt-16">
            <Text className="t-sub">优惠券抵扣</Text>
            <Text className="t-body">-{fenToYuan(quote.couponDeductFen, true)}</Text>
          </View>
          <View className="row-between mt-16">
            <Text className="t-sub">时长卡抵扣</Text>
            <Text className="t-body">-{fenToYuan(quote.giftCardDeductFen, true)}</Text>
          </View>
          <View className="row-between mt-16">
            <Text className="t-strong">应付</Text>
            <Text className="t-price">{fenToYuan(quote.totalAmountFen, true)}</Text>
          </View>
        </View>
      ) : null}

      {/* ---------- 步骤 4：确认 ---------- */}
      {step === 3 ? (
        <View className="card">
          {elderUserId ? (
            <View className="row-between">
              <Text className="t-sub">服务对象</Text>
              <Text className="t-strong">王秀芳（子女代下单）</Text>
            </View>
          ) : null}
          <View className="row-between mt-16">
            <Text className="t-sub">陪聊员</Text>
            <Text className="t-strong">{detail.nickname}</Text>
          </View>
          <View className="row-between mt-16">
            <Text className="t-sub">服务时间</Text>
            <Text className="t-body">
              {formatDateWithWeekday(day?.date || '')} {slot} 起 · {durationText(duration)}
            </Text>
          </View>
          <View className="col mt-16">
            <Text className="t-sub">服务地址</Text>
            <Input
              className="input-box mt-16"
              value={address}
              onInput={(e) => setAddress(e.detail.value)}
              placeholder="请填写详细地址（楼栋/门牌）"
            />
          </View>
          <View className="divider" />
          <View className="row-between">
            <Text className="t-sub">订单金额</Text>
            <Text className="t-price">{fenToYuan(quote.totalAmountFen, true)}</Text>
          </View>
          <Text className="t-weak mt-16" style="display: block;">
            其中平台服务费 {fenToYuan(quote.platformCommissionFen, true)}（5%），陪聊员应收{' '}
            {fenToYuan(quote.companionIncomeFen, true)}；资金平台托管，双方确认完成后结算。
          </Text>

          {/* 服务边界确认书（架构 §10.3，下单存证） */}
          <View className="row mt-24" style="align-items: flex-start; gap: 16rpx;">
            <View
              style={`width: 36rpx; height: 36rpx; border-radius: 50%; border: 2rpx solid ${
                agreed ? 'var(--brand)' : 'var(--text-weak)'
              }; background: ${agreed ? 'var(--brand)' : 'transparent'}; display: flex; align-items: center; justify-content: center; margin-top: 6rpx;`}
              onClick={() => setAgreed(!agreed)}
            >
              {agreed ? <Text style="color: #fff; font-size: 24rpx;">✓</Text> : null}
            </View>
            <Text className="t-sub flex-1">
              我已阅读《服务边界确认书 {BOUNDARY_AGREEMENT_VERSION}》：陪聊员仅提供陪伴聊天服务，不提供医疗、
              护理、代办金融业务；服务全程平台留痕。
            </Text>
          </View>
          {isNight ? (
            <View className="mt-16" style="background: var(--warning-bg); border-radius: 16rpx; padding: 20rpx;">
              <Text className="t-sub" style="color: var(--warning);">
                夜间单：支付后需绑定子女确认（演示环境自动通过）。
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 底部操作栏 */}
      <View className="bottom-bar">
        <View className="col flex-1">
          <Text className="t-price">{fenToYuan(quote.totalAmountFen, true)}</Text>
          <Text className="t-weak">
            {step === 0 && slot ? `${formatDateCN(day?.date || '')} ${slot}` : '实付金额'}
          </Text>
        </View>
        {step < 3 ? (
          <View
            className="btn-primary"
            style="flex: 1.4;"
            onClick={() => {
              if (step === 0 && !slot) {
                Taro.showToast({ title: '请选择开始时间', icon: 'none' })
                return
              }
              setStep(step + 1)
            }}
          >
            下一步
          </View>
        ) : (
          <View
            className="btn-primary"
            style="flex: 1.4;"
            onClick={() => {
              if (!agreed) {
                Taro.showToast({ title: '请先确认服务边界确认书', icon: 'none' })
                return
              }
              setConfirmPay(true)
            }}
          >
            {paying ? '支付中…' : '确认支付'}
          </View>
        )}
      </View>

      {/* 支付二次确认（适老化：关键操作两步确认） */}
      <ConfirmModal
        visible={confirmPay}
        title="确认支付"
        content={`将通过微信支付 ${fenToYuan(quote.totalAmountFen, true)}，下单后 15 分钟内未支付将自动取消。`}
        confirmText="确认支付"
        cancelText="再想想"
        onConfirm={handlePay}
        onCancel={() => setConfirmPay(false)}
      />
    </PageWrap>
  )
}
