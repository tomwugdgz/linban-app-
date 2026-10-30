import { useCallback, useEffect, useState } from 'react'
import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import PageWrap from '@/components/page-wrap'
import OrderStatusTag from '@/components/order-status-tag'
import { useRequireAuth } from '@/utils/hooks'
import {
  createFamilyBinding,
  fetchFamilyBindings,
  revokeFamilyBinding,
} from '@/services/user'
import { fetchOrders, nightConfirm } from '@/services/order'
import { fenToYuan, formatDateWithWeekday, formatTime, durationText } from '@/utils/format'
import { NIGHT_PENDING_TIP, NIGHT_TIMEOUT_TIP } from '@/constants'
import { useAuthStore } from '@/stores/auth'
import type { FamilyBindingDTO, OrderDetailView } from '@/types'

// ============================================================================
// 子女端（家人 tab）
// - 家庭绑定管理（发起/解除；真实需老人确认）；
// - 为父母预约（带 elderUserId 进预约流）；
// - 服务进度查看（授权等级 PROGRESS+，架构 §10.1）；
// - AI 陪伴报告（mock：孤独指数/兴趣/情绪趋势）。
// ============================================================================

export default function FamilyPage() {
  useRequireAuth()
  const user = useAuthStore((s) => s.user)
  const isFamily = user?.role === 'FAMILY'
  const [bindings, setBindings] = useState<FamilyBindingDTO[]>([])
  const [orders, setOrders] = useState<OrderDetailView[]>([])
  const [showBind, setShowBind] = useState(false)
  const [bindPhone, setBindPhone] = useState('')
  const [bindRelation, setBindRelation] = useState('母女')

  const load = useCallback(async () => {
    const [bs, os] = await Promise.all([
      fetchFamilyBindings().catch(() => [] as FamilyBindingDTO[]),
      fetchOrders('all').catch(() => ({ list: [] as OrderDetailView[], total: 0, page: 1, pageSize: 20 })),
    ])
    setBindings(bs)
    setOrders(os.list)
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useDidShow(load)

  const handleBind = async () => {
    if (!/^1\d{10}$/.test(bindPhone)) {
      Taro.showToast({ title: '请输入正确的老人手机号', icon: 'none' })
      return
    }
    await createFamilyBinding(bindPhone, bindRelation)
    setShowBind(false)
    Taro.showToast({ title: '绑定成功（演示环境自动通过）', icon: 'success' })
    load()
  }

  const activeBindings = bindings.filter((b) => b.status === 'ACTIVE')
  // 夜间单待子女确认（仅未确认且非终态的夜间单）
  const pendingNightOrders = orders.filter(
    (o) => o.nightOrder && !o.familyConfirmed && o.status !== 'REFUNDED' && o.status !== 'CANCELLED',
  )
  // 确认超时被 sweep 自动取消（终态 REFUNDED）
  const timeoutRefundOrders = orders.filter((o) => o.nightOrder && o.status === 'REFUNDED')
  const servingOrders = orders.filter((o) =>
    ['PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM'].includes(o.status),
  )

  return (
    <PageWrap>
      {/* 角色提示 */}
      {!isFamily ? (
        <View className="card" style="background: var(--info-bg);">
          <Text className="t-sub">
            当前是老人视角。如需代父母下单和管理服务，请退出后在登录页选择「我帮父母操作」。
          </Text>
        </View>
      ) : null}

      {/* 家庭绑定 */}
      <View className="card">
        <View className="row-between">
          <Text className="t-strong">我的家人</Text>
          <Text className="t-brand" onClick={() => setShowBind(true)}>
            + 绑定老人
          </Text>
        </View>
        {activeBindings.length === 0 ? (
          <Text className="t-sub mt-16" style="display: block;">
            还没有绑定老人。绑定后可代下单、看服务进度（需老人确认）。
          </Text>
        ) : (
          activeBindings.map((b) => (
            <View key={b.id} className="row-between mt-16">
              <View className="row gap-16">
                <View className="avatar" style="width: 72rpx; height: 72rpx; font-size: 30rpx;">
                  {b.elderUser?.nickname?.slice(0, 1) || '长'}
                </View>
                <View className="col">
                  <Text className="t-strong">{b.elderUser?.nickname || '家人'}</Text>
                  <Text className="t-weak">
                    {b.relation} · 授权：{b.authLevel === 'FULL' ? '全部' : b.authLevel === 'PROGRESS' ? '服务进度' : '基础'}
                  </Text>
                </View>
              </View>
              <Text
                className="t-weak"
                onClick={() =>
                  Taro.showModal({ title: '解除绑定？', content: '解除后将无法查看对方服务进度' }).then((r) => {
                    if (r.confirm) revokeFamilyBinding(b.id).then(load)
                  })
                }
              >
                解除
              </Text>
            </View>
          ))
        )}
      </View>

      {/* 为父母预约 */}
      <View className="card">
        <Text className="t-strong">为父母预约陪伴</Text>
        <Text className="t-sub mt-16" style="display: block;">
          选好陪聊员后，服务进度会实时同步到这里
        </Text>
        <View
          className="btn-primary btn-block mt-16"
          onClick={() =>
            Taro.navigateTo({
              url: `/pages/companion-list/index?elderUserId=${activeBindings[0]?.elderUserId || 'u_elder_1'}`,
            })
          }
        >
          去选陪聊员
        </View>
      </View>

      {/* 夜间单待子女确认（夜间单三态：需子女 30 分钟内确认，超时自动取消全额退款） */}
      {pendingNightOrders.length > 0 ? (
        <View className="card" style="background: var(--warning-bg);">
          <Text className="t-strong" style="color: var(--warning);">
            夜间单待您确认（{pendingNightOrders.length}）
          </Text>
          <Text className="t-sub mt-16" style="display: block;">
            {NIGHT_PENDING_TIP}
          </Text>
          {pendingNightOrders.map((o) => (
            <View
              key={o.id}
              className="row-between mt-16"
              style="background: #fff; border-radius: 16rpx; padding: 20rpx;"
            >
              <View className="col flex-1 gap-8">
                <Text className="t-body">
                  {o.elderNickname || '家人'} · {formatDateWithWeekday(o.serviceDate)}{' '}
                  {formatTime(o.slotStart)}
                </Text>
                <Text className="t-weak">
                  {o.companion?.nickname || '待派单'} · {durationText(o.durationMinutes)}
                </Text>
              </View>
              <View
                className="btn-primary btn-sm"
                onClick={async () => {
                  try {
                    await nightConfirm(o.id)
                    Taro.showToast({ title: '已确认', icon: 'success' })
                    load()
                  } catch (e) {
                    Taro.showToast({
                      title: e instanceof Error ? e.message : '确认失败',
                      icon: 'none',
                      duration: 2500,
                    })
                  }
                }}
              >
                我确认
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* 夜间单确认超时自动取消（终态 REFUNDED） */}
      {timeoutRefundOrders.length > 0 ? (
        <View className="card" style="background: #f6efe9;">
          <Text className="t-strong">夜间单确认超时</Text>
          {timeoutRefundOrders.map((o) => (
            <Text key={o.id} className="t-sub mt-16" style="display: block;">
              {o.orderNo}：{NIGHT_TIMEOUT_TIP}
            </Text>
          ))}
        </View>
      ) : null}

      {/* 服务进度 */}
      <View className="card">
        <Text className="t-strong">服务进度</Text>
        {servingOrders.length === 0 ? (
          <Text className="t-sub mt-16" style="display: block;">
            当前没有进行中的服务
          </Text>
        ) : (
          servingOrders.map((o) => (
            <View
              key={o.id}
              className="row-between mt-16"
              onClick={() => Taro.navigateTo({ url: `/pages/order-detail/index?id=${o.id}` })}
            >
              <View className="col">
                <Text className="t-body">{o.companion?.nickname || '派单中'}</Text>
                <Text className="t-weak">
                  {formatDateWithWeekday(o.serviceDate)} {formatTime(o.slotStart)} ·{' '}
                  {durationText(o.durationMinutes)}
                </Text>
              </View>
              <View className="row gap-16">
                <Text className="t-strong">{fenToYuan(o.totalAmountFen, true)}</Text>
                <OrderStatusTag status={o.status} />
              </View>
            </View>
          ))
        )}
      </View>

      {/* AI 陪伴报告（mock） */}
      <View className="card">
        <Text className="t-strong">AI 陪伴周报（演示）</Text>
        <View className="row mt-16" style="gap: 24rpx;">
          <View className="col flex-1" style="align-items: center;">
            <Text className="t-price">32</Text>
            <Text className="t-weak">本周聊天次数</Text>
          </View>
          <View className="col flex-1" style="align-items: center;">
            <Text className="t-price">活跃</Text>
            <Text className="t-weak">情绪趋势</Text>
          </View>
          <View className="col flex-1" style="align-items: center;">
            <Text className="t-price">3</Text>
            <Text className="t-weak">常聊话题</Text>
          </View>
        </View>
        <Text className="t-sub mt-16" style="display: block;">
          常聊：粤剧、养生、儿女近况。建议周末安排一次真人陪伴散步。
        </Text>
      </View>

      {/* 绑定弹窗 */}
      {showBind ? (
        <View className="modal-mask" onClick={() => setShowBind(false)}>
          <View className="modal-box" onClick={(e) => e.stopPropagation()}>
            <Text className="t-title">绑定老人</Text>
            <Text className="t-sub mt-16">输入老人账号手机号，对方确认后生效</Text>
            <Input
              className="input-box mt-24"
              type="number"
              maxlength={11}
              placeholder="老人手机号"
              value={bindPhone}
              onInput={(e) => setBindPhone(e.detail.value)}
            />
            <View className="row gap-16 mt-16">
              {['母女', '父子', '祖孙', '其他'].map((r) => (
                <Text
                  key={r}
                  className={bindRelation === r ? 'tag' : 'tag-plain'}
                  onClick={() => setBindRelation(r)}
                >
                  {r}
                </Text>
              ))}
            </View>
            <View className="row gap-16 mt-24">
              <View className="btn-ghost flex-1" onClick={() => setShowBind(false)}>
                取消
              </View>
              <View className="btn-primary flex-1" onClick={handleBind}>
                发起绑定
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </PageWrap>
  )
}
