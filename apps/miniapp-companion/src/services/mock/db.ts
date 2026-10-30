// ============================================================================
// Mock 数据层（无后端环境演示用）——陪聊员端
// ----------------------------------------------------------------------------
// 策略：种子数据 + Taro Storage 持久化，页面间流转（四审→接单→核销→服务→收入）
// 在同一会话内可点通。后端就绪后：.env 的 TARO_APP_USE_MOCK 置 false，
// 本目录（mock/）整体删除即可，services 其余代码零改动。
// 数据形状对齐 @linban/shared DTO + 服务端 serializeOrder 实际出参。
//
// 已知偏差（回传主理人）：
// 1. 两端 mock 各自独立存储（两小程序 Storage 不互通），跨端联动需人工同步；
// 2. 服务端 GET /companion/me 未返回 nickname/avatar/level 字段，端上从
//    /auth/profile 补齐（见 services/companion.ts 合并逻辑）。
// ============================================================================

import type {
  CompanionSelfView,
  CompanionOrderView,
  CreditLogDTO,
  DepositTxDTO,
  DispatchPoolItem,
  MyComplaintView,
  MyReportView,
  ScheduleDTO,
  SharingRecordView,
  UserBriefDTO,
  WithdrawalView,
  ApplicationStatusDTO as AppStatus,
} from '@/types'
import {
  order_status,
  application_stage,
  step_status,
  credit_log_type,
  deposit_tx_type,
  tx_status,
  schedule_status,
  companion_status,
  verification_status,
  im_sender_role,
  im_message_type,
  im_message_status,
  im_review_status,
  operator_type,
  user_role,
  payment_status,
} from '@linban/shared'
import { storage } from '@/utils/storage'

const DB_KEY = 'companion_mock_db_v1'

// 订单状态分组（模块级常量，避免字面量数组造成 TS 类型窄化）
const ARRIVED_SET: order_status[] = [
  order_status.ARRIVED,
  order_status.IN_SERVICE,
  order_status.PENDING_CONFIRM,
  order_status.COMPLETED,
]
const IN_SERVICE_SET: order_status[] = [
  order_status.IN_SERVICE,
  order_status.PENDING_CONFIRM,
  order_status.COMPLETED,
]
const PENDING_SET: order_status[] = [order_status.PENDING_CONFIRM, order_status.COMPLETED]
const DONE_SET: order_status[] = [order_status.COMPLETED, order_status.CLOSED]
const TERMINAL_SET: order_status[] = [order_status.CANCELLED, order_status.CLOSED, order_status.REFUNDED]

export interface MockDb {
  seq: number
  /** 我的陪聊员主档 */
  self: CompanionSelfView
  /** 我的入驻申请（四审） */
  application: AppStatus
  /** 信用分明细（只增不改） */
  creditLogs: CreditLogDTO[]
  /** 保证金流水 */
  depositTxs: DepositTxDTO[]
  /** 我的日程 */
  schedules: ScheduleDTO[]
  /** 我的订单（已接单的） */
  orders: CompanionOrderView[]
  /** 接单池（DISPATCHED 广播单） */
  pool: DispatchPoolItem[]
  /** 分账明细 */
  sharings: SharingRecordView[]
  /** 提现记录 */
  withdrawals: WithdrawalView[]
  /** 我发起的投诉（SOS 自动生成的 URGENT 工单 + 主动投诉） */
  complaints: MyComplaintView[]
  /** 我提交的举报留痕（用于 mock 出「同订单重复提交 → 20005」） */
  reports: MyReportView[]
  /** IM 会话与消息 */
  imConversations: {
    id: string
    orderId: string
    orderNo: string
    peer: { id: string; nickname: string; avatarUrl: string | null; role: string; status: string }
    unread: number
    lastMessageAt: string | null
    lastMessagePreview: string | null
    status: string
    messages: {
      id: string
      senderId: string
      senderRole: string
      msgType: string
      content: string
      status: string
      reviewStatus: string
      fileUrl: string | null
      voiceDurationMs: number | null
      asrText: string | null
      createdAt: string
    }[]
  }[]
  /** 累计提现（分） */
  totalWithdrawnFen: string
}

let idSeq = 500
export const nid = (p: string) => `${p}_${++idSeq}`
export const iso = (d: Date) => d.toISOString()
export const minutesLater = (m: number) => new Date(Date.now() + m * 60_000)
const hoursLater = (h: number) => new Date(Date.now() + h * 3_600_000)
const daysLaterAt = (days: number, hh: number, mm = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hh, mm, 0, 0)
  return d
}
const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function delay(ms = 220): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export const mockUtil = { nid, iso, minutesLater, hoursLater, daysLaterAt, dateStr, delay }

// ---------------------------------------------------------------------------
// 种子数据
// ---------------------------------------------------------------------------

const ELDER_BRIEF: UserBriefDTO = {
  id: 'u_elder_1',
  nickname: '王秀芳',
  avatarUrl: null,
  role: user_role.ELDER,
  status: 'ACTIVE',
}

const CHILD_BRIEF: UserBriefDTO = {
  id: 'u_child_1',
  nickname: '王磊',
  avatarUrl: null,
  role: user_role.FAMILY,
  status: 'ACTIVE',
}

function seedSelf(): CompanionSelfView {
  return {
    id: 'cmp_1',
    status: companion_status.ACTIVE,
    creditScore: 96,
    limited: false,
    hourlyRateFen: '12000',
    serviceRadiusM: 5000,
    tags: ['耐心', '会做饭', '讲老故事', '唱歌好听'],
    ratingAvg: '4.9',
    ratingCount: 128,
    totalOrders: 156,
    completedOrders: 149,
    cancelledOrders: 5,
    depositBalanceFen: '50000',
    createdAt: iso(hoursLater(-24 * 200)),
  }
}

function seedApplication(): AppStatus {
  return {
    applicationNo: 'AP2026090001',
    stage: application_stage.ACTIVE,
    stepStatuses: {
      realname: step_status.PASSED,
      face: step_status.PASSED,
      criminal: step_status.PASSED,
      exam: step_status.PASSED,
      deposit: step_status.PASSED,
    },
    examScore: 92,
    examAttemptNo: 1,
    depositAmountFen: '50000',
    depositPaidAt: iso(hoursLater(-24 * 190)),
    rejectReason: null,
    submittedAt: iso(hoursLater(-24 * 195)),
    decidedAt: iso(hoursLater(-24 * 190)),
  }
}

function seedCreditLogs(): CreditLogDTO[] {
  return [
    {
      id: nid('cl'),
      changeScore: 1,
      type: credit_log_type.GOOD_REVIEW,
      beforeScore: 95,
      afterScore: 96,
      reason: '订单 OB20260901001 收到好评',
      relatedOrderId: null,
      createdAt: iso(hoursLater(-30)),
    },
    {
      id: nid('cl'),
      changeScore: 1,
      type: credit_log_type.GOOD_REVIEW,
      beforeScore: 94,
      afterScore: 95,
      reason: '订单 OB20260828003 收到好评',
      relatedOrderId: null,
      createdAt: iso(hoursLater(-72)),
    },
    {
      id: nid('cl'),
      changeScore: -3,
      type: credit_log_type.BAD_REVIEW,
      beforeScore: 97,
      afterScore: 94,
      reason: '订单 OB20260820001 收到差评（服务时长不足）',
      relatedOrderId: null,
      createdAt: iso(hoursLater(-96)),
    },
    {
      id: nid('cl'),
      changeScore: 1,
      type: credit_log_type.GOOD_REVIEW,
      beforeScore: 96,
      afterScore: 97,
      reason: '订单 OB20260815002 收到好评',
      relatedOrderId: null,
      createdAt: iso(hoursLater(-120)),
    },
  ]
}

function seedDepositTxs(): DepositTxDTO[] {
  return [
    {
      id: nid('dt'),
      txNo: 'DT20260815001',
      type: deposit_tx_type.IN,
      amountFen: '50000',
      balanceAfterFen: '50000',
      status: tx_status.SUCCESS,
      remark: '入驻缴纳保证金',
      createdAt: iso(hoursLater(-24 * 190)),
    },
  ]
}

function seedSchedules(): ScheduleDTO[] {
  const out: ScheduleDTO[] = []
  // 周期模板：周一至周五 09:00-12:00 / 14:00-18:00
  for (const wd of [1, 2, 3, 4, 5]) {
    out.push({
      id: nid('sch'),
      date: null,
      weekday: wd,
      startTime: '09:00',
      endTime: '12:00',
      status: schedule_status.AVAILABLE,
      note: null,
    })
    out.push({
      id: nid('sch'),
      date: null,
      weekday: wd,
      startTime: '14:00',
      endTime: '18:00',
      status: schedule_status.AVAILABLE,
      note: null,
    })
  }
  // 未来三天具体日期时段
  for (let i = 0; i < 3; i++) {
    const d = daysLaterAt(i, 9)
    out.push({
      id: nid('sch'),
      date: dateStr(d),
      weekday: null,
      startTime: '10:00',
      endTime: '12:00',
      status: schedule_status.AVAILABLE,
      note: '本周加开',
    })
  }
  return out
}

function timelineOf(
  orderId: string,
  status: order_status,
  slotStart: Date,
  duration: number,
): CompanionOrderView['timeline'] {
  void orderId
  const t = (
    to: order_status,
    action: string,
    at: Date,
    reason?: string,
  ): CompanionOrderView['timeline'][number] => ({
    id: nid('tl'),
    fromStatus: null,
    toStatus: to,
    action,
    operatorType: operator_type.SYSTEM,
    operatorId: null,
    reason: reason ?? null,
    createdAt: iso(at),
  })
  const list: CompanionOrderView['timeline'] = []
  list.push(t(order_status.CREATED, 'create', hoursLater(-26)))
  list.push(t(order_status.PAID, 'pay', hoursLater(-25.8)))
  if (status !== order_status.CREATED && status !== order_status.PAID) {
    list.push(t(order_status.ACCEPTED, 'accept', hoursLater(-25)))
  }
  if (ARRIVED_SET.includes(status)) {
    list.push(t(order_status.ARRIVED, 'verify', hoursLater(-24)))
  }
  if (IN_SERVICE_SET.includes(status)) {
    list.push(t(order_status.IN_SERVICE, 'start', hoursLater(-23.9)))
  }
  if (PENDING_SET.includes(status)) {
    list.push(t(order_status.PENDING_CONFIRM, 'finish', hoursLater(-23)))
  }
  if (status === order_status.COMPLETED) {
    list.push(t(order_status.COMPLETED, 'confirm', hoursLater(-22.9)))
  }
  return list
}

function seedOrders(): CompanionOrderView[] {
  const mk = (
    id: string,
    orderNo: string,
    status: order_status,
    dayOffset: number,
    hour: number,
    duration: number,
    nightOrder: boolean,
    familyConfirmed: boolean,
  ): CompanionOrderView => {
    const slotStart = daysLaterAt(dayOffset, hour)
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    const rate = 12000
    const total = Math.round((rate * duration) / 60)
    return {
      id,
      orderNo,
      status,
      serviceType: 'CHAT',
      durationMinutes: duration,
      serviceDate: dateStr(slotStart),
      slotStart: iso(slotStart),
      slotEnd: iso(slotEnd),
      totalAmountFen: String(total),
      hourlyRateFen: String(rate),
      couponDeductFen: '0',
      giftCardDeductFen: '0',
      companion: {
        id: 'cmp_1',
        userId: 'u_companion_1',
        nickname: '张阿姨',
        avatarUrl: null,
        level: 3,
        ratingAvg: '4.9',
        ratingCount: 128,
        tags: ['耐心', '会做饭'],
        hourlyRateFen: String(rate),
        serviceRadiusM: 5000,
        distanceM: 1200,
        totalOrders: 156,
        status: companion_status.ACTIVE,
      },
      elderNickname: ELDER_BRIEF.nickname,
      addressMasked: '天河区·体育西路',
      distanceM: 1200,
      nightOrder,
      familyConfirmed,
      // 挂起原因（仅 SUSPENDED 有值；shared 已改为必填，其余统一 null 兜底）
      suspendReason: status === order_status.SUSPENDED ? '陪聊员发起紧急求助' : null,
      createdAt: iso(hoursLater(-26)),
      user: ELDER_BRIEF,
      elderUser: ELDER_BRIEF,
      cancelInitiator: null,
      cancelReason: null,
      cancelFeeFen: '0',
      refundAmountFen: '0',
      dispatchedAt: iso(hoursLater(-25.5)),
      dispatchDeadlineAt: iso(minutesLater(30)),
      acceptedAt: status !== order_status.CREATED && status !== order_status.PAID ? iso(hoursLater(-25)) : null,
      arrivedAt: ARRIVED_SET.includes(status) ? iso(hoursLater(-24)) : null,
      serviceStartedAt: IN_SERVICE_SET.includes(status) ? iso(hoursLater(-23.9)) : null,
      serviceEndedAt: PENDING_SET.includes(status) ? iso(hoursLater(-23)) : null,
      completedAt: status === order_status.COMPLETED ? iso(hoursLater(-22.9)) : null,
      closedAt: null,
      timeline: timelineOf(id, status, slotStart, duration),
      verification:
        status === order_status.CREATED || status === order_status.PAID
          ? null
          : {
              id: nid('vf'),
              type: 'ARRIVAL',
              status: verification_status.PASSED,
              faceScore: 92,
              facePassed: true,
              gpsDeviationM: 120,
              arrivedAt: iso(hoursLater(-24)),
              companionConfirmedAt: iso(hoursLater(-24)),
              elderConfirmedAt: iso(hoursLater(-24)),
              elderVoiceAsr: null,
              attemptNo: 1,
            },
      payment: {
        paymentNo: `PAY${orderNo.slice(2)}`,
        status: payment_status.SUCCESS,
        amountFen: String(total),
        profitSharing: false,
        paidAt: iso(hoursLater(-25.8)),
        refundAmountFen: '0',
        refundedAt: null,
      },
      sharing:
        status === order_status.COMPLETED
          ? {
              sharingNo: nid('ps'),
              status: 'SHARED',
              frozenAmountFen: String(total),
              companionIncomeFen: String(Math.round(total * 0.95)),
              platformCommissionFen: String(Math.round(total * 0.05)),
              commissionRateBp: 500,
              retryCount: 0,
              createdAt: iso(hoursLater(-22.8)),
              sharedAt: iso(hoursLater(-22.8)),
              returnedAt: null,
            }
          : null,
    }
  }

  return [
    mk('ord_c1', 'OB20260901001', order_status.COMPLETED, -3, 10, 120, false, true),
    mk('ord_c2', 'OB20260901002', order_status.IN_SERVICE, 0, 9, 120, false, true),
    mk('ord_c3', 'OB20260901003', order_status.ACCEPTED, 0, 23, 90, true, false),
    mk('ord_c4', 'OB20260901004', order_status.PENDING_CONFIRM, -1, 15, 60, false, true),
    mk('ord_c5', 'OB20260901005', order_status.SUSPENDED, -1, 14, 120, false, true),
  ]
}

function seedPool(): DispatchPoolItem[] {
  const mk = (
    id: string,
    orderNo: string,
    dayOffset: number,
    hour: number,
    duration: number,
    distance: number,
    nightOrder: boolean,
    familyConfirmed: boolean,
  ): DispatchPoolItem => {
    const slotStart = daysLaterAt(dayOffset, hour)
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    const total = Math.round((12000 * duration) / 60)
    return {
      id,
      orderNo,
      serviceDate: dateStr(slotStart),
      slotStart: iso(slotStart),
      slotEnd: iso(slotEnd),
      durationMinutes: duration,
      totalAmountFen: String(total),
      distanceM: distance,
      nightOrder,
      familyConfirmed,
      estimateIncomeFen: String(Math.round(total * 0.95)),
    }
  }
  return [
    mk('pool_1', 'OB20260902001', 1, 9, 120, 800, false, true),
    mk('pool_2', 'OB20260902002', 1, 14, 60, 1500, false, true),
    mk('pool_3', 'OB20260902003', 1, 19, 90, 2300, false, true),
    mk('pool_4', 'OB20260902004', 2, 23, 120, 1800, true, false),
  ]
}

function seedSharings(): SharingRecordView[] {
  return [
    {
      orderId: 'ord_c1',
      orderNo: 'OB20260901001',
      sharingNo: 'PS20260901001',
      status: 'SHARED',
      frozenAmountFen: '24000',
      platformCommissionFen: '1200',
      companionIncomeFen: '22800',
      commissionRateBp: 500,
      durationMinutes: 120,
      createdAt: iso(hoursLater(-22.8)),
      sharedAt: iso(hoursLater(-22.8)),
      returnedAt: null,
    },
    {
      orderId: 'ord_c4',
      orderNo: 'OB20260901004',
      sharingNo: 'PS20260901002',
      // FROZEN + 已发起分账（sharedAt 非空）→ 前端展示「分账中」；
      // 另一条 FROZEN + sharedAt 为空 → 展示「待分账」（服务未核销完成）。
      status: 'FROZEN',
      frozenAmountFen: '12000',
      platformCommissionFen: '600',
      companionIncomeFen: '11400',
      commissionRateBp: 500,
      durationMinutes: 60,
      createdAt: iso(hoursLater(-22.5)),
      sharedAt: iso(hoursLater(-22.4)),
      returnedAt: null,
    },
    {
      orderId: 'ord_c5',
      orderNo: 'OB20260901005',
      sharingNo: 'PS20260901003',
      // 服务中：FROZEN 且未发起分账 → 「待分账」，钱冻结着（防飞单财务基石）
      status: 'FROZEN',
      frozenAmountFen: '18000',
      platformCommissionFen: '900',
      companionIncomeFen: '17100',
      commissionRateBp: 500,
      durationMinutes: 90,
      createdAt: iso(hoursLater(-1.2)),
      sharedAt: null,
      returnedAt: null,
    },
  ]
}

function seedWithdrawals(): WithdrawalView[] {
  return [
    {
      withdrawalNo: 'WD20260820001',
      amountFen: '10000',
      status: 'SUCCESS',
      bankAccountMasked: '6222****8888',
    },
  ]
}

/** 我发起的投诉种子（SOS 自动生成的 URGENT 工单 + 主动投诉） */
function seedComplaints(): MyComplaintView[] {
  return [
    {
      // 已裁决并补偿：演示「平台判定成立 → 退差额 + 补偿」这条最关心的路径
      complaintNo: 'CP20260815001',
      type: 'SERVICE_QUALITY',
      priority: 'NORMAL',
      status: 'RESOLVED',
      resultNote:
        '经核实服务时长 120 分钟属实，但约定时长为 150 分钟，差额部分已按比例退还 1500 分（¥15）。',
      compensationAmountFen: '1500',
      createdAt: iso(hoursLater(-200)),
      handledAt: iso(hoursLater(-186)),
    },
    {
      // 平台核查不成立：演示「不是所有投诉都会被支持」
      complaintNo: 'CP20260828002',
      type: 'ATTITUDE',
      priority: 'LOW',
      status: 'REJECTED',
      resultNote:
        '已回访核实：当日服务过程中老人主动要求更换话题与活动安排，双方均确认无态度问题，本次诉求不予支持。',
      compensationAmountFen: '0',
      createdAt: iso(hoursLater(-120)),
      handledAt: iso(hoursLater(-110)),
    },
    {
      // 处理中：演示「还在等结果」，避免 mock 看起来全部秒结
      complaintNo: 'CP20260910003',
      type: 'CHARGE',
      priority: 'HIGH',
      status: 'PROCESSING',
      resultNote: null,
      compensationAmountFen: '0',
      createdAt: iso(hoursLater(-30)),
      handledAt: null,
    },
  ]
}

/** 举报留痕种子：一条已被认定属实的飞单举报（演示奖励券发放） */
function seedReports(): MyReportView[] {
  return [
    {
      reportNo: 'RP20260810001',
      orderId: 'ord_x1',
      type: 'OFF_PLATFORM_PAY',
      description: '服务结束后对方要求私下转账结算后续费用，金额高于平台定价。',
      status: 'SUBSTANTIATED',
      createdAt: iso(hoursLater(-300)),
    },
  ]
}

function seedIm(orders: CompanionOrderView[]): MockDb['imConversations'] {
  const o = orders[1]
  return [
    {
      id: 'conv_1',
      orderId: o.id,
      orderNo: o.orderNo,
      peer: { id: ELDER_BRIEF.id, nickname: ELDER_BRIEF.nickname, avatarUrl: null, role: 'ELDER', status: 'ACTIVE' },
      unread: 1,
      lastMessageAt: iso(minutesLater(-12)),
      lastMessagePreview: '我快到家了，您到了吗？',
      status: 'ACTIVE',
      messages: [
        {
          id: nid('im'),
          senderId: 'system',
          senderRole: im_sender_role.SYSTEM,
          msgType: im_message_type.SYSTEM,
          content: '平台沟通全程留痕，请勿交换手机号/微信。',
          status: im_message_status.NORMAL,
          reviewStatus: im_review_status.PASS,
          fileUrl: null,
          voiceDurationMs: null,
          asrText: null,
          createdAt: iso(hoursLater(-24)),
        },
        {
          id: nid('im'),
          senderId: ELDER_BRIEF.id,
          senderRole: im_sender_role.USER,
          msgType: im_message_type.TEXT,
          content: '我快到家了，您到了吗？',
          status: im_message_status.NORMAL,
          reviewStatus: im_review_status.PASS,
          fileUrl: null,
          voiceDurationMs: null,
          asrText: null,
          createdAt: iso(minutesLater(-12)),
        },
      ],
    },
  ]
}

function seedDb(): MockDb {
  const orders = seedOrders()
  return {
    seq: idSeq,
    self: seedSelf(),
    application: seedApplication(),
    creditLogs: seedCreditLogs(),
    depositTxs: seedDepositTxs(),
    schedules: seedSchedules(),
    orders,
    pool: seedPool(),
    sharings: seedSharings(),
    withdrawals: seedWithdrawals(),
    complaints: seedComplaints(),
    reports: seedReports(),
    imConversations: seedIm(orders),
    totalWithdrawnFen: '10000',
  }
}

let db: MockDb | null = null

export function getDb(): MockDb {
  if (db) return db
  const cached = storage.get<MockDb | null>(DB_KEY, null)
  if (cached && cached.orders) {
    db = cached
    return db
  }
  db = seedDb()
  saveDb(db)
  return db
}

export function saveDb(next: MockDb): void {
  db = next
  next.seq = idSeq
  storage.set(DB_KEY, next)
}

export function resetDb(): MockDb {
  db = seedDb()
  storage.remove(DB_KEY)
  saveDb(db)
  return db
}

export { TERMINAL_SET, DONE_SET }
