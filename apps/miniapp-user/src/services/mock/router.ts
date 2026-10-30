// ============================================================================
// Mock 路由：按 docs/API-CONTRACT.md 的路径/方法逐条实现
// ----------------------------------------------------------------------------
// 与真实后端同构：service 层代码在 mock/real 两种模式下零改动。
// 边界：mock 只实现「页面可点通」所需语义；资金写操作（退款/分账）按红线
// 一律由服务端驱动，mock 中也不提供前端直连接口。
// 演示专用端点（/orders/:id/demo-advance）仅 mock 存在，用于无陪聊员端时
// 推进订单状态，真实环境删除。
// ============================================================================

import Taro from '@tarojs/taro'
import type {
  AiSessionDTO,
  AiTurnDTO,
  CompanionDetail,
  ConversationDTO,
  CouponDTO,
  FamilyBindingDTO,
  GiftCardDTO,
  LoginResult,
  LoginUser,
  MessageDTO,
  OrderDetailView,
  PaymentPrepayDTO,
  PolicyDTO,
  ReviewDTO,
  UserBriefDTO,
  UserCouponDTO,
} from '@/types'
import {
  order_status,
  payment_status,
  profit_sharing_status,
  verification_status,
  im_sender_role,
  im_message_type,
  im_review_status,
} from '@linban/shared'
import { getDb, saveDb, delay, nid, iso, minutesLater } from './db'
import type { RequestOptions } from '../request'

/** mock 业务错误（信封语义，code 用 @linban/shared ERROR_CODES） */
function bizError(code: number, detail?: string): never {
  const err = new Error(detail || `mock error ${code}`) as Error & { code: number }
  err.code = code
  throw err
}

// ---------------------------------------------------------------------------
// 路径匹配：静态优先，其次 :param 模式
// ---------------------------------------------------------------------------

type Ctx = {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string>
  data: Record<string, any>
}

type Handler = (ctx: Ctx) => unknown

// 订单状态分组（模块级常量，避免字面量数组造成 TS 类型窄化）
const CLOSED_SET: order_status[] = [order_status.CANCELLED, order_status.REFUNDED, order_status.CLOSED]
const TERMINAL_SET: order_status[] = [order_status.CANCELLED, order_status.CLOSED, order_status.REFUNDED]
const ARRIVED_SET: order_status[] = [
  order_status.ARRIVED,
  order_status.IN_SERVICE,
  order_status.PENDING_CONFIRM,
  order_status.COMPLETED,
]
const ACTIVE_SET: order_status[] = [
  order_status.CREATED,
  order_status.PAID,
  order_status.DISPATCHED,
  order_status.ACCEPTED,
]
const SERVICE_SET: order_status[] = [
  order_status.ACCEPTED,
  order_status.ARRIVED,
  order_status.IN_SERVICE,
  order_status.PENDING_CONFIRM,
]

const routes: { method: string; pattern: string; handler: Handler }[] = []

function on(method: string, pattern: string, handler: Handler) {
  routes.push({ method, pattern, handler })
}

function matchRoute(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method === method && r.pattern === path) return { handler: r.handler, params: {} }
  }
  for (const r of routes) {
    if (r.method !== method) continue
    const rp = r.pattern.split('/')
    const pp = path.split('/')
    if (rp.length !== pp.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(pp[i])
      else if (rp[i] !== pp[i]) {
        ok = false
        break
      }
    }
    if (ok) return { handler: r.handler, params }
  }
  return null
}

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

const ELDER_BRIEF: UserBriefDTO = { id: 'u_elder_1', nickname: '王秀芳', avatarUrl: null, role: 'ELDER', status: 'ACTIVE' }
const FAMILY_BRIEF: UserBriefDTO = { id: 'u_family_1', nickname: '陈小芳', avatarUrl: null, role: 'FAMILY', status: 'ACTIVE' }
const COMPANION_BRIEF: UserBriefDTO = { id: 'u_cmp_1', nickname: '陈美华', avatarUrl: null, role: 'COMPANION', status: 'ACTIVE' }

const LOGIN_USERS: Record<string, LoginUser> = {
  ELDER: { id: ELDER_BRIEF.id, nickname: ELDER_BRIEF.nickname, avatarUrl: null, role: 'ELDER', phoneMasked: '138****8888' },
  FAMILY: { id: FAMILY_BRIEF.id, nickname: FAMILY_BRIEF.nickname, avatarUrl: null, role: 'FAMILY', phoneMasked: '138****6666' },
  COMPANION: { id: COMPANION_BRIEF.id, nickname: COMPANION_BRIEF.nickname, avatarUrl: null, role: 'COMPANION', phoneMasked: '137****2233' },
}

function loginResult(role: string): LoginResult {
  const user = LOGIN_USERS[role] || LOGIN_USERS.ELDER
  return {
    accessToken: `mock_at_${role}_${Date.now().toString(36)}`,
    refreshToken: `mock_rt_${role}_${Date.now().toString(36)}`,
    user,
    isNewUser: false,
  }
}

function appendTimeline(order: OrderDetailView, to: order_status, action: string, reason?: string) {
  order.timeline.push({
    id: nid('tl'),
    fromStatus: order.status,
    toStatus: to,
    action,
    operatorType: 'USER',
    operatorId: 'u_elder_1',
    reason: reason ?? null,
    createdAt: iso(new Date()),
  })
  order.status = to
}


/** 生日是否已满 18 岁（夜间单豁免口径 A 用） */
function isAdultBirthday(birthday: string): boolean {
  const b = new Date(birthday)
  if (Number.isNaN(b.getTime())) return false
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1
  return age >= 18
}

const isNightHour = (h: number) => h >= 22 || h < 6

// ---------------------------------------------------------------------------
// /auth（契约 §3.1）
// ---------------------------------------------------------------------------

on('POST', '/auth/wx-login', ({ data }) => loginResult(String(data?.role || 'ELDER')))

on('POST', '/auth/phone-login', ({ data }) => {
  const phone = String(data?.phone || '')
  if (!/^1\d{10}$/.test(phone)) bizError(10001, '手机号格式不正确')
  if (String(data?.code || '') !== '123456') bizError(10001, '验证码不正确（演示固定 123456）')
  return loginResult('ELDER')
})

on('POST', '/auth/sms-code', ({ data }) => {
  const phone = String(data?.phone || '')
  if (!/^1\d{10}$/.test(phone)) bizError(10001, '手机号格式不正确')
  Taro.showToast({ title: '演示验证码：123456', icon: 'none', duration: 3000 })
  return { sent: true, ttlSeconds: 300 }
})

on('POST', '/auth/logout', () => ({ ok: true }))

on('GET', '/auth/profile', () => ({
  ...ELDER_BRIEF,
  phoneMasked: '138****8888',
  createdAt: iso(minutesLater(-100000)),
  elderProfile: {
    userId: 'u_elder_1',
    gender: 'female',
    birthday: '1948-03-12',
    interests: ['粤剧', '散步', '养生'],
    preferences: { fontScale: 1.25, voiceFirst: true },
    emergencyContactName: '陈小芳',
    emergencyContactRelation: '女儿',
    hasEmergencyContactPhone: true,
  },
  companionId: null,
}))

// ---------------------------------------------------------------------------
// /users（契约 §3.1）
// ---------------------------------------------------------------------------

on('GET', '/users/me/profile', () => ({
  ...ELDER_BRIEF,
  phoneMasked: '138****8888',
  createdAt: iso(minutesLater(-100000)),
  elderProfile: {
    userId: 'u_elder_1',
    gender: 'female',
    birthday: '1948-03-12',
    interests: ['粤剧', '散步', '养生'],
    preferences: { fontScale: 1.25, voiceFirst: true },
    emergencyContactName: '陈小芳',
    emergencyContactRelation: '女儿',
    hasEmergencyContactPhone: true,
  },
  companionId: null,
}))

on('PUT', '/users/me/elder-profile', ({ data }) => ({
  userId: 'u_elder_1',
  gender: (data?.gender as string) ?? 'female',
  birthday: (data?.birthday as string) ?? '1948-03-12',
  interests: (data?.interests as string[]) ?? ['粤剧', '散步', '养生'],
  preferences: (data?.preferences as Record<string, unknown>) ?? { fontScale: 1.25, voiceFirst: true },
  emergencyContactName: (data?.emergencyContactName as string) ?? '陈小芳',
  emergencyContactRelation: (data?.emergencyContactRelation as string) ?? '女儿',
  hasEmergencyContactPhone: true,
}))

on('GET', '/users/family-bindings', () => getDb().familyBindings as FamilyBindingDTO[])

on('POST', '/users/family-bindings', ({ data }) => {
  const db = getDb()
  const phone = String(data?.elderPhone || '')
  if (!/^1\d{10}$/.test(phone)) bizError(10001, '请输入正确的老人手机号')
  if (db.familyBindings.some((b) => b.status === 'ACTIVE')) bizError(12002)
  const binding: FamilyBindingDTO = {
    id: nid('fb'),
    familyUserId: FAMILY_BRIEF.id,
    familyUser: FAMILY_BRIEF,
    elderUserId: ELDER_BRIEF.id,
    elderUser: ELDER_BRIEF,
    relation: String(data?.relation || '亲属'),
    authLevel: 'PROGRESS',
    // 真实流程：PENDING，需老人侧 /confirm 后置 active_key='A'；
    // mock 为演示闭环直接置 ACTIVE（TODO 联调改回两段式）。
    status: 'ACTIVE',
    boundAt: iso(new Date()),
    createdAt: iso(new Date()),
  }
  db.familyBindings.push(binding)
  saveDb(db)
  return binding
})

on('POST', '/users/family-bindings/:id/confirm', ({ params }) => {
  const db = getDb()
  const b = db.familyBindings.find((x) => x.id === params.id)
  if (!b) bizError(12003, '绑定关系不存在')
  b.status = 'ACTIVE'
  b.boundAt = iso(new Date())
  saveDb(db)
  return b
})

on('POST', '/users/family-bindings/:id/revoke', ({ params }) => {
  const db = getDb()
  const b = db.familyBindings.find((x) => x.id === params.id)
  if (b) b.status = 'REVOKED'
  saveDb(db)
  return { ok: true }
})

on('POST', '/users/me/cancel-request', () => {
  // 真实：有进行中订单/未结算资金/在审入驻返回 10008
  return { ok: true, cooldownDays: 15 }
})

// ---------------------------------------------------------------------------
// /companions（契约 §3.6，用户态）
// ---------------------------------------------------------------------------

on('GET', '/companions/nearby', ({ query }) => {
  const db = getDb()
  let list = db.companions.filter((c) => c.status === 'ACTIVE')
  const tag = query.tags
  if (tag) list = list.filter((c) => (c.tags || []).some((t) => t.includes(tag)))
  const sort = query.sort || 'distance'
  list = [...list].sort((a, b) => {
    if (sort === 'rating') return Number(b.ratingAvg) - Number(a.ratingAvg)
    if (sort === 'price') return Number(a.hourlyRateFen) - Number(b.hourlyRateFen)
    return (a.distanceM ?? 0) - (b.distanceM ?? 0)
  })
  return { list, total: list.length, page: 1, pageSize: 50 }
})

on('GET', '/companions/:id', ({ params }) => {
  const db = getDb()
  const c = db.companions.find((x) => x.id === params.id)
  if (!c) bizError(13001)
  return c as CompanionDetail
})

// ---------------------------------------------------------------------------
// /orders（契约 §3.2，用户动作）
// ---------------------------------------------------------------------------

on('POST', '/orders', ({ data }) => {
  const db = getDb()
  const companionId = String(data?.companionId || '')
  const durationMinutes = Number(data?.durationMinutes || 60)
  const serviceDate = String(data?.serviceDate || '')
  const slotStart = String(data?.slotStart || '')
  const companion = db.companions.find((c) => c.id === companionId)
  if (!companion) bizError(13001)
  if (companion.status !== 'ACTIVE') bizError(13011)

  // 时段防重（mock 简化版：同陪聊员同日期同时段非终态单即冲突 → 14003）
  const conflict = db.orders.some(
    (o) =>
      o.companion?.id === companionId &&
      o.serviceDate === serviceDate &&
      o.slotStart.slice(11, 16) === slotStart &&
      !CLOSED_SET.includes(o.status),
  )
  if (conflict) bizError(14003)

  const rate = Number(companion.hourlyRateFen)
  const original = Math.round((rate * durationMinutes) / 60)

  // 优惠券抵扣
  let couponDeduct = 0
  let usedCoupon: UserCouponDTO | undefined
  const coupon = db.coupons.find((c) => c.userCouponId === data?.userCouponId && c.status === 'UNUSED')
  if (coupon) {
    if (coupon.type === 'FULL_REDUCTION' && original >= Number(coupon.minSpendFen)) {
      couponDeduct = Math.min(coupon.value, original)
    } else if (coupon.type === 'DURATION') {
      couponDeduct = Math.round((rate * Math.min(coupon.value, durationMinutes)) / 60)
    }
    if (couponDeduct > 0) usedCoupon = coupon
  }
  // 时长卡抵扣
  let giftCardDeduct = 0
  let usedCard: GiftCardDTO | undefined
  const card = db.giftCards.find((g) => g.cardNo === data?.giftCardNo && g.status === 'ACTIVE')
  if (card) {
    const remaining = original - couponDeduct
    giftCardDeduct = Math.min(Number(card.balanceAmountFen), remaining)
    if (giftCardDeduct > 0) {
      const usedMinutes = Math.round((giftCardDeduct / rate) * 60)
      card.balanceAmountFen = String(Number(card.balanceAmountFen) - giftCardDeduct)
      card.balanceDurationMinutes = Math.max(0, card.balanceDurationMinutes - usedMinutes)
      if (Number(card.balanceAmountFen) <= 0) card.status = 'USED'
      usedCard = card
    }
  }
  const total = Math.max(0, original - couponDeduct - giftCardDeduct)

  const hour = Number(slotStart.slice(0, 2)) || 0
  const [hh, mm] = slotStart.split(':').map(Number)
  const slotStartDate = new Date(`${serviceDate}T${String(hh).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}:00`)
  const slotEndDate = new Date(slotStartDate.getTime() + durationMinutes * 60_000)
  const publicCard = {
    id: companion.id,
    userId: companion.userId,
    nickname: companion.nickname,
    avatarUrl: companion.avatarUrl,
    level: companion.level,
    ratingAvg: companion.ratingAvg,
    ratingCount: companion.ratingCount,
    tags: companion.tags,
    hourlyRateFen: companion.hourlyRateFen,
    serviceRadiusM: companion.serviceRadiusM,
    distanceM: companion.distanceM ?? 0,
    totalOrders: companion.totalOrders,
    status: companion.status,
  }

  // 夜间单三态（契约 §8 / 团队已定规则）：
  // - 豁免口径 A：下单账号 == 被服务老人本人 且 老人档案生日满 18 岁 → 创建即自确认（familyConfirmed=true，无交互）；
  // - 否则（子女代下单）→ familyConfirmed=false，需绑定子女 30 分钟内确认，超时 sweep 自动取消全额退款。
  const isNight = isNightHour(hour)
  const elderSelfOrder = !data?.elderUserId // 未指定 elderUserId 即老人本人账号下单
  const elderAdult = db.elderProfile?.birthday ? isAdultBirthday(db.elderProfile.birthday) : false
  const nightSelfConfirmed = isNight && elderSelfOrder && elderAdult

  const order: OrderDetailView = {
    id: nid('o'),
    orderNo: `O${Date.now().toString().slice(-8)}`,
    status: order_status.CREATED,
    serviceType: 'CHAT',
    durationMinutes,
    serviceDate,
    slotStart: iso(slotStartDate),
    slotEnd: iso(slotEndDate),
    totalAmountFen: String(total),
    hourlyRateFen: String(rate),
    couponDeductFen: String(couponDeduct),
    giftCardDeductFen: String(giftCardDeduct),
    companion: publicCard,
    elderNickname: '王秀芳',
    addressMasked: String(data?.address || '天河区·体育西路'),
    distanceM: companion.distanceM ?? 0,
    nightOrder: isNight,
    familyConfirmed: nightSelfConfirmed,
    dispatchDeadlineAt: iso(minutesLater(30)),
    suspendReason: null,
    createdAt: iso(new Date()),
    user: ELDER_BRIEF,
    elderUser: ELDER_BRIEF,
    cancelInitiator: null,
    cancelReason: null,
    cancelFeeFen: '0',
    refundAmountFen: '0',
    dispatchedAt: null,
    acceptedAt: null,
    arrivedAt: null,
    serviceStartedAt: null,
    serviceEndedAt: null,
    completedAt: null,
    closedAt: null,
    timeline: [
      {
        id: nid('tl'),
        fromStatus: null,
        toStatus: order_status.CREATED,
        action: 'create',
        operatorType: 'USER',
        operatorId: 'u_elder_1',
        reason: data?.elderUserId ? '子女代下单' : null,
        createdAt: iso(new Date()),
      },
    ],
    verification: null,
    payment: null,
    sharing: null,
  }
  db.orders.unshift(order)
  // 券/卡即用即销（mock；真实在下单事务内扣减）
  if (usedCoupon) usedCoupon.status = 'USED'
  if (usedCard) saveDb(db)
  else saveDb(db)
  return order
})

on('GET', '/orders', ({ query }) => {
  const db = getDb()
  const tab = query.tab || 'all'
  const groups: Record<string, order_status[]> = {
    pending: [order_status.CREATED, order_status.PAID, order_status.DISPATCHED, order_status.ACCEPTED],
    serving: [order_status.ARRIVED, order_status.IN_SERVICE, order_status.PENDING_CONFIRM],
    done: [order_status.COMPLETED, order_status.CLOSED, order_status.REFUNDED, order_status.CANCELLED],
  }
  let list = [...db.orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  if (tab !== 'all' && groups[tab]) list = list.filter((o) => groups[tab].includes(o.status))
  const page = Number(query.page || 1)
  const pageSize = Number(query.pageSize || 20)
  return { list: list.slice((page - 1) * pageSize, page * pageSize), total: list.length, page, pageSize }
})

on('GET', '/orders/:id', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  return o
})

on('POST', '/orders/:id/cancel', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (TERMINAL_SET.includes(o.status)) {
    bizError(14011, '订单已结束，无法取消')
  }
  if (ARRIVED_SET.includes(o.status)) {
    bizError(14014, '服务已开始，请联系客服处理')
  }
  // 取消违约金（团队已定规则）：ACCEPTED 前免费；ACCEPTED 后收 10%
  const cancelFee =
    o.status === order_status.ACCEPTED ? Math.round((Number(o.totalAmountFen) || 0) * 0.1) : 0
  const refund = Math.max(0, (Number(o.totalAmountFen) || 0) - cancelFee)
  o.cancelFeeFen = String(cancelFee)
  o.refundAmountFen = String(refund)
  o.cancelInitiator = 'USER'
  o.cancelReason = String(data?.reason || '用户取消')
  appendTimeline(o, order_status.CANCELLED, 'cancel', String(data?.reason || '用户取消'))
  if (o.sharing) {
    o.sharing = { ...o.sharing, status: profit_sharing_status.RETURNED }
  }
  saveDb(db)
  return o
})

on('POST', '/orders/:id/night-confirm', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (!o.nightOrder) bizError(14002, '非夜间订单无需确认')
  // 非绑定账号确认 → 12004（确认入口仅对生效绑定中的子女开放）
  if (!data?.boundFamily) bizError(12004, '仅限已绑定的子女账号确认夜间单')
  o.familyConfirmed = true
  appendTimeline(o, o.status, 'night-confirm', '夜间单子女确认')
  saveDb(db)
  return o
})

on('POST', '/orders/:id/confirm', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (o.status !== order_status.PENDING_CONFIRM) bizError(14002, '当前不在待确认状态')
  const asrText = data?.asrText ? String(data.asrText) : undefined
  appendTimeline(o, order_status.COMPLETED, 'confirm', asrText ? `语音确认：${asrText}` : undefined)
  o.completedAt = iso(new Date())
  if (o.verification) o.verification = { ...o.verification, elderConfirmedAt: iso(new Date()), elderVoiceAsr: asrText ?? null }
  if (o.sharing) o.sharing = { ...o.sharing, status: profit_sharing_status.SHARED, sharedAt: iso(new Date()) }
  saveDb(db)
  return o
})

/** 演示专用：无陪聊员端时推进订单状态（真实环境无此端点） */
on('POST', '/orders/:id/demo-advance', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  const action = String(data?.action || '')
  if (action === 'accept' && (o.status === order_status.PAID || o.status === order_status.DISPATCHED)) {
    appendTimeline(o, order_status.ACCEPTED, 'accept')
    o.acceptedAt = iso(new Date())
    o.verification = {
      id: nid('vf'),
      type: 'ARRIVAL',
      status: verification_status.PENDING,
      attemptNo: 0,
      faceScore: null,
      facePassed: null,
      gpsDeviationM: null,
      arrivedAt: null,
      companionConfirmedAt: null,
      elderConfirmedAt: null,
      elderVoiceAsr: null,
    }
  } else if (action === 'arrive' && o.status === order_status.ACCEPTED) {
    appendTimeline(o, order_status.ARRIVED, 'verify')
    o.arrivedAt = iso(new Date())
    o.verification = {
      id: o.verification?.id || nid('vf'),
      type: 'ARRIVAL',
      status: verification_status.PASSED,
      attemptNo: 1,
      faceScore: 92,
      facePassed: true,
      gpsDeviationM: 120,
      arrivedAt: iso(new Date()),
      companionConfirmedAt: null,
      elderConfirmedAt: null,
      elderVoiceAsr: null,
    }
  } else if (action === 'start' && o.status === order_status.ARRIVED) {
    appendTimeline(o, order_status.IN_SERVICE, 'start')
    o.serviceStartedAt = iso(new Date())
  } else if (action === 'finish' && o.status === order_status.IN_SERVICE) {
    appendTimeline(o, order_status.PENDING_CONFIRM, 'finish')
    o.serviceEndedAt = iso(new Date())
  } else {
    bizError(14002, '当前状态不支持该演示操作')
  }
  saveDb(db)
  return o
})

// ---------------------------------------------------------------------------
// /payments（契约 §3.3）
// ---------------------------------------------------------------------------

on('POST', '/payments/prepay', ({ data }) => {
  const db = getDb()
  const orderId = String(data?.orderId || '')
  const o = db.orders.find((x) => x.id === orderId)
  if (!o) bizError(14001)
  if (o.status !== order_status.CREATED) bizError(14012, '订单不在待支付状态')
  // mock：模拟「微信支付回调到达」→ 订单置 PAID + 待分账冻结（架构 §7.1）
  appendTimeline(o, order_status.PAID, 'pay')
  o.dispatchedAt = iso(new Date())
  const total = Number(o.totalAmountFen)
  o.payment = {
    paymentNo: `PAY${o.id}`,
    status: payment_status.SUCCESS,
    amountFen: String(total),
    profitSharing: true,
    paidAt: iso(new Date()),
    refundAmountFen: '0',
    refundedAt: null,
  }
  o.sharing = {
    sharingNo: `SHR${o.id}`,
    status: profit_sharing_status.FROZEN,
    frozenAmountFen: String(total),
    companionIncomeFen: String(total - Math.round(total * 0.05)),
    // 平台服务费与费率（shared 已下沉到 ProfitSharingBriefDTO）
    platformCommissionFen: String(Math.round(total * 0.05)),
    commissionRateBp: 500,
    retryCount: 0,
    createdAt: iso(new Date()),
    sharedAt: null,
  }
  saveDb(db)
  return {
    paymentNo: o.payment.paymentNo,
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: Math.random().toString(36).slice(2, 12),
    packageValue: `prepay_id=mock_${orderId}`,
    signType: 'RSA',
    paySign: 'MOCK_SIGN',
  } as PaymentPrepayDTO
})

on('GET', '/payments/order/:orderId', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.orderId)
  if (!o) bizError(14001)
  return { payment: o.payment, sharing: o.sharing }
})

// ---------------------------------------------------------------------------
// /verifications（契约 §3.4，用户侧只读）
// ---------------------------------------------------------------------------

on('GET', '/verifications/order/:orderId', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.orderId)
  if (!o) bizError(14001)
  return o.verification
})

// ---------------------------------------------------------------------------
// /reviews（契约 §3.5）
// ---------------------------------------------------------------------------

on('POST', '/reviews', ({ data }) => {
  const db = getDb()
  const orderId = String(data?.orderId || '')
  const o = db.orders.find((x) => x.id === orderId)
  if (!o) bizError(14001)
  if (ACTIVE_SET.includes(o.status)) {
    bizError(19003, '订单完成后 7 天内可评价')
  }
  const existing = db.companions.flatMap((c) => c.reviews).find((r) => r.orderId === orderId)
  if (existing) bizError(19001)
  const rating = Number(data?.rating || 5)
  const review: ReviewDTO = {
    id: nid('rv'),
    orderId,
    orderNo: o.orderNo,
    reviewerRole: 'USER',
    rating,
    tags: (data?.tags as string[]) ?? null,
    content: String(data?.content || '') || null,
    status: 'APPROVED',
    isAnonymous: Boolean(data?.isAnonymous),
    replyContent: null,
    createdAt: iso(new Date()),
  }
  const companion = db.companions.find((c) => c.id === o.companion?.id)
  if (companion) {
    companion.reviews.unshift(review)
    companion.ratingCount += 1
    const next = (Number(companion.ratingAvg) * (companion.ratingCount - 1) + rating) / companion.ratingCount
    companion.ratingAvg = next.toFixed(1)
  }
  if (o.status === order_status.COMPLETED) {
    appendTimeline(o, order_status.CLOSED, 'review')
    o.closedAt = iso(new Date())
  }
  saveDb(db)
  return review
})

on('GET', '/reviews/companion/:companionId', ({ params }) => {
  const db = getDb()
  const c = db.companions.find((x) => x.id === params.companionId)
  if (!c) bizError(13001)
  // 匿名评价隐藏内容（契约 §3.5）
  return c.reviews.map((r) => (r.isAnonymous ? { ...r, content: null } : r))
})

// ---------------------------------------------------------------------------
// /marketing（契约 §3.5）
// ---------------------------------------------------------------------------

on('GET', '/marketing/coupons', () => getDb().couponTemplates as CouponDTO[])

on('POST', '/marketing/coupons/:couponNo/claim', ({ params }) => {
  const db = getDb()
  const tpl = db.couponTemplates.find((t) => t.couponNo === params.couponNo)
  if (!tpl) bizError(19204, '券不存在')
  if (db.coupons.some((c) => c.couponNo === tpl.couponNo && c.status === 'UNUSED')) {
    bizError(19206, '该券已领取过啦')
  }
  const coupon: UserCouponDTO = {
    ...tpl,
    userCouponId: nid('cp'),
    status: 'UNUSED',
    source: 'MANUAL',
    expiredAt: iso(new Date(Date.now() + tpl.validDays * 86_400_000)),
    usedOrderId: null,
  }
  db.coupons.push(coupon)
  saveDb(db)
  return coupon
})

on('GET', '/marketing/coupons/mine', () => getDb().coupons as UserCouponDTO[])

on('GET', '/marketing/gift-cards/mine', () => getDb().giftCards as GiftCardDTO[])

on('POST', '/marketing/gift-cards', ({ data }) => {
  const db = getDb()
  const faceAmountFen = String(Number(data?.faceAmountFen || 50000))
  const durationMinutes = Number(data?.durationMinutes || 240)
  const card: GiftCardDTO = {
    cardNo: `GC${Date.now().toString().slice(-9)}`,
    faceAmountFen,
    durationMinutes,
    balanceAmountFen: faceAmountFen,
    balanceDurationMinutes: durationMinutes,
    status: 'ACTIVE',
    message: String(data?.message || '') || null,
    expiresAt: iso(new Date(Date.now() + 365 * 86_400_000)),
    boundAt: iso(new Date()),
  }
  db.giftCards.unshift(card)
  saveDb(db)
  return card
})

on('POST', '/marketing/gift-cards/bind', () => {
  const db = getDb()
  // mock：返回最近一张卡（真实按手机号盲索引匹配未绑定卡）
  return db.giftCards[0] as GiftCardDTO
})

// ---------------------------------------------------------------------------
// /insurance（契约 §3.5）
// ---------------------------------------------------------------------------

on('GET', '/insurance/policies', () => getDb().policies as PolicyDTO[])

on('GET', '/insurance/orders/:orderId', ({ params }) => {
  const db = getDb()
  return db.policies.find((p) => p.orderId === params.orderId) ?? null
})

on('POST', '/insurance/policies/:policyNo/claim', ({ params }) => {
  const db = getDb()
  const p = db.policies.find((x) => x.policyNo === params.policyNo)
  if (!p) bizError(19101, '保单不存在')
  p.status = 'CLAIMING'
  saveDb(db)
  return { ok: true, policyNo: p.policyNo }
})

// ---------------------------------------------------------------------------
// /im（契约 §6.1）
// ---------------------------------------------------------------------------

on('POST', '/im/conversations/order/:orderId', ({ params }) => {
  const db = getDb()
  let conv = db.imConversations.find((c) => c.orderId === params.orderId)
  if (!conv) {
    const o = db.orders.find((x) => x.id === params.orderId)
    if (!o?.companion) bizError(14013, '订单未接单，暂不能沟通')
    conv = {
      id: nid('conv'),
      orderId: o.id,
      orderNo: o.orderNo,
      peer: { id: o.companion.id, nickname: o.companion.nickname, avatarUrl: o.companion.avatarUrl, role: 'COMPANION', status: 'ACTIVE' },
      unread: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      status: 'ACTIVE',
      messages: [
        {
          id: nid('im'),
          senderId: 'system',
          senderRole: im_sender_role.SYSTEM,
          msgType: im_message_type.SYSTEM,
          content: '温馨提示：平台沟通全程留痕，请勿在平台外私下交易，谨防飞单受骗。',
          status: 'NORMAL',
          reviewStatus: im_review_status.PASS,
          fileUrl: null,
          voiceDurationMs: null,
          asrText: null,
          createdAt: iso(new Date()),
        },
      ],
    }
    db.imConversations.push(conv)
    saveDb(db)
  }
  return conv as ConversationDTO
})

on('GET', '/im/conversations/:id/messages', ({ params }) => {
  const db = getDb()
  const conv = db.imConversations.find((c) => c.id === params.id)
  if (!conv) bizError(17001)
  conv.unread = 0
  saveDb(db)
  return conv.messages as MessageDTO[]
})

on('POST', '/im/conversations/:id/messages', ({ params, data }) => {
  const db = getDb()
  const conv = db.imConversations.find((c) => c.id === params.id)
  if (!conv) bizError(17001)
  const content = String(data?.content || '')
  const msgType = (data?.msgType as MessageDTO['msgType']) || 'TEXT'
  const nowIso = iso(new Date())

  // 风控演示：手机号/微信号/外链模式命中即 BLOCKED（契约 §8.2 → 17003）
  const riskPattern = /(1[3-9]\d{9})|(微信|weixin|wechat|vx|加我)|(https?:\/\/|www\.)/i
  if (riskPattern.test(content)) {
    const blocked: MessageDTO = {
      id: nid('im'),
      senderId: 'u_elder_1',
      senderRole: im_sender_role.USER,
      msgType,
      content,
      status: 'BLOCKED',
      reviewStatus: im_review_status.REJECT,
      fileUrl: null,
      voiceDurationMs: msgType === 'VOICE' ? Number(data?.voiceDurationMs || 0) : null,
      asrText: msgType === 'VOICE' ? content : null,
      createdAt: nowIso,
    }
    conv.messages.push(blocked, {
      id: nid('im'),
      senderId: 'system',
      senderRole: im_sender_role.SYSTEM,
      msgType: im_message_type.SYSTEM,
      content: '该内容涉及联系方式交换，已被平台安全策略拦截。请通过平台沟通，切勿私下交易。',
      status: 'NORMAL',
      reviewStatus: im_review_status.PASS,
      fileUrl: null,
      voiceDurationMs: null,
      asrText: null,
      createdAt: nowIso,
    })
    saveDb(db)
    return [blocked, conv.messages[conv.messages.length - 1]] as MessageDTO[]
  }

  const mine: MessageDTO = {
    id: nid('im'),
    senderId: 'u_elder_1',
    senderRole: im_sender_role.USER,
    msgType,
    content,
    status: 'NORMAL',
    reviewStatus: im_review_status.PASS,
    fileUrl: null,
    voiceDurationMs: msgType === 'VOICE' ? Number(data?.voiceDurationMs || 0) : null,
    asrText: msgType === 'VOICE' ? content : null,
    createdAt: nowIso,
  }
  conv.messages.push(mine)
  // mock 陪聊员自动回复（演示对话闭环）
  conv.messages.push({
    id: nid('im'),
    senderId: conv.peer?.id || 'c_1',
    senderRole: im_sender_role.COMPANION,
    msgType: im_message_type.TEXT,
    content: pickImReply(content),
    status: 'NORMAL',
    reviewStatus: im_review_status.PASS,
    fileUrl: null,
    voiceDurationMs: null,
    asrText: null,
    createdAt: nowIso,
  })
  conv.lastMessageAt = nowIso
  conv.lastMessagePreview = content.slice(0, 30)
  saveDb(db)
  return [mine, conv.messages[conv.messages.length - 1]] as MessageDTO[]
})

on('POST', '/im/conversations/:id/read', () => ({ ok: true }))

on('GET', '/im/privacy-binding/order/:orderId', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.orderId)
  if (!o) bizError(14001)
  const active = SERVICE_SET.includes(o.status)
  return {
    virtualNumber: active ? '02086881234' : '',
    status: active ? 'ACTIVE' : 'EXPIRED',
    expiredAt: iso(minutesLater(60)),
  }
})

function pickImReply(content: string): string {
  if (/你好|您好|在吗/.test(content)) return '在的在的，王阿姨您说～'
  if (/几点|什么时候|到哪/.test(content)) return '我按约定时间到，到了给您消息。'
  if (/谢谢/.test(content)) return '不客气，应该的！'
  return '好的王阿姨，我记下了，见面聊。'
}

// ---------------------------------------------------------------------------
// /ai（契约 §6.2，仅老人端）
// ---------------------------------------------------------------------------

on('POST', '/ai/sessions', () => {
  const db = getDb()
  const session: AiSessionDTO = {
    sessionNo: `AIS${Date.now().toString().slice(-9)}`,
    status: 'ACTIVE',
    messageCount: 0,
    crisisFlag: false,
    startedAt: iso(new Date()),
    lastMessageAt: null,
  }
  db.aiSessions.unshift(session)
  saveDb(db)
  return session
})

function aiReply(text: string): { content: string; crisisFlag: boolean; emotionLabel: string | null; topicLabel: string | null } {
  const t = text.trim()
  if (/死|不想活|活着没意思|难受.*不想/.test(t)) {
    return {
      content: '王阿姨，听您这么说我挺担心的。您可以马上告诉女儿，或拨打 020-8888-6666 找我们陪伴专员，我们一直在。',
      crisisFlag: true,
      emotionLabel: '低落',
      topicLabel: '危机信号',
    }
  }
  if (/天气/.test(t)) {
    return { content: '今天广州晴天，26 到 32 度，傍晚凉快些，适合去附近公园走走。记得带把伞防晒。', crisisFlag: false, emotionLabel: '平静', topicLabel: '天气' }
  }
  if (/故事/.test(t)) {
    return { content: '好呀。我听说老广州以前有种手艺叫「搭棚」，婚娶嫁娶都用它，一搭三层楼高，不用一根钉子……您年轻时见过吗？', crisisFlag: false, emotionLabel: '开心', topicLabel: '故事' }
  }
  if (/儿女|孩子|女儿|儿子|想念/.test(t)) {
    return { content: '儿女忙事业也是心里有您。要不您跟我念叨念叨他们小时候的事儿？我听着呢。', crisisFlag: false, emotionLabel: '思念', topicLabel: '家庭' }
  }
  if (/养生|健康|顺口溜/.test(t)) {
    return { content: '给您来一段：早睡早起精神好，饭后百步莫心急；少吃咸的多喝汤，心情舒畅病不欺。', crisisFlag: false, emotionLabel: '平静', topicLabel: '养生' }
  }
  if (/新闻|时事/.test(t)) {
    return { content: '今天有条暖心新闻：广州多个社区开了老年食堂，一顿饭十块钱不到。您社区有了吗？', crisisFlag: false, emotionLabel: '平静', topicLabel: '新闻' }
  }
  if (/散步|去处|公园|去哪/.test(t)) {
    return { content: '天河公园早上七点最舒服，有榕树有棋桌；体育西那边的口袋公园新修了健步道。出门注意补水。', crisisFlag: false, emotionLabel: '平静', topicLabel: '出行' }
  }
  if (/闷|无聊|寂寞|孤独|没人/.test(t)) {
    return {
      content: '一个人在家是容易闷。您可以跟我多聊聊，也可以约一位真人陪聊员到家附近走走坐坐，我帮您看看附近有谁？',
      crisisFlag: false,
      emotionLabel: '低落',
      topicLabel: '陪伴',
    }
  }
  return { content: '嗯嗯，我在听。您慢慢说，今天过得怎么样呀？', crisisFlag: false, emotionLabel: '平静', topicLabel: '闲聊' }
}

function aiTurn(sessionNo: string, userText: string) {
  const db = getDb()
  const session = db.aiSessions.find((s) => s.sessionNo === sessionNo)
  if (!session) bizError(18001)
  const r = aiReply(userText)
  session.messageCount += 2
  session.lastMessageAt = iso(new Date())
  if (r.crisisFlag) session.crisisFlag = true
  saveDb(db)
  return {
    sessionNo,
    userText,
    assistantText: r.content,
    audioUrl: null, // mock：TTS 音频由端上模拟播放；真实为 STS 签名 URL
    audioDurationMs: 3000 + Math.round(Math.random() * 2000),
    emotionLabel: r.emotionLabel,
    topicLabel: r.topicLabel,
    crisisFlag: r.crisisFlag,
    llmProvider: 'mock',
    llmModel: 'mock-llm-v1',
    latencyMs: 380,
  } as AiTurnDTO
}

on('POST', '/ai/sessions/:sessionNo/turn', ({ params, data }) => aiTurn(params.sessionNo, String(data?.text || '')))
on('POST', '/ai/sessions/:sessionNo/turn/voice', ({ params, data }) => aiTurn(params.sessionNo, String(data?.asrText || '')))

on('POST', '/ai/sessions/:sessionNo/end', ({ params }) => {
  const db = getDb()
  const session = db.aiSessions.find((s) => s.sessionNo === params.sessionNo)
  if (!session) bizError(18001)
  session.status = 'ENDED'
  saveDb(db)
  return session
})

on('GET', '/ai/sessions', () => getDb().aiSessions as AiSessionDTO[])

// ---------------------------------------------------------------------------
// /risk（契约 §5.5：用户侧 SOS / 举报 / 投诉）
// ---------------------------------------------------------------------------

on('POST', '/risk/sos', ({ data }) => {
  const orderId = String(data?.orderId || '')
  // SOS 链路（团队已定规则）：任一端触发 → 订单立即 SUSPENDED
  // + 生成 URGENT 投诉工单 + 通知紧急联系人；客服裁决后恢复或终止。
  if (orderId) {
    const db = getDb()
    const o = db.orders.find((x) => x.id === orderId)
    if (o && !TERMINAL_SET.includes(o.status)) {
      o.status = order_status.SUSPENDED
      o.suspendReason = '用户端一键求助（SOS）'
      o.timeline.push({
        id: nid('tl'),
        fromStatus: o.status,
        toStatus: order_status.SUSPENDED,
        action: 'sos_suspend',
        operatorType: 'USER',
        operatorId: 'u_elder_1',
        reason: '用户端一键求助（SOS）',
        createdAt: iso(new Date()),
      })
      saveDb(db)
    }
  }
  Taro.showToast({ title: '已通知值守客服，请保持电话畅通', icon: 'none', duration: 3000 })
  return { eventNo: `RSK${Date.now().toString().slice(-9)}`, orderId, level: 'URGENT' }
})

on('POST', '/risk/reports', ({ data }) => ({
  reportNo: `RPT${Date.now().toString().slice(-9)}`,
  orderId: String(data?.orderId || ''),
  status: 'PENDING',
}))

on('POST', '/risk/complaints', ({ data }) => ({
  complaintNo: `CMP${Date.now().toString().slice(-9)}`,
  orderId: String(data?.orderId || ''),
  status: 'PENDING',
}))

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export async function mockRequest<T>(options: RequestOptions): Promise<T> {
  await delay()
  const [path, queryStr] = options.url.split('?')
  const query: Record<string, string> = {}
  if (queryStr) {
    for (const kv of queryStr.split('&')) {
      const [k, v] = kv.split('=')
      if (k) query[k] = v || ''
    }
  }
  const method = (options.method || 'GET').toUpperCase()
  const matched = matchRoute(method, path)
  if (!matched) {
    const err = new Error(`mock 未实现：${method} ${path}`) as Error & { code: number }
    err.code = 10009
    throw err
  }
  try {
    return matched.handler({
      method,
      path,
      params: matched.params,
      query,
      data: (options.data || {}) as Record<string, any>,
    }) as T
  } catch (e) {
    const err = e as Error & { code?: number }
    if (!options.silent && err.code) {
      Taro.showToast({ title: err.message, icon: 'none', duration: 2500 })
    }
    throw e
  }
}
