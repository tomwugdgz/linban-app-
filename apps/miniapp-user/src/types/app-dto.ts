// ============================================================================
// 邻伴·用户端小程序 端侧扩展 DTO
// ----------------------------------------------------------------------------
// 共享类型（枚举/错误码/常量/DTO）一律从 @linban/shared 引入（见 index.ts），
// 本文件只放「端侧视图模型」：共享包按三端通用口径定义，小程序展示需要的
// 聚合字段在这里扩展，禁止在 shared 里为单端开口子。
// ============================================================================

import type {
  CompanionPublicDTO,
  ConversationDTO,
  MessageDTO,
  OrderDetailDTO,
  PageResult,
  ReviewDTO,
  ScheduleDTO,
  VerificationBriefDTO,
} from '@linban/shared'

export type { PageResult }

/**
 * IM 会话（端侧扩展）
 * TODO(@linban/shared)：shared 只有 ConversationDTO 列表视图，
 * 契约 §3.6 POST /im/conversations/order/:orderId 返回「会话 + 消息」聚合，
 * 端侧以扩展字段承载 messages（待 shared 补 ConversationDetailDTO）。
 */
export interface ConversationDetail extends ConversationDTO {
  messages: MessageDTO[]
}

/**
 * 订单详情（端侧扩展）
 *
 * shared 的 OrderDetailDTO 已含 familyConfirmed / dispatchDeadlineAt / suspendReason
 * （霍承钧已落 shared），这三个字段夜间单三态与 SOS 挂起全靠它们，
 * 直接继承、不再端侧重复声明（重复声明会造成可选/必填冲突）。
 *
 * 仍需端侧扩展的只有两项：
 * - review：契约另有 GET /reviews（我的评价），订单详情内挂一条评价；
 * - verification：老人端核验记录含动态码（陪聊员端才需要屏蔽）。
 */
export interface OrderDetailView extends Omit<OrderDetailDTO, 'verification'> {
  review?: ReviewDTO | null
  verification?: OrderVerificationView | null
}

/**
 * 订单核验记录（端侧扩展）
 * 契约 §3.4：GET /verifications/order/:orderId 返回三关核验记录；
 * 红线 §7.1.4：动态码仅老人端展示 —— shared 的 VerificationBriefDTO
 * 暂无 dynamicCode/codeExpiresAt 字段，此处端侧扩展（待 shared 补字段）。
 */
export interface OrderVerificationView extends VerificationBriefDTO {
  dynamicCode?: string
  codeExpiresAt?: string
}

/** 登录返回（POST /auth/wx-login、/auth/phone-login） */
export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: LoginUser
  isNewUser: boolean
}

/** 登录态用户（脱敏简卡 + 令牌） */
export interface LoginUser {
  id: string
  nickname: string
  avatarUrl: string | null
  role: 'ELDER' | 'FAMILY' | 'COMPANION'
  phoneMasked?: string | null
}

/** 陪聊员详情（公开卡 + 端侧聚合：简介/可约时段/评价） */
export interface CompanionDetail extends CompanionPublicDTO {
  intro: string
  languages: string[]
  slots: ScheduleSlot[]
  reviews: ReviewDTO[]
}

/** 可约时段（按天分组，slots 为 "HH:mm" 列表） */
export interface ScheduleSlot {
  date: string
  weekday: number
  slots: string[]
}

/** 我的资料（GET /users/me/profile） */
export interface MyProfile {
  user: LoginUser
  elderProfile: ElderProfileView | null
}

/** 老人档案端侧视图（ElderProfileDTO 的展示裁剪） */
export interface ElderProfileView {
  userId: string
  nickname: string
  gender: string | null
  birthday: string | null
  interests: string[]
  preferences: { fontScale: number; voiceFirst: boolean }
  emergencyContactName: string | null
  emergencyContactRelation: string | null
  hasEmergencyContactPhone: boolean
}

/** 下单请求（POST /orders） */
export interface CreateOrderRequest {
  companionId: string
  durationMinutes: number
  serviceDate: string
  slotStart: string
  /** 子女代下单时传老人 userId */
  elderUserId?: string
  /** 时长卡卡号（GiftCardDTO.cardNo） */
  giftCardNo?: string
  /** 用户券 ID（UserCouponDTO.userCouponId） */
  userCouponId?: string
  address: string
  remark?: string
  /** 服务边界确认书版本（架构 §10.3 存证） */
  boundaryAgreementVersion: string
}

/** 微信支付参数（POST /payments/prepay → wx.requestPayment） */
export interface PaymentPrepayDTO {
  paymentNo: string
  timeStamp: string
  nonceStr: string
  packageValue: string
  signType: 'RSA' | 'MD5'
  paySign: string
}

/** 计价预览（架构 §7.2：时长×时薪 − 优惠券 − 时长卡；抽成=实收×5%） */
export interface PriceQuote {
  durationMinutes: number
  hourlyRateFen: string
  originalAmountFen: string
  couponDeductFen: string
  giftCardDeductFen: string
  totalAmountFen: string
  platformCommissionFen: string
  companionIncomeFen: string
}

/** 风控上报入参（SOS/举报/投诉） */
export interface RiskReportRequest {
  type: 'SOS' | 'REPORT' | 'COMPLAINT'
  orderId?: string
  targetId?: string
  reason: string
}

/** AI 会话消息（端侧聚合：共享 AiSessionDTO 为列表视图，消息由 turn 增量累积） */
export interface AiChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  asrText?: string
  audioDurationMs?: number
  createdAt: string
}
