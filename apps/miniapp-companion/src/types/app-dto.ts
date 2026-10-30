// ============================================================================
// 邻伴·陪聊员端小程序 端侧扩展 DTO
// ----------------------------------------------------------------------------
// 共享类型（枚举/错误码/常量/DTO）一律从 @linban/shared 引入（见 index.ts），
// 本文件只放「端侧视图模型」：shared 按三端通用口径定义，小程序展示需要的
// 聚合字段在这里扩展，禁止在 shared 里为单端开口子。
// ============================================================================

import type {
  ApplicationStatusDTO,
  ComplaintDTO,
  ConversationDTO,
  CreditLogDTO,
  DepositTxDTO,
  MessageDTO,
  OrderDetailDTO,
  PageResult,
  ScheduleDTO,
  UserBriefDTO,
  VerificationBriefDTO,
} from '@linban/shared'

export type { PageResult }

/**
 * 登录返回（POST /auth/wx-login、/auth/phone-login）
 * 陪聊员端与用户端同一端点，role 固定为 COMPANION。
 */
export interface CompanionLoginResult {
  accessToken: string
  refreshToken: string
  user: CompanionLoginUser
  isNewUser: boolean
}

/** 陪聊员登录态用户（脱敏简卡） */
export interface CompanionLoginUser {
  id: string
  nickname: string
  avatarUrl: string | null
  role: 'COMPANION'
  phoneMasked?: string | null
}

/**
 * 我的陪聊员主档（GET /companion/me）
 * TODO(@linban/shared)：shared 的 CompanionAdminDTO 是后台视图（含 geoHash 等），
 * 端上主档字段与后台不同（无 geoHash），此处端侧定义（待 shared 补 CompanionSelfDTO）。
 */
export interface CompanionSelfView {
  id: string
  status: string
  creditScore: number
  /** 是否被限制接单（风控/信用限制） */
  limited: boolean
  hourlyRateFen: string
  serviceRadiusM: number
  tags: string[] | null
  ratingAvg: string
  ratingCount: number
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  depositBalanceFen: string
  createdAt: string
}

/** 收入中心概览（陪聊员端聚合视图） */
export interface IncomeOverview {
  /** 可提现余额（分） */
  availableFen: string
  /** 待入账（服务中/待确认的冻结收入，分） */
  pendingFen: string
  /** 累计已入账（分） */
  totalSharedFen: string
  /** 累计提现（分） */
  totalWithdrawnFen: string
  /** 本月入账（分） */
  monthSharedFen: string
}

/** 陪聊员端订单内的分账视图（端侧扩展：补平台服务费字段） */
export interface CompanionSharingView {
  sharingNo: string
  status: string
  frozenAmountFen: string
  companionIncomeFen: string
  platformCommissionFen: string
  commissionRateBp: number
  retryCount: number
  createdAt: string
  sharedAt: string | null
  returnedAt: string | null
}

/** 提现记录（POST /payments/withdrawals） */
export interface WithdrawalView {
  withdrawalNo: string
  amountFen: string
  status: string
  bankAccountMasked: string
}

/**
 * 分账模式（GET /payments/split-mode）
 * 由服务端 system_configs.split_mode 驱动；陪聊员端与后台共用同一口径。
 * 命中 MANUAL_SETTLEMENT_FALLBACK 时，收入页必须显式提示「资金由平台人工结算」，
 * 否则陪聊员会把「迟迟不到账」当成平台跑路。
 */
export interface SplitModeView {
  /** wechat_profit_sharing | manual_settlement_fallback */
  mode: string
  /** 人工结算兜底时为 true，页面需追加人工结算说明 */
  manualSettlement: boolean
  /** 兜底模式下的预计结算时效（自然小时），可为 null */
  manualSettleHours: number | null
  /** 服务端提示文案（直接展示，不在前端拼） */
  tip: string | null
}

/**
 * 订单支付流水（GET /payments/order/:orderId 的 payment 段）
 * TODO(@linban/shared)：契约 §3.3 定义的是「支付单/退款单/分账记录查询」聚合返回，
 * shared 的 PaymentBriefDTO 未含 paymentNo 之外的支付渠道字段，端侧建模。
 */
export interface OrderPaymentView {
  paymentNo: string
  status: string
  amountFen: string
  paidAt: string | null
  refundAmountFen: string
  refundedAt: string | null
  /** 是否开启分账（false=纯退款场景） */
  profitSharing: boolean
}

/**
 * 分账明细条目（GET /payments/order/:orderId 的 sharings 段 + 订单关联）
 * TODO(@linban/shared)：shared 的 ProfitSharingBriefDTO 无 platformCommissionFen /
 * commissionRateBp（仅后台视图 ProfitSharingAdminDTO 有），陪聊员端需要在收入
 * 中心展示服务费与费率，端侧扩展（待 shared 补字段或改用 Admin 视图裁剪）。
 */
export interface SharingRecordView {
  orderId: string
  orderNo: string
  sharingNo: string
  status: string
  frozenAmountFen: string
  platformCommissionFen: string
  companionIncomeFen: string
  commissionRateBp: number
  /** 服务时长（分钟）：陪聊员核算「时薪是否被压」需要，分账表本身不存 */
  durationMinutes: number
  createdAt: string
  sharedAt: string | null
  returnedAt: string | null
}

/** 到岗核销提交入参（POST /orders/:id/arrive） */
export interface ArriveInput {
  dynamicCode: string
  codeMode: 'ELDER_SHOW' | 'COMPANION_SCAN'
  faceScore: number
  livenessScore: number
  faceVerifyId: string
  gpsLat: number
  gpsLng: number
}

/** 到岗核销结果（POST /orders/:id/arrive 返回） */
export interface ArriveResult {
  status: string
  /** 三关明细 */
  checks: {
    dynamicCodePassed: boolean
    facePassed: boolean
    gpsPassed: boolean
    gpsDeviationM: number
  }
}

/** 接单池条目（GET /orders/dispatch/pool） */
export interface DispatchPoolItem {
  id: string
  orderNo: string
  serviceDate: string
  slotStart: string
  slotEnd: string
  durationMinutes: number
  totalAmountFen: string
  distanceM: number
  nightOrder: boolean
  /** 预估陪聊员收入（抽成后，分） */
  estimateIncomeFen: string
  /** 夜间单是否已由子女确认（false=禁止接单 14007） */
  familyConfirmed: boolean
}

/**
 * 订单详情（陪聊员视角）
 *
 * shared 的 OrderDetailDTO 已补齐 familyConfirmed / dispatchDeadlineAt /
 * suspendReason（霍承钧已落shared），这三个字段夜间单三态与 SOS 挂起全靠它们，
 * 直接继承不再端侧重复定义。
 *
 * 仍需端侧扩展的只有两项：
 * - verification：改用陪聊员视角（不含动态码，红线 §7.1.4只收码不显码）；
 * - sharing：补平台服务费与费率（shared 的 ProfitSharingBriefDTO 尚无这两个字段）。
 */
export interface CompanionOrderView extends Omit<OrderDetailDTO, 'verification' | 'sharing'> {
  /** 核验记录（陪聊员端不含动态码——红线：陪聊员端只收码不显码） */
  verification?: CompanionVerificationView | null
  /** 分账记录（服务端在订单详情里挂sharing） */
  sharing?: CompanionSharingView | null
}

/** 陪聊员端核验记录（端侧扩展：不含动态码——红线：陪聊员端只收码不显码） */
export type CompanionVerificationView = VerificationBriefDTO

/** IM 会话（端侧扩展：会话 + 消息聚合） */
export interface CompanionConversation extends ConversationDTO {
  messages: MessageDTO[]
}

/** 陪聊员可见的委托人简卡（老人端脱敏口径） */
export interface CompanionElderBrief extends UserBriefDTO {
  /** 地址脱敏（区/街道级） */
  addressMasked?: string | null
}

/**
 * SOS 触发结果（POST /risk/sos）
 * 严格对齐 apps/server/src/modules/risk/risk.routes.ts 的返回体：
 *   { eventNo, level, suspended, complaintNo }
 *
 * 注意两个易混枚举：
 * - `level` 是 risk_events.level，固定 **CRITICAL**；
 *   而 `complaints.priority` 才是 URGENT（SOS 工单的优先级）。
 * - `suspended` 只在订单处于到岗态（sosSuspendable）时为 true，
 *   其余状态（如已 COMPLETED）只建风控事件+工单不挂单，页面必须分开文案。
 *
 * 服务端链路：CRITICAL 风控事件 → 到岗态立即 SUSPENDED → URGENT 投诉工单
 * → 紧急联系人模板短信 + 绑定子女 IM 通知。前端**不得**自行恢复订单。
 */
export interface SosResult {
  /** 风控事件号（客服裁决凭据，页面展示给用户报进度用） */
  eventNo: string
  /** 风险等级，SOS 固定 CRITICAL */
  level: string
  /** 订单是否真被挂起：true=已挂起，false=仅建单未挂起（如订单已结束） */
  suspended: boolean
  /** 自动生成的 URGENT 投诉工单号 */
  complaintNo: string
  /** 客服电话（SOS 后页面要能一键联系人工） */
  csPhone?: string | null
}

/**
 * 我的投诉（GET /risk/complaints/mine）
 *
 * 基于 shared 的 `ComplaintDTO`（dto.ts:594）派生，只 Omit 掉 `description`——
 * 服务端该端点（risk.routes.ts 的 `list.map`）没有返回描述字段，
 * 端上展示也用不到（描述只在提交时由本人填）。
 * 其余字段与 shared 逐一对齐，shared 补字段时这边自动跟上，不再端侧重复声明。
 */
export type MyComplaintView = Omit<ComplaintDTO, 'description'>

/**
 * 我提交的举报（本地留痕；服务端 POST /risk/reports 只回 { reportNo, status }）
 * 端上保留这份是为了让「同订单重复提交 → 20005」这个分支能真实触发与展示。
 * TODO(@linban/shared)：shared 无端侧 ReportDTO（reports 表字段见 prisma），待补。
 */
export interface MyReportView {
  reportNo: string
  orderId: string
  /** FLY_ORDER/OFF_PLATFORM_PAY/OTHER */
  type: string
  description: string
  /** PENDING/SUBSTANTIATED/UNFOUNDED */
  status: string
  createdAt: string
}
