import { useEffect, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import ConfirmModal from '@/components/confirm-modal'
import EmptyState from '@/components/empty-state'
import { useRequireAuth } from '@/utils/hooks'
import {
  bindGiftCard,
  claimCoupon,
  fetchCouponTemplates,
  fetchMyCoupons,
  fetchMyGiftCards,
  purchaseGiftCard,
} from '@/services/marketing'
import { claimPolicy, fetchPolicies } from '@/services/insurance'
import { fenToYuan, formatDateTime } from '@/utils/format'
import type { CouponDTO, GiftCardDTO, PolicyDTO, UserCouponDTO } from '@/types'

// ============================================================================
// 营销页：孝心时长卡 / 优惠券 / 保险（分段切换）
// ============================================================================

type Tab = 'card' | 'coupon' | 'insurance'

const TABS: { key: Tab; label: string }[] = [
  { key: 'card', label: '孝心时长卡' },
  { key: 'coupon', label: '优惠券' },
  { key: 'insurance', label: '保险' },
]

/** 时长卡面额选项（金额 + 时长 双余额） */
const CARD_OPTIONS = [
  { faceAmountFen: 50000, durationMinutes: 240 },
  { faceAmountFen: 100000, durationMinutes: 480 },
  { faceAmountFen: 200000, durationMinutes: 960 },
]

export default function MarketingPage() {
  useRequireAuth()
  const router = Taro.getCurrentInstance().router
  const [tab, setTab] = useState<Tab>((router?.params?.tab as Tab) || 'card')
  const [cards, setCards] = useState<GiftCardDTO[]>([])
  const [coupons, setCoupons] = useState<UserCouponDTO[]>([])
  const [templates, setTemplates] = useState<CouponDTO[]>([])
  const [policies, setPolicies] = useState<PolicyDTO[]>([])
  const [buyTarget, setBuyTarget] = useState<{ faceAmountFen: number; durationMinutes: number } | null>(null)
  const [giftMessage, setGiftMessage] = useState('')
  const [bindPhone, setBindPhone] = useState('')
  const [showBind, setShowBind] = useState(false)

  const load = async () => {
    const [c, cp, tpl, pol] = await Promise.all([
      fetchMyGiftCards().catch(() => [] as GiftCardDTO[]),
      fetchMyCoupons().catch(() => [] as UserCouponDTO[]),
      fetchCouponTemplates().catch(() => [] as CouponDTO[]),
      fetchPolicies().catch(() => [] as PolicyDTO[]),
    ])
    setCards(c)
    setCoupons(cp)
    setTemplates(tpl)
    setPolicies(pol)
  }

  useEffect(() => {
    load()
  }, [])

  const handleBuy = async () => {
    if (!buyTarget) return
    // mock：购买即开通（真实：走支付下单 → payOrder）
    const card = await purchaseGiftCard({ ...buyTarget, message: giftMessage })
    Taro.showToast({ title: '购买成功', icon: 'success' })
    setBuyTarget(null)
    setGiftMessage('')
    load()
  }

  const handleClaim = async (couponNo: string) => {
    await claimCoupon(couponNo)
    load()
  }

  const handleBind = async () => {
    if (!/^1\d{10}$/.test(bindPhone)) {
      Taro.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    await bindGiftCard(bindPhone)
    setShowBind(false)
    Taro.showToast({ title: '绑定成功', icon: 'success' })
    load()
  }

  return (
    <PageWrap>
      <View className="px-28" style="padding: 24rpx 0;">
        <View className="segment">
          {TABS.map((t) => (
            <View
              key={t.key}
              className={`segment-item ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </View>
          ))}
        </View>
      </View>

      {/* ---------- 时长卡 ---------- */}
      {tab === 'card' ? (
        <View>
          <View className="card">
            <Text className="t-strong">购买孝心时长卡</Text>
            <Text className="t-sub mt-16" style="display: block;">
              送父母一份陪伴：按小时扣减，可抵用任意陪聊员订单
            </Text>
            {CARD_OPTIONS.map((o) => (
              <View key={o.faceAmountFen} className="row-between mt-24">
                <View className="col">
                  <Text className="t-strong">{fenToYuan(o.faceAmountFen, true)}</Text>
                  <Text className="t-weak">含 {o.durationMinutes} 分钟陪伴时长</Text>
                </View>
                <View className="btn-primary btn-sm" onClick={() => setBuyTarget(o)}>
                  购买
                </View>
              </View>
            ))}
          </View>

          <View className="card">
            <View className="row-between">
              <Text className="t-strong">我的时长卡</Text>
              <Text className="t-brand" onClick={() => setShowBind(true)}>
                绑定受赠卡
              </Text>
            </View>
            {cards.length === 0 ? (
              <Text className="t-sub mt-16" style="display: block;">
                暂无时长卡
              </Text>
            ) : (
              cards.map((c) => (
                <View key={c.cardNo} className="mt-16" style="background: linear-gradient(135deg, #fff1e8, #ffe3d1); border-radius: 16rpx; padding: 24rpx;">
                  <View className="row-between">
                    <Text className="t-strong">{c.cardNo}</Text>
                    <Text className="tag">
                      {c.status === 'ACTIVE' ? '生效中' : c.status === 'USED' ? '已用完' : c.status}
                    </Text>
                  </View>
                  <Text className="t-price mt-16" style="display: block;">
                    余额 {fenToYuan(c.balanceAmountFen, true)}
                  </Text>
                  <Text className="t-sub">
                    剩余 {c.balanceDurationMinutes} 分钟 · 面值 {fenToYuan(c.faceAmountFen, true)}
                    {c.expiresAt ? ` · ${formatDateTime(c.expiresAt)} 过期` : ''}
                  </Text>
                  {c.message ? <Text className="t-sub">留言：{c.message}</Text> : null}
                </View>
              ))
            )}
          </View>
        </View>
      ) : null}

      {/* ---------- 优惠券 ---------- */}
      {tab === 'coupon' ? (
        <View>
          <View className="card">
            <Text className="t-strong">领券中心</Text>
            {templates.map((t) => (
              <View key={t.couponNo} className="row-between mt-16">
                <View className="col flex-1">
                  <Text className="t-body">{t.name}</Text>
                  <Text className="t-weak">
                    {t.type === 'FULL_REDUCTION'
                      ? `满 ${fenToYuan(t.minSpendFen, true)} 减 ${fenToYuan(t.value, true)}`
                      : `抵 ${t.value} 分钟`}
                    （{t.validDays} 天有效）
                  </Text>
                </View>
                <View className="btn-ghost btn-sm" onClick={() => handleClaim(t.couponNo)}>
                  领取
                </View>
              </View>
            ))}
          </View>
          <View className="card">
            <Text className="t-strong">我的优惠券</Text>
            {coupons.length === 0 ? (
              <Text className="t-sub mt-16" style="display: block;">
                暂无优惠券
              </Text>
            ) : (
              coupons.map((c) => (
                <View key={c.userCouponId} className="row-between mt-16">
                  <View className="col flex-1">
                    <Text className="t-body">{c.name}</Text>
                    <Text className="t-weak">
                      {c.type === 'FULL_REDUCTION'
                        ? `满 ${fenToYuan(c.minSpendFen, true)} 减 ${fenToYuan(c.value, true)}`
                        : `抵 ${c.value} 分钟`}
                      {c.expiredAt ? ` · ${formatDateTime(c.expiredAt)} 过期` : ''}
                    </Text>
                  </View>
                  <Text className="tag">{c.status === 'UNUSED' ? '可用' : c.status === 'USED' ? '已用' : '过期'}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      ) : null}

      {/* ---------- 保险 ---------- */}
      {tab === 'insurance' ? (
        <View>
          {policies.length === 0 ? (
            <EmptyState icon="🛡️" title="暂无保单" desc="完成首次服务后自动投保平台责任险" />
          ) : (
            policies.map((p) => (
              <View key={p.policyNo} className="card">
                <View className="row-between">
                  <Text className="t-strong">{p.productName}</Text>
                  <Text className="tag">{p.status === 'ACTIVE' ? '生效中' : p.status}</Text>
                </View>
                <Text className="t-sub mt-16" style="display: block;">
                  承保方：{p.insurer} · 保额 {fenToYuan(p.coverageAmountFen, true)}
                </Text>
                <Text className="t-sub">
                  保障期：{formatDateTime(p.startAt)} 至 {formatDateTime(p.endAt)}
                </Text>
                {p.orderId ? <Text className="t-weak">关联订单：{p.orderId}</Text> : null}
                <View
                  className="btn-ghost btn-sm mt-16"
                  onClick={() => claimPolicy(p.policyNo)}
                >
                  出险报案
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* 购买弹窗 */}
      <ConfirmModal
        visible={!!buyTarget}
        title={`购买 ${buyTarget ? fenToYuan(buyTarget.faceAmountFen, true) : ''} 时长卡`}
        content={`含 ${buyTarget?.durationMinutes || 0} 分钟陪伴时长。购买后自动开通并绑定当前账号。`}
        confirmText="确认购买"
        onConfirm={handleBuy}
        onCancel={() => setBuyTarget(null)}
      />

      {/* 绑定受赠卡弹窗 */}
      {showBind ? (
        <View className="modal-mask" onClick={() => setShowBind(false)}>
          <View className="modal-box" onClick={(e) => e.stopPropagation()}>
            <Text className="t-title">绑定受赠时长卡</Text>
            <Text className="t-sub mt-16">输入购卡人留存的手机号</Text>
            <Input
              className="input-box mt-24"
              type="number"
              maxlength={11}
              placeholder="手机号"
              value={bindPhone}
              onInput={(e) => setBindPhone(e.detail.value)}
            />
            <View className="row gap-16 mt-24">
              <View className="btn-ghost flex-1" onClick={() => setShowBind(false)}>
                取消
              </View>
              <View className="btn-primary flex-1" onClick={handleBind}>
                绑定
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
