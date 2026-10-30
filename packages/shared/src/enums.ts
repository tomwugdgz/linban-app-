// ============================================================================
// 邻伴 · 三端共享状态枚举（与 apps/server/prisma/schema.prisma 逐字一致）
// ----------------------------------------------------------------------------
// 本文件是 schema.prisma 52 个枚举在「无 Prisma 依赖」端（两个 Taro 小程序 /
// admin-web / server 领域层）的唯一镜像。命名、值、注释均与 schema 对应，
// 修改必须双向同步（schema 为可执行单一事实源）。
//
// 约定：
//   1. 枚举值为 UPPER_SNAKE 字符串，与 schema 落库值完全一致；
//   2. 每个枚举同时导出 values 数组（供 zod / 校验 / 单测遍历）；
//   3. 领域层状态机（domain/）与 UI 均只允许引用本文件，禁止另立常量。
// ============================================================================

// ---------------------------------------------------------------------------
// 账号域
// ---------------------------------------------------------------------------

/// 三端账号角色：老人 / 子女（代操作）/ 陪聊员；后台角色走 admins-roles RBAC
/// SYSTEM = 系统服务账号（schema 主理人裁定 A2，2026-10）：仅供系统自动流程引用
///   （健康告警 escalate 落 complaints 的 complainant_id 必填 FK，无真人发起方）。
///   约束：不可登录、不得被业务接口选为操作人、不计入任何用户/陪聊员统计口径。
export const user_role = {
  ELDER: 'ELDER',
  FAMILY: 'FAMILY',
  COMPANION: 'COMPANION',
  SYSTEM: 'SYSTEM', // 系统服务账号（A2）：仅系统流程引用，不可登录
} as const;
export type user_role = (typeof user_role)[keyof typeof user_role];
export const user_role_values = Object.values(user_role);

/// 账号状态：CANCELLED = 注销冷静期及以后（到期匿名化）
export const user_status = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  CANCELLED: 'CANCELLED',
} as const;
export type user_status = (typeof user_status)[keyof typeof user_status];
export const user_status_values = Object.values(user_status);

/// 子女授权范围（架构 §10.1：基础 / 服务进度 / 全部）
export const auth_level = {
  BASIC: 'BASIC',
  PROGRESS: 'PROGRESS',
  FULL: 'FULL',
} as const;
export type auth_level = (typeof auth_level)[keyof typeof auth_level];
export const auth_level_values = Object.values(auth_level);

/// 家庭绑定状态
export const family_binding_status = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
} as const;
export type family_binding_status = (typeof family_binding_status)[keyof typeof family_binding_status];
export const family_binding_status_values = Object.values(family_binding_status);

// ---------------------------------------------------------------------------
// 订单域（12 态状态机，架构 §6.5，禁止增删）
// ---------------------------------------------------------------------------

/// 订单状态机（架构 §6.5，12 态，禁止增删）
export const order_status = {
  CREATED: 'CREATED', // 下单锁时段，15min 支付超时
  PAID: 'PAID', // 支付成功，待分账冻结
  DISPATCHED: 'DISPATCHED', // 派单引擎 TopN 推送
  ACCEPTED: 'ACCEPTED', // 陪聊员接单
  ARRIVED: 'ARRIVED', // 到岗核销通过
  IN_SERVICE: 'IN_SERVICE', // 服务中
  PENDING_CONFIRM: 'PENDING_CONFIRM', // 服务结束待双方确认
  COMPLETED: 'COMPLETED', // 双方确认完成（触发分账）
  SUSPENDED: 'SUSPENDED', // 异常/投诉挂起（客服裁决）
  CANCELLED: 'CANCELLED', // 取消（未服务或违约取消）
  CLOSED: 'CLOSED', // 评价完成/超时关闭
  REFUNDED: 'REFUNDED', // 已退款（分账回退完成）
} as const;
export type order_status = (typeof order_status)[keyof typeof order_status];
export const order_status_values = Object.values(order_status);

/// 服务类型（MVP 以 CHAT 为主；ACCOMPANY 预留）
export const service_type = {
  CHAT: 'CHAT',
  ACCOMPANY: 'ACCOMPANY',
} as const;
export type service_type = (typeof service_type)[keyof typeof service_type];
export const service_type_values = Object.values(service_type);

/// 取消发起方
export const cancel_initiator = {
  USER: 'USER',
  COMPANION: 'COMPANION',
  PLATFORM: 'PLATFORM',
  TIMEOUT: 'TIMEOUT',
} as const;
export type cancel_initiator = (typeof cancel_initiator)[keyof typeof cancel_initiator];
export const cancel_initiator_values = Object.values(cancel_initiator);

/// 操作者类型（服务动作留痕）
export const operator_type = {
  USER: 'USER',
  COMPANION: 'COMPANION',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;
export type operator_type = (typeof operator_type)[keyof typeof operator_type];
export const operator_type_values = Object.values(operator_type);

// ---------------------------------------------------------------------------
// 支付与分账域（架构 §7 核心）
// ---------------------------------------------------------------------------

/// 支付单状态（对齐微信交易状态语义）
export const payment_status = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
  FAILED: 'FAILED',
} as const;
export type payment_status = (typeof payment_status)[keyof typeof payment_status];
export const payment_status_values = Object.values(payment_status);

/// 分账记录三态（架构 §5.1/§7：冻结 → 已分账 / 已回退）
export const profit_sharing_status = {
  FROZEN: 'FROZEN', // 待分账冻结（付款即冻，陪聊员可见不可取）
  SHARED: 'SHARED', // 已分账（平台留成 + 陪聊员直达）
  RETURNED: 'RETURNED', // 已回退（解冻/回退用户）
} as const;
export type profit_sharing_status = (typeof profit_sharing_status)[keyof typeof profit_sharing_status];
export const profit_sharing_status_values = Object.values(profit_sharing_status);

/// 提现单状态（备选结算模式使用；默认分账直达模式下低频）
export const withdrawal_status = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type withdrawal_status = (typeof withdrawal_status)[keyof typeof withdrawal_status];
export const withdrawal_status_values = Object.values(withdrawal_status);

/// 对账渠道
export const recon_channel = {
  WX_PAY: 'WX_PAY',
  WX_SHARING: 'WX_SHARING',
  WX_REFUND: 'WX_REFUND',
  WX_WITHDRAW: 'WX_WITHDRAW',
} as const;
export type recon_channel = (typeof recon_channel)[keyof typeof recon_channel];
export const recon_channel_values = Object.values(recon_channel);

/// 对账批次状态
export const recon_status = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  MATCHED: 'MATCHED',
  DIFF: 'DIFF',
  RESOLVED: 'RESOLVED',
} as const;
export type recon_status = (typeof recon_status)[keyof typeof recon_status];
export const recon_status_values = Object.values(recon_status);

// ---------------------------------------------------------------------------
// 陪聊员供给域（四审流 10 态，架构 §6.6，禁止增删）
// ---------------------------------------------------------------------------

/// 陪聊员四审流阶段（架构 §6.6，10 态，禁止增删）
export const application_stage = {
  APPLIED: 'APPLIED', // 注册申请
  REALNAME_OK: 'REALNAME_OK', // ①实名通过
  FACE_OK: 'FACE_OK', // ②人脸通过
  CRIMINAL_OK: 'CRIMINAL_OK', // ③无犯罪记录通过
  TRAINING: 'TRAINING', // 培训中
  EXAM_OK: 'EXAM_OK', // 考试通过（≥80 分）
  DEPOSIT_OK: 'DEPOSIT_OK', // ④保证金缴纳完成
  ACTIVE: 'ACTIVE', // 四审通过，上架接单
  SUSPENDED: 'SUSPENDED', // 暂停接单
  BANNED: 'BANNED', // 黑名单清退
} as const;
export type application_stage = (typeof application_stage)[keyof typeof application_stage];
export const application_stage_values = Object.values(application_stage);

/// 四审单步审核结果
export const step_status = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  REJECTED: 'REJECTED',
} as const;
export type step_status = (typeof step_status)[keyof typeof step_status];
export const step_status_values = Object.values(step_status);

/// 陪聊员主档状态（与 §6.6 的 ACTIVE/SUSPENDED/BANNED 对齐；
/// PENDING=审核中未上架；RETIRED=正常退出，保证金 30 天无纠纷原路退）
export const companion_status = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BANNED: 'BANNED',
  RETIRED: 'RETIRED',
} as const;
export type companion_status = (typeof companion_status)[keyof typeof companion_status];
export const companion_status_values = Object.values(companion_status);

/// 保证金流水类型
export const deposit_tx_type = {
  IN: 'IN', // 缴纳
  OUT: 'OUT', // 退出退还
  PENALTY: 'PENALTY', // 罚扣
} as const;
export type deposit_tx_type = (typeof deposit_tx_type)[keyof typeof deposit_tx_type];
export const deposit_tx_type_values = Object.values(deposit_tx_type);

/// 保证金流水状态
export const tx_status = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type tx_status = (typeof tx_status)[keyof typeof tx_status];
export const tx_status_values = Object.values(tx_status);

/// 信用分明细事由（规则数值见架构 §8.3，进 domain 层）
export const credit_log_type = {
  GOOD_REVIEW: 'GOOD_REVIEW',
  BAD_REVIEW: 'BAD_REVIEW',
  CANCEL: 'CANCEL',
  IM_VIOLATION: 'IM_VIOLATION',
  FLY_ORDER: 'FLY_ORDER',
  MANUAL: 'MANUAL',
  SYSTEM: 'SYSTEM',
} as const;
export type credit_log_type = (typeof credit_log_type)[keyof typeof credit_log_type];
export const credit_log_type_values = Object.values(credit_log_type);

/// 日程状态：可约 / 拉黑（停接）
export const schedule_status = {
  AVAILABLE: 'AVAILABLE',
  BLACKOUT: 'BLACKOUT',
} as const;
export type schedule_status = (typeof schedule_status)[keyof typeof schedule_status];
export const schedule_status_values = Object.values(schedule_status);

// ---------------------------------------------------------------------------
// 核销与留痕域
// ---------------------------------------------------------------------------

/// 核销类型：到岗核销 / 完成确认（双方确认）
export const verification_type = {
  ARRIVAL: 'ARRIVAL',
  COMPLETION: 'COMPLETION',
} as const;
export type verification_type = (typeof verification_type)[keyof typeof verification_type];
export const verification_type_values = Object.values(verification_type);

/// 核销记录状态
export const verification_status = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type verification_status = (typeof verification_status)[keyof typeof verification_status];
export const verification_status_values = Object.values(verification_status);

/// 动态码出示方式：老人出示 / 陪聊员扫码
export const code_mode = {
  ELDER_SHOW: 'ELDER_SHOW',
  COMPANION_SCAN: 'COMPANION_SCAN',
} as const;
export type code_mode = (typeof code_mode)[keyof typeof code_mode];
export const code_mode_values = Object.values(code_mode);

// ---------------------------------------------------------------------------
// 通信域（IM / 隐私号）
// ---------------------------------------------------------------------------

/// IM 消息类型
export const im_message_type = {
  TEXT: 'TEXT',
  IMAGE: 'IMAGE',
  VOICE: 'VOICE',
  SYSTEM: 'SYSTEM',
} as const;
export type im_message_type = (typeof im_message_type)[keyof typeof im_message_type];
export const im_message_type_values = Object.values(im_message_type);

/// IM 消息状态：撤回 / 被拦截（风控命中）
export const im_message_status = {
  NORMAL: 'NORMAL',
  REVOKED: 'REVOKED',
  BLOCKED: 'BLOCKED',
} as const;
export type im_message_status = (typeof im_message_status)[keyof typeof im_message_status];
export const im_message_status_values = Object.values(im_message_status);

/// IM 内容审核状态（微信 msgSecCheck/imgSecCheck + 人工）
export const im_review_status = {
  PENDING: 'PENDING',
  PASS: 'PASS',
  REJECT: 'REJECT',
} as const;
export type im_review_status = (typeof im_review_status)[keyof typeof im_review_status];
export const im_review_status_values = Object.values(im_review_status);

/// IM 发送方角色
export const im_sender_role = {
  USER: 'USER',
  COMPANION: 'COMPANION',
  SYSTEM: 'SYSTEM',
} as const;
export type im_sender_role = (typeof im_sender_role)[keyof typeof im_sender_role];
export const im_sender_role_values = Object.values(im_sender_role);

/// 隐私号绑定状态
export const privacy_binding_status = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  UNBOUND: 'UNBOUND',
} as const;
export type privacy_binding_status = (typeof privacy_binding_status)[keyof typeof privacy_binding_status];
export const privacy_binding_status_values = Object.values(privacy_binding_status);

// ---------------------------------------------------------------------------
// AI 域
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 评价域
// ---------------------------------------------------------------------------

/// 双向评价：reviewer_role=USER 时 reviewee 为陪聊员账号；
/// =COMPANION 时 reviewee 为老人账号
export const review_role = {
  USER: 'USER',
  COMPANION: 'COMPANION',
} as const;
export type review_role = (typeof review_role)[keyof typeof review_role];
export const review_role_values = Object.values(review_role);

/// 评价审核状态
export const review_status = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  HIDDEN: 'HIDDEN',
} as const;
export type review_status = (typeof review_status)[keyof typeof review_status];
export const review_status_values = Object.values(review_status);

// ---------------------------------------------------------------------------
// 营销域
// ---------------------------------------------------------------------------

/// 孝心时长卡状态
export const gift_card_status = {
  ACTIVE: 'ACTIVE',
  USED: 'USED',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
} as const;
export type gift_card_status = (typeof gift_card_status)[keyof typeof gift_card_status];
export const gift_card_status_values = Object.values(gift_card_status);

/// 券类型：满减券 / 时长抵扣券
export const coupon_type = {
  FULL_REDUCTION: 'FULL_REDUCTION',
  DURATION: 'DURATION',
} as const;
export type coupon_type = (typeof coupon_type)[keyof typeof coupon_type];
export const coupon_type_values = Object.values(coupon_type);

/// 用户券状态
export const user_coupon_status = {
  UNUSED: 'UNUSED',
  USED: 'USED',
  EXPIRED: 'EXPIRED',
} as const;
export type user_coupon_status = (typeof user_coupon_status)[keyof typeof user_coupon_status];
export const user_coupon_status_values = Object.values(user_coupon_status);

/// 用户券来源
export const user_coupon_source = {
  REPURCHASE: 'REPURCHASE', // 复购发放
  REPORT_REWARD: 'REPORT_REWARD', // 举报奖励
  COMPLAINT: 'COMPLAINT', // 投诉补偿
  INVITE: 'INVITE', // 老带新
  ACTIVITY_LEAD: 'ACTIVITY_LEAD', // 健康活动感知·新装引流（裁定③，触达即发）
  MANUAL: 'MANUAL', // 后台手动
} as const;
export type user_coupon_source = (typeof user_coupon_source)[keyof typeof user_coupon_source];
export const user_coupon_source_values = Object.values(user_coupon_source);

/// 佣金流水类型
export const commission_type = {
  ORDER_COMMISSION: 'ORDER_COMMISSION', // 订单分销佣金
  INVITE_REWARD: 'INVITE_REWARD', // 拉新奖励
} as const;
export type commission_type = (typeof commission_type)[keyof typeof commission_type];
export const commission_type_values = Object.values(commission_type);

/// 佣金流水状态
export const commission_status = {
  PENDING: 'PENDING', // 待结算
  SETTLED: 'SETTLED', // 已结算
  PAID: 'PAID', // 已打款
  CANCELLED: 'CANCELLED', // 已取消（订单退款联动）
} as const;
export type commission_status = (typeof commission_status)[keyof typeof commission_status];
export const commission_status_values = Object.values(commission_status);

// ---------------------------------------------------------------------------
// 保险域
// ---------------------------------------------------------------------------

/// 保单状态（MVP 半自动登记）
export const policy_status = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CLAIMING: 'CLAIMING',
  CLAIMED: 'CLAIMED',
  CANCELLED: 'CANCELLED',
} as const;
export type policy_status = (typeof policy_status)[keyof typeof policy_status];
export const policy_status_values = Object.values(policy_status);

// ---------------------------------------------------------------------------
// 风控与后台域
// ---------------------------------------------------------------------------

/// 风控事件等级
export const risk_level = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type risk_level = (typeof risk_level)[keyof typeof risk_level];
export const risk_level_values = Object.values(risk_level);

/// 风控事件处置状态
export const risk_event_status = {
  PENDING: 'PENDING', // 待人工
  PROCESSING: 'PROCESSING', // 处理中
  RESOLVED: 'RESOLVED', // 已处置
  FALSE_POSITIVE: 'FALSE_POSITIVE', // 误报
} as const;
export type risk_event_status = (typeof risk_event_status)[keyof typeof risk_event_status];
export const risk_event_status_values = Object.values(risk_event_status);

/// 投诉优先级
export const complaint_priority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type complaint_priority = (typeof complaint_priority)[keyof typeof complaint_priority];
export const complaint_priority_values = Object.values(complaint_priority);

/// 投诉状态
export const complaint_status = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  RESOLVED: 'RESOLVED',
  REJECTED: 'REJECTED',
} as const;
export type complaint_status = (typeof complaint_status)[keyof typeof complaint_status];
export const complaint_status_values = Object.values(complaint_status);

/// 举报（飞单）状态
export const report_status = {
  PENDING: 'PENDING', // 待核查
  SUBSTANTIATED: 'SUBSTANTIATED', // 属实
  UNFOUNDED: 'UNFOUNDED', // 不属实
} as const;
export type report_status = (typeof report_status)[keyof typeof report_status];
export const report_status_values = Object.values(report_status);

/// 举报奖励发放状态
export const report_reward_status = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  PAID: 'PAID',
} as const;
export type report_reward_status = (typeof report_reward_status)[keyof typeof report_reward_status];
export const report_reward_status_values = Object.values(report_reward_status);

/// 黑名单对象类型
export const blacklist_target_type = {
  USER: 'USER',
  COMPANION: 'COMPANION',
  DEVICE: 'DEVICE',
} as const;
export type blacklist_target_type = (typeof blacklist_target_type)[keyof typeof blacklist_target_type];
export const blacklist_target_type_values = Object.values(blacklist_target_type);

/// 黑名单作用范围
export const blacklist_scope = {
  ORDER: 'ORDER',
  IM: 'IM',
  LOGIN: 'LOGIN',
  PLATFORM: 'PLATFORM',
} as const;
export type blacklist_scope = (typeof blacklist_scope)[keyof typeof blacklist_scope];
export const blacklist_scope_values = Object.values(blacklist_scope);

/// 黑名单状态
export const blacklist_status = {
  ACTIVE: 'ACTIVE',
  LIFTED: 'LIFTED',
} as const;
export type blacklist_status = (typeof blacklist_status)[keyof typeof blacklist_status];
export const blacklist_status_values = Object.values(blacklist_status);

/// 后台账号状态
export const admin_status = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
} as const;
export type admin_status = (typeof admin_status)[keyof typeof admin_status];
export const admin_status_values = Object.values(admin_status);

// ---------------------------------------------------------------------------
// 通知 / 文件域
// ---------------------------------------------------------------------------

/// 通知渠道
export const notification_channel = {
  SUBSCRIBE_MESSAGE: 'SUBSCRIBE_MESSAGE', // 微信订阅消息
  SMS: 'SMS', // 短信
  IM_SYSTEM: 'IM_SYSTEM', // IM 系统消息
} as const;
export type notification_channel = (typeof notification_channel)[keyof typeof notification_channel];
export const notification_channel_values = Object.values(notification_channel);

/// 通知发送状态
export const notification_status = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;
export type notification_status = (typeof notification_status)[keyof typeof notification_status];
export const notification_status_values = Object.values(notification_status);

/// 提醒类型（健康/用药仅中性文字提醒，禁医疗断言）
export const reminder_type = {
  BIRTHDAY: 'BIRTHDAY',
  HEALTH: 'HEALTH',
  NEUTRAL: 'NEUTRAL',
} as const;
export type reminder_type = (typeof reminder_type)[keyof typeof reminder_type];
export const reminder_type_values = Object.values(reminder_type);

/// 敏感数据分级（架构 §5.3）
export const access_level = {
  L1: 'L1', // 公开
  L2: 'L2', // 内部
  L3: 'L3', // 敏感（加密）
  L4: 'L4', // 极敏感（加密 + KMS + 访问审计）
} as const;
export type access_level = (typeof access_level)[keyof typeof access_level];
export const access_level_values = Object.values(access_level);

/// 文件类型（COS 对象分类，内容不落库，仅存 objectKey）
export const file_type = {
  FACE_PHOTO: 'FACE_PHOTO', // 人脸签到照
  LIVENESS_VIDEO: 'LIVENESS_VIDEO', // 活体视频
  ID_CARD_FRONT: 'ID_CARD_FRONT', // 身份证人像面
  ID_CARD_BACK: 'ID_CARD_BACK', // 身份证国徽面
  CRIMINAL_CERT: 'CRIMINAL_CERT', // 无犯罪记录证明
  TRAINING_MATERIAL: 'TRAINING_MATERIAL', // 培训材料
  SERVICE_LOG: 'SERVICE_LOG', // 服务日志
  SOS_RECORD: 'SOS_RECORD', // SOS 记录
  COMPLAINT_EVIDENCE: 'COMPLAINT_EVIDENCE', // 投诉证据
  REPORT_EVIDENCE: 'REPORT_EVIDENCE', // 举报证据
  VOICE_NOTE: 'VOICE_NOTE', // 语音留言
  OTHER: 'OTHER',
} as const;
export type file_type = (typeof file_type)[keyof typeof file_type];
export const file_type_values = Object.values(file_type);

// ============================================================================
// 健康活动感知模块（架构 §13 / PRD MODULE-ACTIVITY-SENSE.md，2026-10）
// 与 prisma schema 逐字一致；枚举值不得在业务代码中另造同义串。
// ============================================================================

/// 感知通道（§13.3 双通道统一归一；通道B 为 W+1 硬件，MVP 仅留协议位）
export const activity_channel = {
  CHANNEL_A_APP: 'CHANNEL_A_APP', // 通道A：APP Wi-Fi 状态心跳（零硬件，W-MVP）
  CHANNEL_B_GATEWAY: 'CHANNEL_B_GATEWAY', // 通道B：网关特征（硬件，W+1；原始波形不出户）
} as const;
export type activity_channel = (typeof activity_channel)[keyof typeof activity_channel];
export const activity_channel_values = Object.values(activity_channel);

/// 活动状态五级分级（PRD §3：必须带置信度与新鲜度，禁止「假装确定」）
export const activity_status = {
  ACTIVE: 'ACTIVE', // 活跃
  LOW: 'LOW', // 低活跃
  STILL: 'STILL', // 久静
  AWAY: 'AWAY', // 外出或离线
  UNKNOWN: 'UNKNOWN', // 数据不足/过期 → 回落，禁止猜测
} as const;
export type activity_status = (typeof activity_status)[keyof typeof activity_status];
export const activity_status_values = Object.values(activity_status);

/// 感知设备类型
export const wifi_device_type = {
  APP_PROBE: 'APP_PROBE', // 老人端 App 探针
  GATEWAY: 'GATEWAY', // Wi-Fi 网关（W+1）
} as const;
export type wifi_device_type = (typeof wifi_device_type)[keyof typeof wifi_device_type];
export const wifi_device_type_values = Object.values(wifi_device_type);

/// 感知设备状态
export const wifi_device_status = {
  PENDING: 'PENDING', // 待绑定/待首次心跳
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  UNBOUND: 'UNBOUND', // 已解绑
  REVOKED: 'REVOKED', // 老人撤销授权（PRD 红线⑦）
} as const;
export type wifi_device_status = (typeof wifi_device_status)[keyof typeof wifi_device_status];
export const wifi_device_status_values = Object.values(wifi_device_status);

/// 感知授权状态（PRD 红线④：老人本人授权）
export const activity_consent_status = {
  PENDING: 'PENDING', // 待老人确认
  GRANTED: 'GRANTED',
  REVOKED: 'REVOKED', // 一键关闭：立即停采 + 删除未聚合数据
  EXPIRED: 'EXPIRED', // 授权到期（策略版本或期限）
} as const;
export type activity_consent_status = (typeof activity_consent_status)[keyof typeof activity_consent_status];
export const activity_consent_status_values = Object.values(activity_consent_status);

/// 子女可见范围档位（PRD 红线④第二层 + 老人可查「谁在看我」；默认不做实时轨迹回放）
export const activity_consent_scope_level = {
  NONE: 'NONE', // 不可见
  DAILY_SUMMARY: 'DAILY_SUMMARY', // 仅活动日报
  ALERT_ONLY: 'ALERT_ONLY', // 仅告警
  TREND: 'TREND', // 日/周趋势 + 告警（子女看板默认档）
} as const;
export type activity_consent_scope_level = (typeof activity_consent_scope_level)[keyof typeof activity_consent_scope_level];
export const activity_consent_scope_level_values = Object.values(activity_consent_scope_level);

/// 撤销后未聚合数据清理确认态（PRD 红线⑦ + 主理人裁定④）
/// CONFIRMED 必须伴随 consents.unaggregated_purged_at 有值，二者不可分离
export const activity_purge_status = {
  NOT_STARTED: 'NOT_STARTED', // 未开始清理
  RUNNING: 'RUNNING', // 清理中（sweep 执行中）
  CONFIRMED: 'CONFIRMED', // 清理完成且已确认
  FAILED: 'FAILED', // 清理失败（purge_error 有值，待重试）
} as const;
export type activity_purge_status = (typeof activity_purge_status)[keyof typeof activity_purge_status];
export const activity_purge_status_values = Object.values(activity_purge_status);

/// 健康告警类型（PRD §8 风险表 + §3 统一模型第三层）
export const health_alert_type = {
  STILL_TOO_LONG: 'STILL_TOO_LONG', // 久静超阈
  FALL_SUSPECT: 'FALL_SUSPECT', // 跌倒疑似（通道B，W+1）
  DEVICE_OFFLINE: 'DEVICE_OFFLINE', // 设备离线超阈
  NOCTURNAL_ACTIVITY: 'NOCTURNAL_ACTIVITY', // 夜间异常活跃
  LOW_TREND: 'LOW_TREND', // 活跃下降趋势（引流触发器①）
  RESPIRATORY_TREND: 'RESPIRATORY_TREND', // 无创呼吸趋势（W+2，参考指标）
} as const;
export type health_alert_type = (typeof health_alert_type)[keyof typeof health_alert_type];
export const health_alert_type_values = Object.values(health_alert_type);

/// 告警级别（PRD §8：告警疲劳 → 分级 + 人工确认后才升级）
export const health_alert_level = {
  REMIND: 'REMIND', // 提醒：看板提示，不打扰
  WARN: 'WARN', // 预警：推送 + 推荐位，无工单
  URGENT: 'URGENT', // 紧急：客服外呼 → 紧急联系人/社区（与 SOS 同出口）
} as const;
export type health_alert_level = (typeof health_alert_level)[keyof typeof health_alert_level];
export const health_alert_level_values = Object.values(health_alert_level);

/// 告警状态（§13.5：health_alerts 自身状态流自闭环，默认不落 complaints）
export const health_alert_status = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  PROCESSING: 'PROCESSING',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED', // 误报
  ESCALATED: 'ESCALATED', // 人工确认后升级
} as const;
export type health_alert_status = (typeof health_alert_status)[keyof typeof health_alert_status];
export const health_alert_status_values = Object.values(health_alert_status);

/// 引流漏斗事件（PRD §4：装机→激活→数据可用→告警→首单→复购）
export const activity_touchpoint_type = {
  INSTALL: 'INSTALL',
  ACTIVATION: 'ACTIVATION',
  CONSENT_GRANTED: 'CONSENT_GRANTED',
  DATA_AVAILABLE: 'DATA_AVAILABLE',
  ALERT_RAISED: 'ALERT_RAISED',
  FIRST_ORDER: 'FIRST_ORDER',
  REORDER: 'REORDER',
} as const;
export type activity_touchpoint_type = (typeof activity_touchpoint_type)[keyof typeof activity_touchpoint_type];
export const activity_touchpoint_type_values = Object.values(activity_touchpoint_type);

/// 触达通道（activity_touchpoints.touch_channel；漏斗触点的「怎么触达」维度）
/// 与 activity_touchpoint_type（触点「是什么」阶段）正交，两个维度都要归因才闭环 ROI。
/// MEDIA_* 两项是亲邻社区媒体位——本模块的获客优势来自线下触点，故留独立码。
export const activity_touch_channel = {
  PUSH: 'PUSH', // 微信订阅消息推送
  SMS: 'SMS', // 短信
  IM: 'IM', // 站内 IM
  MEDIA_SCREEN: 'MEDIA_SCREEN', // 亲邻社区媒体：门禁广告屏
  MEDIA_STICKER: 'MEDIA_STICKER', // 亲邻社区媒体：单元门贴纸
  DISTRIBUTOR: 'DISTRIBUTOR', // 社区团长地推
  OPENING_APP: 'OPENING_APP', // 亲邻开门 App 跳转小程序
} as const;
export type activity_touch_channel = (typeof activity_touch_channel)[keyof typeof activity_touch_channel];
export const activity_touch_channel_values = Object.values(activity_touch_channel);

/// 感知订阅档位（PRD §5；订阅收入科目隔离，不进陪聊分账池）
export const activity_subscription_tier = {
  FREE: 'FREE',
  PRO: 'PRO', // ¥49/月 = 4900 分
  INSTITUTIONAL: 'INSTITUTIONAL', // 机构定制
} as const;
export type activity_subscription_tier = (typeof activity_subscription_tier)[keyof typeof activity_subscription_tier];
export const activity_subscription_tier_values = Object.values(activity_subscription_tier);

/// 感知订阅状态
export const activity_subscription_status = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type activity_subscription_status = (typeof activity_subscription_status)[keyof typeof activity_subscription_status];
export const activity_subscription_status_values = Object.values(activity_subscription_status);

/// 感知订阅价格常量（分；PRD §5 硬编码口径单一事实源）
export const ACTIVITY_SUBSCRIPTION_PRO_PRICE_FEN = 4900; // ¥49/月
/// 新装体验期天数（PRD §4 触发器③：前 7 天免费体验）
export const ACTIVITY_TRIAL_DAYS = 7;

/// 派单活动加成原因码（Q10 定稿：加分数口径，落 orders.dispatch_reason_code）
/// 注意：这是**纯 TS 枚举**，schema 侧对应列是 VarChar(32) 字符串而非 Prisma enum，
/// 因此不出现在 schema 的 65 个 enum 里，但取值必须与本定义逐字一致。
/// 复用到服务端领域层时统一从本文件引入（domain/activity.ts 已改为再导出），
/// 禁止在业务代码中另造同义串。
export const activity_bonus_reason = {
  NONE: 'NONE', // 无加成（ACTIVE / AWAY / UNKNOWN / 半径外候选）
  ACTIVITY_LOW: 'ACTIVITY_LOW', // 低活跃 +activity_dispatch_bonus_low（默认 5）
  ACTIVITY_STILL: 'ACTIVITY_STILL', // 久静 +activity_dispatch_bonus_still（默认 10）
} as const;
export type activity_bonus_reason = (typeof activity_bonus_reason)[keyof typeof activity_bonus_reason];
export const activity_bonus_reason_values = Object.values(activity_bonus_reason);

/// 派单展示分硬顶（Q10：落库base+bonus 不得超过100；加成不得跨base_score 分档）
export const ACTIVITY_DISPATCH_SCORE_CAP = 100;
/// 派单同档比较的档宽（bandSize = floor(base_score/10) → 11 档）。
/// 排序契约常量，**不做后台可调**（主理人裁定），故不入 system_configs。
export const ACTIVITY_DISPATCH_BAND_SIZE = 10;
