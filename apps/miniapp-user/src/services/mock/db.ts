// ============================================================================
// Mock 数据层（无后端环境演示用）
// ----------------------------------------------------------------------------
// 策略：种子数据 + Taro Storage 持久化，页面间流转（下单→支付→跟踪→评价）
// 在同一会话内可点通。后端就绪后：.env 的 TARO_APP_USE_MOCK 置 false，
// 本目录（mock/）整体删除即可，services 其余代码零改动。
// 数据形状全部对齐 @linban/shared DTO（R 态脱敏口径：端上无 creditScore 等）。
// ============================================================================

import type {
  AiSessionDTO,
  CompanionDetail,
  ConversationDTO,
  CouponDTO,
  FamilyBindingDTO,
  GiftCardDTO,
  MessageDTO,
  OrderDetailView,
  PolicyDTO,
  ReviewDTO,
  UserBriefDTO,
  UserCouponDTO,
} from '@/types'
import { order_status, im_sender_role, im_message_type, im_review_status } from '@linban/shared'
import { storage } from '@/utils/storage'

const DB_KEY = 'mock_db_v1'

// 订单状态分组（提升为模块级常量，避免字面量数组导致 TS 类型窄化报错）
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

export interface MockDb {
  seq: number
  companions: CompanionDetail[]
  orders: OrderDetailView[]
  /** 可领券模板（GET /marketing/coupons → CouponDTO[]） */
  couponTemplates: CouponDTO[]
  giftCards: GiftCardDTO[]
  coupons: UserCouponDTO[]
  policies: PolicyDTO[]
  familyBindings: FamilyBindingDTO[]
  imConversations: (ConversationDTO & { messages: MessageDTO[] })[]
  aiSessions: AiSessionDTO[]
  /** 老人档案（夜间单豁免口径 A 需要判断生日是否满 18 岁） */
  elderProfile: { userId: string; nickname: string; birthday: string | null } | null
}

const now = () => new Date()
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

let idSeq = 100
export const nid = (p: string) => `${p}_${++idSeq}`

export const mockUtil = { nid, iso, minutesLater, hoursLater, daysLaterAt, dateStr, delay }

export function delay(ms = 220): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

const ELDER_BRIEF: UserBriefDTO = {
  id: 'u_elder_1',
  nickname: '王秀芳',
  avatarUrl: null,
  role: 'ELDER',
  status: 'ACTIVE',
}
const FAMILY_BRIEF: UserBriefDTO = {
  id: 'u_family_1',
  nickname: '陈小芳',
  avatarUrl: null,
  role: 'FAMILY',
  status: 'ACTIVE',
}

// ---------------------------------------------------------------------------
// 种子：陪聊员（6 位，广州单城；CompanionPublicDTO 口径，无信用分等内部列）
// ---------------------------------------------------------------------------

function seedCompanions(): CompanionDetail[] {
  const base: {
    nickname: string
    tags: string[]
    ratingAvg: string
    ratingCount: number
    hourlyRateFen: string
    distanceM: number
    level: number
    totalOrders: number
    intro: string
    languages: string[]
    reviews: ReviewDTO[]
  }[] = [
    {
      nickname: '陈美华',
      tags: ['粤语', '散步', '棋牌'],
      ratingAvg: '4.9',
      ratingCount: 128,
      hourlyRateFen: '25000',
      distanceM: 800,
      level: 5,
      totalOrders: 210,
      intro: '退休语文教师，耐心健谈，粤语普通话均可，擅长陪老人散步下棋。',
      languages: ['粤语', '普通话'],
      reviews: [
        { id: 'r1', orderId: 'o_seed1', orderNo: 'O-SEED-1', reviewerRole: 'USER', rating: 5, tags: ['有耐心', '聊得来'], content: '陈老师很有耐心，陪我爸聊了一下午。', status: 'APPROVED', isAnonymous: false, replyContent: '谢谢王叔，下次再聊！', createdAt: iso(hoursLater(-72)) },
        { id: 'r2', orderId: 'o_seed2', orderNo: 'O-SEED-2', reviewerRole: 'USER', rating: 5, tags: ['守时'], content: null, status: 'APPROVED', isAnonymous: true, replyContent: null, createdAt: iso(hoursLater(-240)) },
      ],
    },
    {
      nickname: '李国强',
      tags: ['普通话', '时事新闻', '书法'],
      ratingAvg: '4.8',
      ratingCount: 96,
      hourlyRateFen: '22000',
      distanceM: 1500,
      level: 4,
      totalOrders: 160,
      intro: '退休记者，消息灵通，喜欢聊新闻历史，也能教书法入门。',
      languages: ['普通话'],
      reviews: [
        { id: 'r3', orderId: 'o_seed3', orderNo: 'O-SEED-3', reviewerRole: 'USER', rating: 5, tags: ['很专业'], content: '李叔讲新闻头头是道，老人很开心。', status: 'APPROVED', isAnonymous: false, replyContent: null, createdAt: iso(hoursLater(-120)) },
      ],
    },
    {
      nickname: '张玉珍',
      tags: ['粤语', '烹饪', '养生操'],
      ratingAvg: '5.0',
      ratingCount: 64,
      hourlyRateFen: '28000',
      distanceM: 2100,
      level: 5,
      totalOrders: 98,
      intro: '粤菜厨师出身，会教做家常菜，带老人做养生操，人气很高。',
      languages: ['粤语'],
      reviews: [
        { id: 'r4', orderId: 'o_seed4', orderNo: 'O-SEED-4', reviewerRole: 'USER', rating: 5, tags: ['声音亲切'], content: null, status: 'APPROVED', isAnonymous: false, replyContent: null, createdAt: iso(hoursLater(-48)) },
      ],
    },
    {
      nickname: '周文斌',
      tags: ['普通话', '历史', '象棋'],
      ratingAvg: '4.7',
      ratingCount: 45,
      hourlyRateFen: '20000',
      distanceM: 2600,
      level: 3,
      totalOrders: 70,
      intro: '历史爱好者，象棋业余段位，陪老人下棋讲故事。',
      languages: ['普通话'],
      reviews: [],
    },
    {
      nickname: '林淑芬',
      tags: ['粤语', '园艺', '老歌'],
      ratingAvg: '4.8',
      ratingCount: 38,
      hourlyRateFen: '26000',
      distanceM: 3200,
      level: 4,
      totalOrders: 55,
      intro: '社区园艺达人，爱唱老歌，性格温和有耐心。',
      languages: ['粤语'],
      reviews: [],
    },
    {
      nickname: '吴志远',
      tags: ['普通话', '摄影', '太极拳'],
      ratingAvg: '4.9',
      ratingCount: 52,
      hourlyRateFen: '30000',
      distanceM: 3800,
      level: 4,
      totalOrders: 80,
      intro: '退休摄影师，会带老人逛公园拍照、打太极拳。',
      languages: ['普通话'],
      reviews: [],
    },
  ]

  return base.map((c, i) => ({
    id: `c_${i + 1}`,
    userId: `u_cmp_${i + 1}`,
    nickname: c.nickname,
    avatarUrl: null,
    level: c.level,
    ratingAvg: c.ratingAvg,
    ratingCount: c.ratingCount,
    tags: c.tags,
    hourlyRateFen: c.hourlyRateFen,
    serviceRadiusM: 3000,
    distanceM: c.distanceM,
    totalOrders: c.totalOrders,
    status: 'ACTIVE',
    intro: c.intro,
    languages: c.languages,
    slots: seedSlots(i),
    reviews: c.reviews,
  }))
}

/** 未来 7 天可约时段（错位剔除几个，模拟已约满） */
function seedSlots(companionIdx: number): CompanionDetail['slots'] {
  const templates = [
    ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '19:00', '20:00'],
    ['09:30', '10:30', '14:30', '15:30', '16:30', '19:30'],
    ['08:30', '09:30', '10:30', '14:00', '15:00', '20:00', '21:00'],
  ]
  const out: CompanionDetail['slots'] = []
  for (let i = 0; i < 7; i++) {
    const d = daysLaterAt(i, 0)
    const all = templates[(companionIdx + i) % templates.length]
    const slots = all.filter((_, idx) => (idx + companionIdx + i) % 4 !== 1)
    out.push({ date: dateStr(d), weekday: d.getDay(), slots })
  }
  return out
}

// ---------------------------------------------------------------------------
// 种子：订单（OrderDetailDTO，覆盖状态机各阶段）
// ---------------------------------------------------------------------------

function tl(orderId: string, to: order_status, action: string, at: Date, reason?: string) {
  return {
    id: nid('tl'),
    fromStatus: null,
    toStatus: to,
    action,
    operatorType: 'SYSTEM' as const,
    operatorId: null,
    reason: reason ?? null,
    createdAt: iso(at),
  }
}

function seedOrders(companions: CompanionDetail[]): OrderDetailView[] {
  const make = (
    id: string,
    orderNo: string,
    status: order_status,
    companion: CompanionDetail,
    dayOffset: number,
    hour: number,
    duration: number,
    extra: Partial<OrderDetailView> = {},
  ): OrderDetailView => {
    const slotStart = daysLaterAt(dayOffset, hour)
    const slotEnd = new Date(slotStart.getTime() + duration * 60_000)
    const rate = Number(companion.hourlyRateFen)
    const original = Math.round((rate * duration) / 60)
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
    const timeline = [
      tl(id, order_status.CREATED, 'create', hoursLater(-26)),
      tl(id, order_status.PAID, 'pay', hoursLater(-25.8)),
    ]
    if (status !== order_status.CREATED && status !== order_status.PAID) {
      timeline.push(tl(id, order_status.ACCEPTED, 'accept', hoursLater(-25)))
    }
    if (ARRIVED_SET.includes(status)) {
      timeline.push(tl(id, order_status.ARRIVED, 'verify', hoursLater(-24)))
    }
    if (IN_SERVICE_SET.includes(status)) {
      timeline.push(tl(id, order_status.IN_SERVICE, 'start', hoursLater(-23.9)))
    }
    if (PENDING_SET.includes(status)) {
      timeline.push(tl(id, order_status.PENDING_CONFIRM, 'finish', hoursLater(-23)))
    }
    if (status === order_status.COMPLETED) {
      timeline.push(tl(id, order_status.COMPLETED, 'confirm', hoursLater(-22.9)))
    }

    const paid = status !== order_status.CREATED
    return {
      id,
      orderNo,
      status,
      serviceType: 'CHAT',
      durationMinutes: duration,
      serviceDate: dateStr(slotStart),
      slotStart: iso(slotStart),
      slotEnd: iso(slotEnd),
      totalAmountFen: String(original),
      hourlyRateFen: String(rate),
      couponDeductFen: '0',
      giftCardDeductFen: '0',
      companion: publicCard,
      elderNickname: '王秀芳',
      addressMasked: '天河区·体育西路',
      distanceM: companion.distanceM ?? 0,
      nightOrder: hour >= 22 || hour < 6,
      // 夜间单子女确认态（豁免口径 A：老人本人满 18 岁创建即自确认）
      familyConfirmed: !(hour >= 22 || hour < 6),
      dispatchDeadlineAt: iso(minutesLater(30)),
      suspendReason: null,
      createdAt: iso(hoursLater(-26)),
      user: ELDER_BRIEF,
      elderUser: ELDER_BRIEF,
      cancelInitiator: null,
      cancelReason: null,
      cancelFeeFen: '0',
      refundAmountFen: '0',
      dispatchedAt: paid ? iso(hoursLater(-25.5)) : null,
      acceptedAt: status !== order_status.CREATED && status !== order_status.PAID ? iso(hoursLater(-25)) : null,
      arrivedAt: ARRIVED_SET.includes(status) ? iso(hoursLater(-24)) : null,
      serviceStartedAt: IN_SERVICE_SET.includes(status) ? iso(hoursLater(-23.9)) : null,
      serviceEndedAt: PENDING_SET.includes(status) ? iso(hoursLater(-23)) : null,
      completedAt: status === order_status.COMPLETED ? iso(hoursLater(-22.9)) : null,
      closedAt: null,
      timeline,
      verification:
        status === order_status.CREATED || status === order_status.PAID
          ? null
          : {
              id: nid('vf'),
              type: 'ARRIVAL',
              status: 'PASSED',
              attemptNo: 1,
              faceScore: 92,
              facePassed: true,
              gpsDeviationM: 120,
              arrivedAt: iso(hoursLater(-24)),
              companionConfirmedAt: iso(hoursLater(-23)),
              elderConfirmedAt: null,
              elderVoiceAsr: null,
            },
      payment: paid
        ? {
            paymentNo: `PAY${id}`,
            status: 'SUCCESS',
            amountFen: String(original),
            profitSharing: true,
            paidAt: iso(hoursLater(-25.8)),
            refundAmountFen: '0',
            refundedAt: null,
          }
        : null,
      sharing: paid
        ? {
            sharingNo: `SHR${id}`,
            status: status === order_status.COMPLETED ? 'SHARED' : 'FROZEN',
            frozenAmountFen: String(original),
            companionIncomeFen: String(original - Math.round(original * 0.05)),
            // 平台服务费与费率（shared 已下沉到 ProfitSharingBriefDTO）
            platformCommissionFen: String(Math.round(original * 0.05)),
            commissionRateBp: 500,
            retryCount: 0,
            createdAt: iso(hoursLater(-25.8)),
            sharedAt: status === order_status.COMPLETED ? iso(hoursLater(-22.9)) : null,
          }
        : null,
      ...extra,
    }
  }

  return [
    make('o_1', 'O20260922001', order_status.PAID, companions[0], 1, 14, 60),
    make('o_2', 'O20260922002', order_status.ACCEPTED, companions[1], 2, 10, 90),
    make('o_3', 'O20260922003', order_status.IN_SERVICE, companions[2], 0, 9, 60, {
      verification: {
        id: 'vf_o3',
        type: 'ARRIVAL',
        status: 'PASSED',
        attemptNo: 1,
        faceScore: 92,
        facePassed: true,
        gpsDeviationM: 120,
        arrivedAt: iso(hoursLater(-1)),
        companionConfirmedAt: null,
        elderConfirmedAt: null,
        elderVoiceAsr: null,
      },
    }),
    make('o_4', 'O20260922004', order_status.PENDING_CONFIRM, companions[0], 0, 9, 120, {
      verification: {
        id: 'vf_o4',
        type: 'ARRIVAL',
        status: 'PASSED',
        attemptNo: 1,
        faceScore: 95,
        facePassed: true,
        gpsDeviationM: 85,
        arrivedAt: iso(hoursLater(-3)),
        companionConfirmedAt: iso(hoursLater(-1)),
        elderConfirmedAt: null,
        elderVoiceAsr: null,
      },
    }),
    make('o_5', 'O20260922005', order_status.COMPLETED, companions[1], -1, 15, 60, {
      verification: {
        id: 'vf_o5',
        type: 'ARRIVAL',
        status: 'PASSED',
        attemptNo: 1,
        faceScore: 90,
        facePassed: true,
        gpsDeviationM: 60,
        arrivedAt: iso(hoursLater(-26)),
        companionConfirmedAt: iso(hoursLater(-24)),
        elderConfirmedAt: iso(hoursLater(-22.9)),
        elderVoiceAsr: null,
      },
    }),
  ]
}

// ---------------------------------------------------------------------------
// 种子：IM / 营销 / 保险 / 家庭绑定
// ---------------------------------------------------------------------------

function seedIm(orders: OrderDetailView[]): (ConversationDTO & { messages: MessageDTO[] })[] {
  const convs: (ConversationDTO & { messages: MessageDTO[] })[] = []
  for (const o of orders) {
    if (!o.companion || (o.status !== order_status.ACCEPTED && o.status !== order_status.IN_SERVICE)) continue
    const msgs: MessageDTO[] = [
      {
        id: nid('im'),
        senderId: o.companion.id,
        senderRole: im_sender_role.COMPANION,
        msgType: im_message_type.TEXT,
        content: '王阿姨您好，我是明天的陪聊员小李，已接您的单，上午十点到，您方便吗？',
        status: 'NORMAL',
        reviewStatus: im_review_status.PASS,
        fileUrl: null,
        voiceDurationMs: null,
        asrText: null,
        createdAt: iso(hoursLater(-24.5)),
      },
      {
        id: nid('im'),
        senderId: 'u_elder_1',
        senderRole: im_sender_role.USER,
        msgType: im_message_type.TEXT,
        content: '方便的方便的，我在家等你。',
        status: 'NORMAL',
        reviewStatus: im_review_status.PASS,
        fileUrl: null,
        voiceDurationMs: null,
        asrText: null,
        createdAt: iso(hoursLater(-24.4)),
      },
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
        createdAt: iso(hoursLater(-24.4)),
      },
    ]
    convs.push({
      id: nid('conv'),
      orderId: o.id,
      orderNo: o.orderNo,
      peer: { ...ELDER_BRIEF, id: o.companion.id, nickname: o.companion.nickname, role: 'COMPANION' },
      unread: o.status === order_status.ACCEPTED ? 1 : 0,
      lastMessageAt: msgs[msgs.length - 1].createdAt,
      lastMessagePreview: msgs[msgs.length - 1].content,
      status: 'ACTIVE',
      messages: msgs,
    })
  }
  return convs
}

function seedDb(): MockDb {
  const companions = seedCompanions()
  const orders = seedOrders(companions)

  return {
    seq: 1000,
    companions,
    orders,
    // 老人档案：生日 1948-05-12（已满 18 岁）→ 夜间单豁免口径 A 生效
    elderProfile: { userId: 'u_elder_1', nickname: '王秀芳', birthday: '1948-05-12' },
    couponTemplates: [
      { couponNo: 'CN2026090001', name: '新客满减 ¥20', type: 'FULL_REDUCTION', value: 2000, minSpendFen: '20000', validDays: 30 },
      { couponNo: 'CN2026090002', name: '时长抵扣 30 分钟', type: 'DURATION', value: 30, minSpendFen: '0', validDays: 30 },
      { couponNo: 'CN2026090003', name: '重阳节满减 ¥50', type: 'FULL_REDUCTION', value: 5000, minSpendFen: '50000', validDays: 60 },
    ],
    giftCards: [
      {
        cardNo: 'GC20260801001',
        faceAmountFen: '50000',
        durationMinutes: 240,
        balanceAmountFen: '30000',
        balanceDurationMinutes: 120,
        status: 'ACTIVE',
        message: '女儿买给妈妈的陪伴卡',
        expiresAt: iso(daysLaterAt(60, 0)),
        boundAt: iso(hoursLater(-720)),
      },
    ],
    coupons: [
      { couponNo: 'CN2026090001', name: '新客满减 ¥20', type: 'FULL_REDUCTION', value: 2000, minSpendFen: '20000', validDays: 30, userCouponId: 'cp_1', status: 'UNUSED', source: 'MANUAL', expiredAt: iso(daysLaterAt(20, 0)), usedOrderId: null },
      { couponNo: 'CN2026090002', name: '时长抵扣 30 分钟', type: 'DURATION', value: 30, minSpendFen: '0', validDays: 30, userCouponId: 'cp_2', status: 'UNUSED', source: 'REPURCHASE', expiredAt: iso(daysLaterAt(15, 0)), usedOrderId: null },
    ],
    policies: [
      {
        policyNo: 'PL20260918001',
        orderId: 'o_3',
        insurer: '人保财险',
        productName: '平台责任险（陪伴服务）',
        coverageAmountFen: '5000000',
        premiumFen: '500',
        startAt: iso(daysLaterAt(0, 9)),
        endAt: iso(daysLaterAt(0, 10)),
        status: 'ACTIVE',
      },
    ],
    familyBindings: [
      {
        id: 'fb_1',
        familyUserId: FAMILY_BRIEF.id,
        familyUser: FAMILY_BRIEF,
        elderUserId: ELDER_BRIEF.id,
        elderUser: ELDER_BRIEF,
        relation: '母女',
        authLevel: 'PROGRESS',
        status: 'ACTIVE',
        boundAt: iso(hoursLater(-720)),
        createdAt: iso(hoursLater(-721)),
      },
    ],
    imConversations: seedIm(orders),
    aiSessions: [],
  }
}

// ---------------------------------------------------------------------------
// 持久化读写
// ---------------------------------------------------------------------------

export function getDb(): MockDb {
  const cached = storage.get<MockDb | null>(DB_KEY, null)
  if (cached && cached.companions?.length) return cached
  const fresh = seedDb()
  storage.set(DB_KEY, fresh)
  return fresh
}

export function saveDb(db: MockDb): void {
  storage.set(DB_KEY, db)
}

/** 重置演示数据（设置页「重置演示」入口，便于反复演示全链路） */
export function resetDb(): MockDb {
  const fresh = seedDb()
  storage.set(DB_KEY, fresh)
  return fresh
}
