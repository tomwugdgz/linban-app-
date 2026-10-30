// ============================================================================
// Mock 路由：按 docs/API-CONTRACT.md §4（陪聊员端）的路径/方法逐条实现
// ----------------------------------------------------------------------------
// 与真实后端同构：service 层代码在 mock/real 两种模式下零改动。
// 边界：mock 只实现「页面可点通」所需语义；资金写操作（提现/分账）按红线
// 一律由服务端驱动，mock 中也不提供前端直连接口。
// ============================================================================

import type {
  ArriveInput,
  ArriveResult,
  CompanionConversation,
  CompanionLoginResult,
  CompanionOrderView,
  CompanionSelfView,
  DispatchPoolItem,
  IncomeOverview,
  MyComplaintView,
  MyReportView,
  ScheduleDTO,
  SharingRecordView,
  WithdrawalView,
} from '@/types'
import { CS_PHONE } from '@/constants'
import {
  order_status,
  application_stage,
  step_status,
  companion_status,
  credit_log_type,
  deposit_tx_type,
  tx_status,
  schedule_status,
  im_sender_role,
  im_message_type,
  im_message_status,
  im_review_status,
  operator_type,
  user_role,
  payment_status,
  SPLIT_MODE,
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
const DONE_SET: order_status[] = [order_status.COMPLETED, order_status.CLOSED]
const TERMINAL_SET: order_status[] = [order_status.CANCELLED, order_status.CLOSED, order_status.REFUNDED]
const ACTIVE_SET: order_status[] = [
  order_status.CREATED,
  order_status.PAID,
  order_status.DISPATCHED,
  order_status.ACCEPTED,
  order_status.ARRIVED,
  order_status.IN_SERVICE,
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
// 认证（契约 §3.1）
// ---------------------------------------------------------------------------

on('POST', '/auth/wx-login', ({ data }) => {
  const res: CompanionLoginResult = {
    accessToken: `mock_at_${nid('t')}`,
    refreshToken: `mock_rt_${nid('r')}`,
    isNewUser: false,
    user: {
      id: 'u_companion_1',
      nickname: String(data?.nickname || '张阿姨'),
      avatarUrl: null,
      role: 'COMPANION',
      phoneMasked: '138****6688',
    },
  }
  return res
})

on('POST', '/auth/phone-login', () => {
  const res: CompanionLoginResult = {
    accessToken: `mock_at_${nid('t')}`,
    refreshToken: `mock_rt_${nid('r')}`,
    isNewUser: false,
    user: {
      id: 'u_companion_1',
      nickname: '张阿姨',
      avatarUrl: null,
      role: 'COMPANION',
      phoneMasked: '138****6688',
    },
  }
  return res
})

on('POST', '/auth/sms-code', () => ({ sent: true }))

on('GET', '/auth/profile', () => {
  const db = getDb()
  return {
    userId: 'u_companion_1',
    role: 'COMPANION',
    nickname: '张阿姨',
    avatarUrl: null,
    phoneMasked: '138****6688',
    companionId: db.self.id,
  }
})

// ---------------------------------------------------------------------------
// 入驻四审（契约 §4.1）
// ---------------------------------------------------------------------------

on('POST', '/companion/applications', () => {
  const db = getDb()
  db.application = {
    ...db.application,
    stage: application_stage.APPLIED,
    submittedAt: iso(new Date()),
    decidedAt: null,
    rejectReason: null,
    stepStatuses: {
      realname: step_status.PENDING,
      face: step_status.PENDING,
      criminal: step_status.PENDING,
      exam: step_status.PENDING,
      deposit: step_status.PENDING,
    },
    examScore: null,
    examAttemptNo: 0,
    depositAmountFen: null,
    depositPaidAt: null,
  }
  db.self.status = companion_status.PENDING
  saveDb(db)
  return db.application
})

on('GET', '/companion/applications/me', () => {
  const db = getDb()
  return db.application
})

on('POST', '/companion/applications/me/realname', ({ data }) => {
  const db = getDb()
  if (db.application.stage !== application_stage.APPLIED) bizError(13004, '四审流程不允许的流转')
  db.application.stepStatuses.realname = step_status.PASSED
  db.application.stage = application_stage.REALNAME_OK
  saveDb(db)
  // TODO(联调)：真实返回 OCR 识别结果 + 二要素核验结论
  return { ...db.application, ocrName: String(data?.name || ''), idCardMasked: '4401********1234' }
})

on('POST', '/companion/applications/me/face', () => {
  const db = getDb()
  if (db.application.stage !== application_stage.REALNAME_OK) bizError(13004, '请先完成实名认证')
  db.application.stepStatuses.face = step_status.PASSED
  db.application.stage = application_stage.FACE_OK
  saveDb(db)
  // TODO(联调)：真实返回慧眼 faceScore / faceVerifyId
  return { ...db.application, faceScore: 93, faceVerifyId: nid('fv') }
})

on('POST', '/companion/applications/me/criminal', () => {
  const db = getDb()
  if (db.application.stage !== application_stage.FACE_OK) bizError(13004, '请先完成人脸核验')
  db.application.stage = application_stage.CRIMINAL_OK
  db.application.stepStatuses.criminal = step_status.PENDING // 人工审核：提交后待审
  saveDb(db)
  return { ...db.application, criminalSubmittedAt: iso(new Date()) }
})

on('POST', '/companion/applications/me/criminal/approve', () => {
  // mock 专用：模拟后台人工审核通过（真实环境由 admin-web 审核）
  const db = getDb()
  db.application.stepStatuses.criminal = step_status.PASSED
  db.application.stage = application_stage.CRIMINAL_OK
  saveDb(db)
  return db.application
})

on('POST', '/companion/applications/me/training-complete', () => {
  const db = getDb()
  if (db.application.stage !== application_stage.CRIMINAL_OK) bizError(13004, '请先通过无犯罪记录审核')
  db.application.stage = application_stage.TRAINING
  saveDb(db)
  return db.application
})

on('POST', '/companion/applications/me/exam', ({ data }) => {
  const db = getDb()
  if (db.application.stage !== application_stage.TRAINING) bizError(13004, '请先完成培训')
  const score = Number(data?.score ?? 88)
  db.application.examScore = score
  db.application.examAttemptNo = (db.application.examAttemptNo || 0) + 1
  if (score >= 80) {
    db.application.stepStatuses.exam = step_status.PASSED
    db.application.stage = application_stage.EXAM_OK
  } else {
    db.application.stepStatuses.exam = step_status.REJECTED
    db.application.stage = application_stage.TRAINING
  }
  saveDb(db)
  return { ...db.application, passed: score >= 80 }
})

on('POST', '/companion/applications/me/deposit', ({ data }) => {
  const db = getDb()
  if (db.application.stage !== application_stage.EXAM_OK) bizError(13004, '请先通过考试')
  db.application.stepStatuses.deposit = step_status.PASSED
  db.application.stage = application_stage.DEPOSIT_OK
  db.application.depositAmountFen = String(data?.amountFen ?? '50000')
  db.application.depositPaidAt = iso(new Date())
  db.application.decidedAt = iso(new Date())
  db.self.status = companion_status.ACTIVE
  db.self.depositBalanceFen = db.application.depositAmountFen
  db.depositTxs.unshift({
    id: nid('dt'),
    txNo: `DT${Date.now()}`,
    type: deposit_tx_type.IN,
    amountFen: db.application.depositAmountFen,
    balanceAfterFen: db.application.depositAmountFen,
    status: tx_status.SUCCESS,
    remark: '入驻缴纳保证金',
    createdAt: iso(new Date()),
  })
  saveDb(db)
  return db.application
})

// ---------------------------------------------------------------------------
// 我的工作台（契约 §4.4）
// ---------------------------------------------------------------------------

on('GET', '/companion/me', () => {
  const db = getDb()
  return db.self
})

on('GET', '/companion/me/credit-logs', () => {
  const db = getDb()
  return db.creditLogs
})

on('GET', '/companion/me/deposit-txs', () => {
  const db = getDb()
  return db.depositTxs
})

on('GET', '/companion/schedules', () => {
  const db = getDb()
  return db.schedules
})

on('PUT', '/companion/schedules', ({ data }) => {
  const db = getDb()
  const incoming = (data?.schedules || []) as ScheduleDTO[]
  // 时段防重：与存量单冲突 → 14003（契约 §7.2.3）
  const conflict = incoming.some((s) =>
    db.orders.some(
      (o) =>
        o.serviceDate === s.date &&
        o.slotStart.slice(11, 16) >= s.startTime &&
        o.slotStart.slice(11, 16) < s.endTime &&
        !CLOSED_SET.includes(o.status),
    ),
  )
  if (conflict) bizError(14003, '该时段已有订单占用，无法重复设置')
  db.schedules = incoming
  saveDb(db)
  return db.schedules
})

// ---------------------------------------------------------------------------
// 接单与服务流（契约 §4.2）
// ---------------------------------------------------------------------------

on('GET', '/orders/dispatch/pool', () => {
  const db = getDb()
  return db.pool
})

on('GET', '/orders', ({ query }) => {
  const db = getDb()
  let list = db.orders
  if (query.status) {
    const s = query.status as order_status
    list = list.filter((o) => o.status === s)
  }
  return {
    list,
    total: list.length,
    page: 1,
    pageSize: 20,
  }
})

on('GET', '/orders/:id', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  return o
})

on('POST', '/orders/:id/grab', ({ params }) => {
  const db = getDb()
  const poolItem = db.pool.find((p) => p.id === params.id)
  if (!poolItem) bizError(14001)
  // 夜间单未确认：禁止接单（契约 §8 夜间单口径 → 14007）
  if (poolItem.nightOrder && !poolItem.familyConfirmed) bizError(14007, '该订单待子女确认中，暂不可接单')
  // 已被抢 → 14003
  if (db.orders.some((o) => o.id === params.id)) bizError(14003, '该订单已被接走')

  const slotStart = new Date(poolItem.slotStart)
  const slotEnd = new Date(poolItem.slotEnd)
  const order: CompanionOrderView = {
    id: poolItem.id,
    orderNo: poolItem.orderNo,
    status: order_status.ACCEPTED,
    serviceType: 'CHAT',
    durationMinutes: poolItem.durationMinutes,
    serviceDate: poolItem.serviceDate,
    slotStart: poolItem.slotStart,
    slotEnd: poolItem.slotEnd,
    totalAmountFen: poolItem.totalAmountFen,
    hourlyRateFen: '12000',
    couponDeductFen: '0',
    giftCardDeductFen: '0',
    companion: {
      id: db.self.id,
      userId: 'u_companion_1',
      nickname: '张阿姨',
      avatarUrl: null,
      level: 3,
      ratingAvg: '4.9',
      ratingCount: 128,
      tags: ['耐心', '会做饭'],
      hourlyRateFen: '12000',
      serviceRadiusM: 5000,
      distanceM: poolItem.distanceM,
      totalOrders: 156,
      status: companion_status.ACTIVE,
    },
    elderNickname: '王秀芳',
    addressMasked: '天河区·体育西路',
    distanceM: poolItem.distanceM,
    nightOrder: poolItem.nightOrder,
    familyConfirmed: poolItem.familyConfirmed,
    // 挂起原因（仅 SUSPENDED 有值；shared 已改为必填，ACCEPTED 阶段给 null）
    suspendReason: null,
    createdAt: iso(new Date()),
    user: { id: 'u_elder_1', nickname: '王秀芳', avatarUrl: null, role: user_role.ELDER, status: 'ACTIVE' },
    elderUser: { id: 'u_elder_1', nickname: '王秀芳', avatarUrl: null, role: user_role.ELDER, status: 'ACTIVE' },
    cancelInitiator: null,
    cancelReason: null,
    cancelFeeFen: '0',
    refundAmountFen: '0',
    dispatchedAt: iso(new Date()),
    dispatchDeadlineAt: iso(minutesLater(30)),
    acceptedAt: iso(new Date()),
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
        operatorType: operator_type.USER,
        operatorId: null,
        reason: null,
        createdAt: iso(minutesLater(-40)),
      },
      {
        id: nid('tl'),
        fromStatus: null,
        toStatus: order_status.PAID,
        action: 'pay',
        operatorType: operator_type.USER,
        operatorId: null,
        reason: null,
        createdAt: iso(minutesLater(-39)),
      },
      {
        id: nid('tl'),
        fromStatus: order_status.DISPATCHED,
        toStatus: order_status.ACCEPTED,
        action: 'accept',
        operatorType: operator_type.COMPANION,
        operatorId: 'u_companion_1',
        reason: null,
        createdAt: iso(new Date()),
      },
    ],
    verification: null,
    payment: {
      paymentNo: `PAY${poolItem.orderNo.slice(2)}`,
      status: payment_status.SUCCESS,
      amountFen: poolItem.totalAmountFen,
      profitSharing: false,
      paidAt: iso(minutesLater(-39)),
      refundAmountFen: '0',
      refundedAt: null,
    },
    sharing: null,
  }
  void slotStart
  void slotEnd
  db.orders.unshift(order)
  db.pool = db.pool.filter((p) => p.id !== params.id)
  saveDb(db)
  return order
})

on('POST', '/orders/:id/arrive', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (o.status !== order_status.ACCEPTED) bizError(14002, '订单状态不允许到岗核销')
  const input = (data || {}) as ArriveInput

  // 三关核销（红线：阈值服务端判定，端上仅展示结果）
  const codeOk = /^\d{6}$/.test(String(input.dynamicCode || ''))
  if (!codeOk) bizError(16002, '动态码不正确，请向长辈重新确认')
  const faceOk = Number(input.faceScore) >= 80
  if (!faceOk) bizError(16005, '人脸比对未通过，请重试')
  const deviation = 120 // mock：真实由服务端按订单地址坐标计算偏差
  const gpsOk = deviation <= 2000
  if (!gpsOk) bizError(16007, '签到位置偏离服务地址过远，请到达服务地址后再试')

  o.status = order_status.ARRIVED
  o.arrivedAt = iso(new Date())
  o.verification = {
    id: nid('vf'),
    type: 'ARRIVAL',
    status: 'PASSED',
    faceScore: Number(input.faceScore),
    facePassed: true,
    gpsDeviationM: deviation,
    arrivedAt: iso(new Date()),
    companionConfirmedAt: iso(new Date()),
    elderConfirmedAt: iso(new Date()),
    elderVoiceAsr: null,
    attemptNo: 1,
  }
  o.timeline.push({
    id: nid('tl'),
    fromStatus: order_status.ACCEPTED,
    toStatus: order_status.ARRIVED,
    action: 'verify',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: null,
    createdAt: iso(new Date()),
  })
  saveDb(db)
  const res: ArriveResult = {
    status: o.status,
    checks: { dynamicCodePassed: true, facePassed: true, gpsPassed: true, gpsDeviationM: deviation },
  }
  return res
})

on('POST', '/orders/:id/start', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (o.status !== order_status.ARRIVED) bizError(14002, '订单状态不允许开始服务')
  o.status = order_status.IN_SERVICE
  o.serviceStartedAt = iso(new Date())
  o.timeline.push({
    id: nid('tl'),
    fromStatus: order_status.ARRIVED,
    toStatus: order_status.IN_SERVICE,
    action: 'start',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: null,
    createdAt: iso(new Date()),
  })
  saveDb(db)
  return { status: o.status }
})

on('POST', '/orders/:id/finish', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (o.status !== order_status.IN_SERVICE) bizError(14002, '订单状态不允许结束服务')
  o.status = order_status.PENDING_CONFIRM
  o.serviceEndedAt = iso(new Date())
  o.timeline.push({
    id: nid('tl'),
    fromStatus: order_status.IN_SERVICE,
    toStatus: order_status.PENDING_CONFIRM,
    action: 'finish',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: null,
    createdAt: iso(new Date()),
  })
  saveDb(db)
  return { status: o.status }
})

on('POST', '/orders/:id/confirm', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (o.status !== order_status.PENDING_CONFIRM) bizError(16010, '当前不在待确认阶段')
  o.status = order_status.COMPLETED
  o.completedAt = iso(new Date())
  o.timeline.push({
    id: nid('tl'),
    fromStatus: order_status.PENDING_CONFIRM,
    toStatus: order_status.COMPLETED,
    action: 'confirm',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: null,
    createdAt: iso(new Date()),
  })
  // 分账（mock 模拟服务端结算）
  const total = Number(o.totalAmountFen)
  const commission = Math.round(total * 0.05)
  const income = total - commission
  o.sharing = {
    sharingNo: nid('ps'),
    status: 'SHARED',
    frozenAmountFen: String(total),
    companionIncomeFen: String(income),
    platformCommissionFen: String(commission),
    commissionRateBp: 500,
    retryCount: 0,
    createdAt: iso(new Date()),
    sharedAt: iso(new Date()),
    returnedAt: null,
  }
  db.sharings.unshift({
    orderId: o.id,
    orderNo: o.orderNo,
    sharingNo: o.sharing!.sharingNo,
    status: 'SHARED',
    frozenAmountFen: String(total),
    platformCommissionFen: String(commission),
    companionIncomeFen: String(income),
    commissionRateBp: 500,
    durationMinutes: o.durationMinutes,
    createdAt: iso(new Date()),
    sharedAt: iso(new Date()),
    returnedAt: null,
  })
  saveDb(db)
  return { status: o.status, completed: true }
})

on('POST', '/orders/:id/cancel', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (TERMINAL_SET.includes(o.status)) bizError(14002, '订单已结束，无法取消')
  // 违约金规则（团队已定）：ACCEPTED 前免费；ACCEPTED 后收 10%
  const fee = o.status === order_status.ACCEPTED ? Math.round(Number(o.totalAmountFen) * 0.1) : 0
  o.status = order_status.CANCELLED
  o.cancelInitiator = 'COMPANION'
  o.cancelReason = String(data?.reason || '陪聊员取消')
  o.cancelFeeFen = String(fee)
  o.refundAmountFen = String(Number(o.totalAmountFen) - fee)
  o.timeline.push({
    id: nid('tl'),
    fromStatus: null,
    toStatus: order_status.CANCELLED,
    action: 'cancel',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: o.cancelReason,
    createdAt: iso(new Date()),
  })
  saveDb(db)
  return { status: o.status, cancelFeeFen: o.cancelFeeFen, refundAmountFen: o.refundAmountFen }
})

on('POST', '/orders/:id/sos', ({ params, data }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  if (!SERVICE_SET.includes(o.status)) bizError(14002, '当前订单不可挂起')
  o.status = order_status.SUSPENDED
  o.suspendReason = String(data?.reason || '陪聊员发起紧急求助')
  o.timeline.push({
    id: nid('tl'),
    fromStatus: null,
    toStatus: order_status.SUSPENDED,
    action: 'sos_suspend',
    operatorType: operator_type.COMPANION,
    operatorId: 'u_companion_1',
    reason: o.suspendReason,
    createdAt: iso(new Date()),
  })
  saveDb(db)
  return { status: o.status, eventNo: nid('risk') }
})

on('GET', '/orders/:id/verifications', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.id)
  if (!o) bizError(14001)
  return o.verification
})

on('POST', '/verifications/arrival-code', ({ data }) => {
  // 陪聊员端：向老人端请求出示动态码（陪聊员端只收码不显码，红线 §7.1.4）
  return { orderId: String(data?.orderId || ''), requested: true }
})

on('GET', '/verifications/order/:orderId', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.orderId)
  if (!o) bizError(14001)
  return o.verification
})

// ---------------------------------------------------------------------------
// 收入中心（分账/提现）
// ---------------------------------------------------------------------------

on('GET', '/payments/order/:orderId', ({ params }) => {
  const db = getDb()
  const o = db.orders.find((x) => x.id === params.orderId)
  if (!o) bizError(14001)
  const sharing = db.sharings.find((s) => s.orderId === o.id)
  return {
    payment: {
      paymentNo: `PAY${o.orderNo.slice(2)}`,
      status: 'SUCCESS',
      amountFen: o.totalAmountFen,
      paidAt: iso(new Date()),
      refundAmountFen: o.refundAmountFen,
      refundedAt: null,
    },
    sharings: sharing
      ? [
          {
            sharingNo: sharing.sharingNo,
            status: sharing.status,
            frozenAmountFen: sharing.frozenAmountFen,
            platformCommissionFen: sharing.platformCommissionFen,
            companionIncomeFen: sharing.companionIncomeFen,
            commissionRateBp: sharing.commissionRateBp,
            retryCount: 0,
            manualTicketNo: null,
            createdAt: sharing.createdAt,
            sharedAt: sharing.sharedAt,
            returnedAt: sharing.returnedAt,
          },
        ]
      : [],
  }
})

on('GET', '/payments/withdrawals', () => {
  const db = getDb()
  return db.withdrawals
})

on('POST', '/payments/withdrawals', ({ data }) => {
  const db = getDb()
  const amount = Number(data?.amountFen || 0)
  if (amount < 100 || amount > 50000) bizError(15015, '提现金额需在 ¥1–¥500')
  const available = db.sharings
    .filter((s) => s.status === 'SHARED')
    .reduce((acc, s) => acc + Number(s.companionIncomeFen), 0)
  if (amount > available - Number(db.totalWithdrawnFen)) bizError(15015, '可提余额不足')
  const w: WithdrawalView = {
    withdrawalNo: `WD${Date.now()}`,
    amountFen: String(amount),
    status: 'PENDING_REVIEW',
    bankAccountMasked: '6222****8888',
  }
  db.withdrawals.unshift(w)
  db.totalWithdrawnFen = String(Number(db.totalWithdrawnFen) + amount)
  saveDb(db)
  return w
})

on('GET', '/payments/income/overview', () => {
  const db = getDb()
  const shared = db.sharings.filter((s) => s.status === 'SHARED')
  const frozen = db.sharings.filter((s) => s.status === 'FROZEN')
  const totalShared = shared.reduce((a, s) => a + Number(s.companionIncomeFen), 0)
  const pending = frozen.reduce((a, s) => a + Number(s.companionIncomeFen), 0)
  const now = new Date()
  const monthShared = shared
    .filter((s) => {
      const t = new Date(s.sharedAt || s.createdAt)
      return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth()
    })
    .reduce((a, s) => a + Number(s.companionIncomeFen), 0)
  const res: IncomeOverview = {
    availableFen: String(Math.max(0, totalShared - Number(db.totalWithdrawnFen))),
    pendingFen: String(pending),
    totalSharedFen: String(totalShared),
    totalWithdrawnFen: db.totalWithdrawnFen,
    monthSharedFen: String(monthShared),
  }
  return res
})

on('GET', '/payments/sharings/mine', () => {
  const db = getDb()
  const list: SharingRecordView[] = db.sharings
  return { list, total: list.length, page: 1, pageSize: 20 }
})

// 分账模式（契约 §5.3，后台与陪聊员端共用）
// mock 固定为 manual_settlement_fallback：用于验证「资金由平台人工结算」的
// 提示分支真的能渲染出来（联调切回 wechat_profit_sharing 即可）。
// ⚠ 主理人裁定：人工打款**不给精确小时数**（人工打款没有 SLA，写死会被投诉），
//   文案只说「1-3 个工作日」。
on('GET', '/payments/split-mode', () => ({
  mode: SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK,
  manualSettlement: true,
  manualSettleHours: null,
  tip: '当前为平台人工结算模式：服务完成并确认后，平台将人工打款到你的账户，预计 1-3 个工作日到账。',
}))

// ---------------------------------------------------------------------------
// IM（契约 §6.1，会话必须挂订单）
// ---------------------------------------------------------------------------

on('POST', '/im/conversations/order/:orderId', ({ params }) => {
  const db = getDb()
  let conv = db.imConversations.find((c) => c.orderId === params.orderId)
  if (!conv) {
    const o = db.orders.find((x) => x.id === params.orderId)
    if (!o) bizError(14001)
    conv = {
      id: nid('conv'),
      orderId: o.id,
      orderNo: o.orderNo,
      peer: { id: 'u_elder_1', nickname: '王秀芳', avatarUrl: null, role: 'ELDER', status: 'ACTIVE' },
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
          content: '平台沟通全程留痕，请勿交换手机号/微信，私下交易不受平台保障。',
          status: im_message_status.NORMAL,
          reviewStatus: im_review_status.PASS,
          fileUrl: null,
          voiceDurationMs: null,
          asrText: null,
          createdAt: iso(new Date()),
        },
      ],
    }
    db.imConversations.unshift(conv)
    saveDb(db)
  }
  return conv
})

on('GET', '/im/conversations', () => {
  const db = getDb()
  return { list: db.imConversations, total: db.imConversations.length, page: 1, pageSize: 20 }
})

on('GET', '/im/conversations/:id/messages', ({ params }) => {
  const db = getDb()
  const conv = db.imConversations.find((c) => c.id === params.id)
  if (!conv) bizError(17001)
  return conv.messages
})

on('POST', '/im/conversations/:id/messages', ({ params, data }) => {
  const db = getDb()
  const conv = db.imConversations.find((c) => c.id === params.id)
  if (!conv) bizError(17001)
  const content = String(data?.content || '')
  // 风控同步拦截（契约 §8.2）：手机号 / 微信号 / 外链
  const risky =
    /1[3-9]\d{9}/.test(content) ||
    /[a-zA-Z0-9_-]{5,}(微信|weixin|wx)/i.test(content) ||
    /https?:\/\//i.test(content)
  const msg = {
    id: nid('im'),
    senderId: 'u_companion_1',
    senderRole: im_sender_role.COMPANION,
    msgType: String(data?.msgType || 'TEXT'),
    content,
    status: risky ? im_message_status.BLOCKED : im_message_status.NORMAL,
    reviewStatus: risky ? im_review_status.REJECT : im_review_status.PASS,
    fileUrl: null,
    voiceDurationMs: data?.voiceDurationMs ?? null,
    asrText: null,
    createdAt: iso(new Date()),
  }
  conv.messages.push(msg)
  conv.lastMessageAt = msg.createdAt
  conv.lastMessagePreview = content.slice(0, 30)
  saveDb(db)
  return [msg]
})

on('POST', '/im/conversations/:id/read', ({ params }) => {
  const db = getDb()
  const conv = db.imConversations.find((c) => c.id === params.id)
  if (conv) {
    conv.unread = 0
    saveDb(db)
  }
  return { ok: true }
})

on('GET', '/im/privacy-binding/:orderId', ({ params }) => {
  // 隐私号：仅本方视角的虚拟号（架构 §6.4）
  return { virtualNumber: '020-8888-1234', status: 'ACTIVE', expiredAt: null }
})

// ---------------------------------------------------------------------------
// 风控 / SOS（契约 §5.5）
// ---------------------------------------------------------------------------

on('POST', '/risk/sos', ({ data }) => {
  const db = getDb()
  // 入参字段名必须是 description（服务端 zod schema），不是 reason
  const desc = String(data?.description || '一键求助').slice(0, 500)
  // 只有到岗态才挂起（对齐服务端 sosSuspendable）；已完成的订单只建事件+工单
  let suspended = false
  if (data?.orderId) {
    const o = db.orders.find((x) => x.id === data.orderId)
    if (o && SERVICE_SET.includes(o.status)) {
      o.status = order_status.SUSPENDED
      o.suspendReason = `SOS 紧急挂起：${desc}`
      o.timeline.push({
        id: nid('tl'),
        fromStatus: null,
        toStatus: order_status.SUSPENDED,
        action: 'sos_suspend',
        operatorType: operator_type.COMPANION,
        operatorId: 'u_companion_1',
        reason: o.suspendReason,
        createdAt: iso(new Date()),
      })
      suspended = true
    }
    if (o) {
      // 服务端固定 complaints.type='SAFETY' + priority='URGENT'（SOS 工单）
      db.complaints.unshift({
        complaintNo: nid('cp'),
        type: 'SAFETY',
        priority: 'URGENT',
        status: 'PENDING',
        resultNote: null,
        compensationAmountFen: '0',
        createdAt: iso(new Date()),
        handledAt: null,
      })
    }
    saveDb(db)
  }
  // 返回体严格对齐 risk.routes.ts：level 是 risk_events.level=CRITICAL（URGENT 是工单优先级）
  return {
    eventNo: nid('risk'),
    level: 'CRITICAL',
    suspended,
    complaintNo: db.complaints[0]?.complaintNo || '',
  }
})

// 飞单举报（服务端 schema：orderId/type/description(10-1000)/evidenceFileIds≤9）
on('POST', '/risk/reports', ({ data }) => {
  const db = getDb()
  const orderId = String(data?.orderId || '')
  const desc = String(data?.description || '')
  if (desc.trim().length < 10) bizError(10009, '举报内容至少 10 个字')
  const o = db.orders.find((x) => x.id === orderId)
  if (!o) bizError(14001)
  // 被服务的陪聊员不能举报自己服务的订单（服务端 20006）
  if (orderId.startsWith('ord_c')) bizError(20006, '不能举报自己服务的订单')
  // 同订单同举报人已有 PENDING → 20005「举报已受理，请耐心等待核查」（不是提交失败）
  if (db.reports.some((r) => r.orderId === orderId && r.status === 'PENDING')) bizError(20005)
  const r: MyReportView = {
    reportNo: nid('rp'),
    orderId,
    type: String(data?.type || 'OTHER'),
    description: desc.trim(),
    status: 'PENDING',
    createdAt: iso(new Date()),
  }
  db.reports.unshift(r)
  saveDb(db)
  return { reportNo: r.reportNo, status: r.status }
})

// 服务纠纷投诉（服务端 schema：orderId/type/description(10-1000)/evidenceFileIds≤9）
on('POST', '/risk/complaints', ({ data }) => {
  const db = getDb()
  const orderId = String(data?.orderId || '')
  const desc = String(data?.description || '')
  if (desc.trim().length < 10) bizError(10009, '投诉内容至少 10 个字')
  if (!db.orders.some((x) => x.id === orderId)) bizError(14001)
  const c: MyComplaintView = {
    complaintNo: nid('cp'),
    type: String(data?.type || 'OTHER'),
    // 服务端固定 priority='NORMAL'（SOS 才走 URGENT）
    priority: 'NORMAL',
    status: 'PENDING',
    resultNote: null,
    compensationAmountFen: '0',
    createdAt: iso(new Date()),
    handledAt: null,
  }
  db.complaints.unshift(c)
  saveDb(db)
  return { complaintNo: c.complaintNo, status: c.status }
})

// 我的投诉 —— 主理人裁定改真分页（page/pageSize + 分页信封）。
// 服务端现状仍是 take:50 裸数组，这里按裁定后的目标形态返回信封；
// service 层同时兼容两种形态，所以联调期切回数组也不会崩。
on('GET', '/risk/complaints/mine', ({ query }) => {
  const db = getDb()
  const page = Math.max(1, Number(query?.page || 1))
  const pageSize = Math.max(1, Number(query?.pageSize || 20))
  // 按 created_at desc（服务端 orderBy）
  const sorted = [...db.complaints].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const start = (page - 1) * pageSize
  return {
    list: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page,
    pageSize,
  }
})

// ---------------------------------------------------------------------------
// 派单候选（mock 专用：模拟平台派单推送给本陪聊员）
// ---------------------------------------------------------------------------

on('GET', '/companion/me/orders', () => {
  const db = getDb()
  return { list: db.orders, total: db.orders.length, page: 1, pageSize: 20 }
})

on('GET', '/companion/dispatch/candidates', () => {
  const db = getDb()
  return db.pool
})

// ---------------------------------------------------------------------------
// mock 入口
// ---------------------------------------------------------------------------

export async function mockRequest<T>(options: RequestOptions): Promise<T> {
  const method = options.method || 'GET'
  const path = options.url.split('?')[0]
  const query: Record<string, string> = {}
  const qs = options.url.split('?')[1]
  if (qs) {
    qs.split('&').forEach((kv) => {
      const [k, v] = kv.split('=')
      if (k) query[k] = decodeURIComponent(v || '')
    })
  }
  const hit = matchRoute(method, path)
  if (!hit) {
    // 未覆盖端点：返回空信封，交由页面兜底（不抛错，便于演示继续）
    console.warn('[mock] 未实现的端点', method, path)
    await delay(120)
    return {} as T
  }
  await delay(150)
  const data = hit.handler({
    method,
    path,
    params: hit.params,
    query,
    data: (options.data || {}) as Record<string, any>,
  })
  return data as T
}
