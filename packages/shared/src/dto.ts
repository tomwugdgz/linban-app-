// ============================================================================
// 邻伴 · 共享 DTO 类型（三端 + 服务端共用）
// ----------------------------------------------------------------------------
// 铁律（schema 实现注意 a / DATABASE.md §2.1）：
//   · 金额字段一律 string（BigInt 序列化），禁止 number，杜绝浮点与精度丢失；
//   · 时间字段一律 ISO 8601 字符串（UTC 存储，展示层转 Asia/Shanghai）；
//   · ID 一律 string（BigInt 主键透传）。
//
// 脱敏纪律（架构 §5.1 数据访问三态）：
//   · R 态只读投影：companions 的 credit_score/deposit_balance_fen 等聚合列
//     端上 DTO 不得直出 —— 端上用 CompanionPublicDTO，后台用 CompanionAdminDTO；
//   · X 态受限访问：file_meta 的 objectKey 任何接口不出（仅经 STS 临时密钥）；
//     risk_events/blacklists 不对外暴露，仅进后台工作台；
//   · *_cipher 密文列任何接口不出。
// ============================================================================

import type {
  access_level,
  admin_status,
  application_stage,
  auth_level,
  code_mode,
  companion_status,
  complaint_priority,
  complaint_status,
  coupon_type,
  credit_log_type,
  deposit_tx_type,
  family_binding_status,
  file_type,
  gift_card_status,
  im_message_type,
  im_message_status,
  im_review_status,
  im_sender_role,
  notification_channel,
  notification_status,
  operator_type,
  order_status,
  payment_status,
  policy_status,
  privacy_binding_status,
  profit_sharing_status,
  reminder_type,
  report_reward_status,
  report_status,
  review_role,
  review_status,
  service_type,
  step_status,
  tx_status,
  user_coupon_source,
  user_coupon_status,
  user_role,
  user_status,
  verification_status,
  verification_type,
  withdrawal_status,
} from './enums';

// ---------------------------------------------------------------------------
// 通用结构
// ---------------------------------------------------------------------------

/** 分页查询（后台列表：page + pageSize） */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/** 分页结果 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 游标查询（IM 历史消息：cursor） */
export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

/** 游标结果 */
export interface CursorResult<T> {
  list: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 时间戳字符串（ISO 8601，UTC） */
export type IsoTime = string;
/** 金额（分，BigInt 字符串化） */
export type Fen = string;

// ---------------------------------------------------------------------------
// 账号与画像
// ---------------------------------------------------------------------------

/** 账号简卡（三端通用，脱敏：无 openid/phone_cipher） */
export interface UserBriefDTO {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  role: user_role;
  status: user_status;
}

/** 当前登录者完整资料（/auth/profile） */
export interface UserProfileDTO extends UserBriefDTO {
  phoneMasked: string | null; // 脱敏手机号 138****8888（密文不可逆出）
  createdAt: IsoTime;
  elderProfile: ElderProfileDTO | null;
  companionId: string | null; // 陪聊员主档 ID（如有）
}

/** 老人档案（R 态脱敏：interests 等 JSON 标签可用不可见；紧急联系人加密列不出） */
export interface ElderProfileDTO {
  userId: string;
  gender: string | null;
  birthday: string | null; // YYYY-MM-DD
  interests: string[] | null; // 兴趣标签（脱敏）
  preferences: Record<string, unknown> | null; // 适老设置：字号/语音/音量
  emergencyContactName: string | null; // 仅本人/授权子女可见（明文经接口层解密后出）
  emergencyContactRelation: string | null;
  hasEmergencyContactPhone: boolean; // 电话仅返回「已设置」布尔，杜绝密文/明文出参
}

/** 更新老人档案入参 */
export interface ElderProfileUpsertDTO {
  gender?: string;
  birthday?: string;
  interests?: string[];
  healthBoundaries?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

/** 家庭绑定（子女-老人） */
export interface FamilyBindingDTO {
  id: string;
  familyUserId: string;
  familyUser: UserBriefDTO | null;
  elderUserId: string;
  elderUser: UserBriefDTO | null;
  relation: string;
  authLevel: auth_level;
  status: family_binding_status;
  boundAt: IsoTime | null;
  createdAt: IsoTime;
}

// ---------------------------------------------------------------------------
// 陪聊员供给
// ---------------------------------------------------------------------------

/** 陪聊员端上卡（R 态脱敏：无 credit_score/deposit_balance_fen/实名信息） */
export interface CompanionPublicDTO {
  id: string;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  level: number;
  ratingAvg: string; // Decimal(2,1) 字符串化
  ratingCount: number;
  tags: string[] | null;
  hourlyRateFen: Fen;
  serviceRadiusM: number;
  distanceM: number | null; // 与下单地址距离（派单/浏览时计算）
  totalOrders: number;
  status: companion_status;
}

/** 陪聊员后台视图（含信用分/保证金缓存值，仅后台工作台） */
export interface CompanionAdminDTO extends CompanionPublicDTO {
  creditScore: number;
  depositBalanceFen: Fen;
  completedOrders: number;
  cancelledOrders: number;
  geoHash: string;
  createdAt: IsoTime;
}

/** 我的入驻申请状态（陪聊员端） */
export interface ApplicationStatusDTO {
  applicationNo: string;
  stage: application_stage;
  stepStatuses: {
    realname: step_status;
    face: step_status;
    criminal: step_status;
    exam: step_status;
    deposit: step_status;
  };
  examScore: number | null;
  examAttemptNo: number;
  depositAmountFen: Fen | null;
  depositPaidAt: IsoTime | null;
  rejectReason: string | null;
  submittedAt: IsoTime;
  decidedAt: IsoTime | null;
}

/** 四审工作台条目（后台） */
export interface ApplicationReviewDTO {
  applicationNo: string;
  companionId: string;
  nickname: string;
  avatarUrl: string | null;
  stage: application_stage;
  realnameStatus: step_status;
  realnameComment: string | null;
  faceStatus: step_status;
  faceScore: number | null;
  faceComment: string | null;
  criminalStatus: step_status;
  criminalComment: string | null;
  examScore: number | null;
  submittedAt: IsoTime;
}

/** 陪聊员日程 */
export interface ScheduleDTO {
  id: string;
  date: string | null; // YYYY-MM-DD（空=周期模板）
  weekday: number | null; // 0=周日…6=周六
  startTime: string; // "HH:mm"
  endTime: string;
  status: 'AVAILABLE' | 'BLACKOUT';
  note: string | null;
}

/** 信用分明细 */
export interface CreditLogDTO {
  id: string;
  changeScore: number;
  type: credit_log_type;
  beforeScore: number;
  afterScore: number;
  reason: string;
  relatedOrderId: string | null;
  createdAt: IsoTime;
}

/** 保证金流水 */
export interface DepositTxDTO {
  id: string;
  txNo: string;
  type: deposit_tx_type;
  amountFen: Fen;
  balanceAfterFen: Fen;
  status: tx_status;
  remark: string | null;
  createdAt: IsoTime;
}

// ---------------------------------------------------------------------------
// 订单与交易
// ---------------------------------------------------------------------------

/** 订单列表卡（三端通用） */
export interface OrderBriefDTO {
  id: string;
  orderNo: string;
  status: order_status;
  serviceType: service_type;
  durationMinutes: number;
  serviceDate: string; // YYYY-MM-DD（广州本地日）
  slotStart: IsoTime;
  slotEnd: IsoTime;
  totalAmountFen: Fen;
  hourlyRateFen: Fen;
  couponDeductFen: Fen;
  giftCardDeductFen: Fen;
  companion: CompanionPublicDTO | null;
  elderNickname: string | null;
  addressMasked: string | null; // 地址脱敏（区/街道级）
  distanceM: number;
  nightOrder: boolean;
  createdAt: IsoTime;
}

/** 订单详情（含时间线） */
export interface OrderDetailDTO extends OrderBriefDTO {
  user: UserBriefDTO;
  elderUser: UserBriefDTO;
  cancelInitiator: string | null;
  cancelReason: string | null;
  cancelFeeFen: Fen;
  refundAmountFen: Fen;
  dispatchedAt: IsoTime | null;
  /**
   * 夜间单是否已被子女确认。
   * 未确认时陪聊员接单会被服务端拒 14007，端上须据此置灰按钮 + 显式提示
   *「待子女确认」—— 否则陪聊员点了才报错，是典型的交互失分。
   */
  familyConfirmed: boolean;
  /** 派单倒计时截止（夜间单 30 分钟无人接单转人工，§6.1） */
  dispatchDeadlineAt: IsoTime | null;
  /**
   * 挂起原因（SOS / 服务超时 / 客服手动 / 风控）。
   * 必须透出：陪聊员服务页不知道单子为什么停了，是投诉与差评的主要来源。
   */
  suspendReason: string | null;
  acceptedAt: IsoTime | null;
  arrivedAt: IsoTime | null;
  serviceStartedAt: IsoTime | null;
  serviceEndedAt: IsoTime | null;
  completedAt: IsoTime | null;
  closedAt: IsoTime | null;
  timeline: OrderTimelineDTO[];
  verification: VerificationBriefDTO | null;
  payment: PaymentBriefDTO | null;
  sharing: ProfitSharingBriefDTO | null;
}

/** 订单状态流水（order_timeline） */
export interface OrderTimelineDTO {
  id: string;
  fromStatus: order_status | null;
  toStatus: order_status;
  action: string;
  operatorType: operator_type;
  operatorId: string | null;
  reason: string | null;
  createdAt: IsoTime;
}

/** 支付单 */
export interface PaymentBriefDTO {
  paymentNo: string;
  status: payment_status;
  amountFen: Fen;
  profitSharing: boolean;
  paidAt: IsoTime | null;
  refundAmountFen: Fen;
  refundedAt: IsoTime | null;
}

/** 分账记录（端上「待入账」视图：仅金额与状态，无微信回单号）
 *
 *  `platformCommissionFen` / `commissionRateBp` 下沉到本接口的理由（陪聊员端诉求）：
 * 陪聊员核对收入时要看「平台服务费 + 实际费率」，否则只看到到手金额必然扯皮。
 * 原先这两个字段只在后台视图 ProfitSharingAdminDTO 里，等于让陪聊员无法自证。
 * 后台视图继承本接口，故此改动对后台零影响。
 */
export interface ProfitSharingBriefDTO {
  sharingNo: string;
  status: profit_sharing_status;
  frozenAmountFen: Fen;
  companionIncomeFen: Fen;
  /** 平台服务费（分）—— 与 frozenAmountFen - companionIncomeFen 对账 */
  platformCommissionFen: Fen;
  /** 实际费率（万分比，如 500 = 5%） */
  commissionRateBp: number;
  retryCount: number;
  createdAt: IsoTime;
  sharedAt: IsoTime | null;
}

/**
 * 陪聊员分账明细（GET /payments/sharings/mine）。
 * 单号与服务时长是「认账」依据：没有单号陪聊员无法对账，没有时长无法核对金额。
 */
export interface SharingBriefForCompanionDTO extends ProfitSharingBriefDTO {
  orderNo: string;
  durationMinutes: number;
}

/** 分账记录（后台财务视图：含抽成/回单） */
export interface ProfitSharingAdminDTO extends ProfitSharingBriefDTO {
  orderNo: string;
  platformCommissionFen: Fen;
  commissionRateBp: number;
  wxTransactionId: string;
  wxSharingOrderNo: string | null;
  returnAmountFen: Fen;
  wxReturnNo: string | null;
  returnedAt: IsoTime | null;
  returnReason: string | null;
  lastError: string | null;
  manualTicketNo: string | null;
}

/** 提现单 */
export interface WithdrawalDTO {
  withdrawalNo: string;
  amountFen: Fen;
  feeFen: Fen;
  actualAmountFen: Fen;
  bankName: string;
  bankAccountMasked: string; // 银行卡脱敏
  status: withdrawal_status;
  faceVerified: boolean;
  smsVerified: boolean;
  rejectReason: string | null;
  createdAt: IsoTime;
  paidAt: IsoTime | null;
}

/** 对账批次（后台） */
export interface ReconBatchDTO {
  batchNo: string;
  batchDate: string;
  channel: string;
  localCount: number;
  localAmountFen: Fen;
  wxCount: number;
  wxAmountFen: Fen;
  matchCount: number;
  diffCount: number;
  diffAmountFen: Fen;
  status: string;
  createdAt: IsoTime;
}

// ---------------------------------------------------------------------------
// 核销与留痕
// ---------------------------------------------------------------------------

/** 核销简卡 */
export interface VerificationBriefDTO {
  id: string;
  type: verification_type;
  status: verification_status;
  attemptNo: number;
  faceScore: number | null;
  facePassed: boolean | null;
  gpsDeviationM: number | null;
  arrivedAt: IsoTime | null;
  companionConfirmedAt: IsoTime | null;
  elderConfirmedAt: IsoTime | null;
  elderVoiceAsr: string | null;
}

/** 到岗核销提交入参（人脸/GPS 经适配层，字段仅结果） */
export interface ArrivalVerifyInputDTO {
  dynamicCode: string;
  codeMode: code_mode;
  faceScore: number; // 慧眼比对分（适配层产出）
  livenessScore: number;
  faceVerifyId: string;
  gpsLat: number; // 端上原始坐标，服务端模糊化后落库
  gpsLng: number;
}

// ---------------------------------------------------------------------------
// 通信 / AI
// ---------------------------------------------------------------------------

/** IM 会话 */
export interface ConversationDTO {
  id: string;
  orderId: string;
  orderNo: string;
  peer: UserBriefDTO | null; // 对方（陪聊员视角为老人简卡，反之亦然）
  unread: number;
  lastMessageAt: IsoTime | null;
  lastMessagePreview: string | null;
  status: string;
}

/** IM 消息 */
export interface MessageDTO {
  id: string;
  senderId: string;
  senderRole: im_sender_role;
  msgType: im_message_type;
  content: string;
  status: im_message_status;
  reviewStatus: im_review_status;
  fileUrl: string | null; // 图片/语音经 STS 临时签名 URL（非 objectKey）
  voiceDurationMs: number | null;
  asrText: string | null;
  createdAt: IsoTime;
}

/** 隐私号绑定（端上只暴露虚拟号，真实号码互不可见） */
export interface PrivacyBindingDTO {
  virtualNumber: string; // 本方视角的对端虚拟号
  status: privacy_binding_status;
  expiredAt: IsoTime | null;
}

/** AI 会话 */
export interface AiSessionDTO {
  sessionNo: string;
  status: string;
  messageCount: number;
  crisisFlag: boolean;
  startedAt: IsoTime;
  lastMessageAt: IsoTime | null;
}

/** AI 单轮交互响应（ASR→LLM→TTS） */
export interface AiTurnDTO {
  sessionNo: string;
  userText: string; // ASR 原文
  assistantText: string; // LLM 回复
  audioUrl: string | null; // TTS 音频（STS 签名）
  audioDurationMs: number | null;
  emotionLabel: string | null;
  topicLabel: string | null;
  crisisFlag: boolean;
  llmProvider: string;
  llmModel: string;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// 评价 / 营销 / 保险
// ---------------------------------------------------------------------------

/** 评价 */
export interface ReviewDTO {
  id: string;
  orderId: string;
  orderNo: string;
  reviewerRole: review_role;
  rating: number;
  tags: string[] | null;
  content: string | null;
  status: review_status;
  isAnonymous: boolean;
  replyContent: string | null;
  createdAt: IsoTime;
}

/** 孝心时长卡 */
export interface GiftCardDTO {
  cardNo: string;
  faceAmountFen: Fen;
  durationMinutes: number;
  balanceAmountFen: Fen;
  balanceDurationMinutes: number;
  status: gift_card_status;
  message: string | null;
  expiresAt: IsoTime | null;
  boundAt: IsoTime | null;
}

/** 优惠券模板 */
export interface CouponDTO {
  couponNo: string;
  name: string;
  type: coupon_type;
  value: number;
  minSpendFen: Fen;
  validDays: number;
}

/** 用户券 */
export interface UserCouponDTO extends CouponDTO {
  userCouponId: string;
  status: user_coupon_status;
  source: user_coupon_source;
  expiredAt: IsoTime | null;
  usedOrderId: string | null;
}

/** 保单 */
export interface PolicyDTO {
  policyNo: string;
  orderId: string | null;
  insurer: string;
  productName: string;
  coverageAmountFen: Fen;
  premiumFen: Fen;
  startAt: IsoTime;
  endAt: IsoTime;
  status: policy_status;
}

// ---------------------------------------------------------------------------
// 风控 / 后台（仅后台工作台，X 态不对外）
// ---------------------------------------------------------------------------

/** 风控事件（后台工作台；risk_events 不对外暴露） */
export interface RiskEventAdminDTO {
  eventNo: string;
  type: string;
  level: string;
  subjectType: string;
  subjectId: string;
  orderId: string | null;
  ruleCode: string;
  status: string;
  actionTaken: string | null;
  createdAt: IsoTime;
}

/** 投诉单（后台 + 提交方可见） */
export interface ComplaintDTO {
  complaintNo: string;
  type: string;
  priority: complaint_priority;
  description: string;
  status: complaint_status;
  resultNote: string | null;
  compensationAmountFen: Fen;
  createdAt: IsoTime;
  handledAt: IsoTime | null;
}

/** 举报（飞单） */
export interface ReportDTO {
  reportNo: string;
  type: string;
  description: string;
  status: report_status;
  rewardStatus: report_reward_status;
  rewardAmountFen: Fen;
  createdAt: IsoTime;
  handledAt: IsoTime | null;
}

/** 通知记录 */
export interface NotificationLogDTO {
  id: string;
  channel: notification_channel;
  title: string | null;
  content: string;
  bizType: string | null;
  status: notification_status;
  sentAt: IsoTime | null;
  createdAt: IsoTime;
}

/** 老人提醒设置 */
export interface ReminderSettingDTO {
  id: string;
  reminderType: reminder_type;
  channel: notification_channel;
  timeOfDay: string; // "HH:mm"（UTC，展示层转 +8）
  enabled: boolean;
  contentTemplate: string | null;
}

/** 系统配置项（后台配置中心） */
export interface SystemConfigDTO {
  configKey: string;
  configValue: string;
  valueType: string;
  description: string | null;
  updatedAt: IsoTime;
}

/** 后台账号（RBAC） */
export interface AdminDTO {
  id: string;
  username: string;
  realName: string;
  roleKey: string;
  roleName: string;
  status: admin_status;
  lastLoginAt: IsoTime | null;
}

/** 文件元数据（X 态：不含 objectKey！访问经 STS 临时密钥） */
export interface FileMetaDTO {
  id: string;
  fileType: file_type;
  accessLevel: access_level;
  sizeBytes: string;
  contentType: string | null;
  sha256: string | null;
  createdAt: IsoTime;
}

/** STS 临时密钥（file 模块签发，前端直传 COS） */
export interface StsCredentialDTO {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  startTime: number;
  expiredTime: number;
  bucket: string;
  region: string;
  /** 允许上传的对象键前缀（限定范围） */
  allowKeyPrefix: string;
}
