// ============================================================================
// 陪聊员端全局常量：订单状态展示 / 四审步骤 / 信用分规则 / 收入口径
// ============================================================================

import {
  order_status,
  application_stage,
  step_status,
  credit_log_type,
  deposit_tx_type,
  withdrawal_status,
  verification_status,
  companion_status,
} from '@/types'

/** 订单状态展示（醒目状态色 + 文字双通道） */
export const ORDER_STATUS_META: Record<
  order_status,
  { label: string; color: string; bg: string; desc: string }
> = {
  CREATED: { label: '待支付', color: '#F5A623', bg: '#FEF3DE', desc: '等待长辈完成支付' },
  PAID: { label: '待派单', color: '#3A7BFD', bg: '#E8F0FF', desc: '已支付，等待平台派单' },
  DISPATCHED: { label: '派单中', color: '#3A7BFD', bg: '#E8F0FF', desc: '已推送附近陪聊员，等待接单' },
  ACCEPTED: { label: '已接单', color: '#8E5BF0', bg: '#F1EAFE', desc: '请按时到达并在老人端出示动态码' },
  ARRIVED: { label: '已到岗', color: '#1FA97A', bg: '#E3F6EE', desc: '到岗核销已通过，服务即将开始' },
  IN_SERVICE: { label: '服务中', color: '#1FA97A', bg: '#E3F6EE', desc: '正在服务，注意服务时长与安全' },
  PENDING_CONFIRM: { label: '待确认', color: '#F5A623', bg: '#FEF3DE', desc: '服务已结束，等待双方确认' },
  COMPLETED: { label: '已完成', color: '#1FA97A', bg: '#E3F6EE', desc: '订单已完成，收入已入账' },
  SUSPENDED: { label: '已挂起', color: '#E64545', bg: '#FCE8E8', desc: '订单已紧急挂起，平台值守介入中' },
  CANCELLED: { label: '已取消', color: '#8A7B6E', bg: '#F3EDE7', desc: '订单已取消' },
  CLOSED: { label: '已关闭', color: '#8A7B6E', bg: '#F3EDE7', desc: '订单已关闭' },
  REFUNDED: { label: '已退款', color: '#8A7B6E', bg: '#F3EDE7', desc: '已全额退款' },
}

/** 陪聊员订单筛选 tab */
export const COMPANION_ORDER_TABS: { key: string; label: string; statuses: order_status[] }[] = [
  { key: 'all', label: '全部', statuses: [] },
  { key: 'todo', label: '待服务', statuses: [order_status.PAID, order_status.DISPATCHED, order_status.ACCEPTED] },
  { key: 'serving', label: '服务中', statuses: [order_status.ARRIVED, order_status.IN_SERVICE, order_status.PENDING_CONFIRM] },
  { key: 'done', label: '已完成', statuses: [order_status.COMPLETED, order_status.CLOSED] },
]

/** 核销状态展示 */
export const VERIFY_STATUS_META: Record<verification_status, { label: string; color: string }> = {
  PENDING: { label: '待核验', color: '#F5A623' },
  PASSED: { label: '已通过', color: '#1FA97A' },
  FAILED: { label: '未通过', color: '#E64545' },
  EXPIRED: { label: '已过期', color: '#8A7B6E' },
}

/**
 * 入驻四审步骤（契约 §4.1，10 态状态机，端上按 5 个可视步骤呈现）
 * 顺序：实名 → 人脸 → 无犯罪记录 → 培训考试 → 缴保证金
 */
export const ONBOARDING_STEPS: {
  key: 'realname' | 'face' | 'criminal' | 'exam' | 'deposit'
  title: string
  desc: string
  /** 对应 application_stage 目标态 */
  targetStage: application_stage
}[] = [
  { key: 'realname', title: '实名认证', desc: 'OCR 识别身份证 + 公安二要素核验', targetStage: application_stage.REALNAME_OK },
  { key: 'face', title: '人脸底照', desc: '微信慧眼活体检测，留存人脸底照', targetStage: application_stage.FACE_OK },
  { key: 'criminal', title: '无犯罪记录', desc: '上传无犯罪记录证明，平台人工审核', targetStage: application_stage.CRIMINAL_OK },
  { key: 'exam', title: '培训与考试', desc: '完成培训课程并通过考试（≥80 分）', targetStage: application_stage.EXAM_OK },
  { key: 'deposit', title: '缴纳保证金', desc: '缴纳 ¥500 保证金后正式上架接单', targetStage: application_stage.DEPOSIT_OK },
]

/** 四审阶段展示 */
export const APPLICATION_STAGE_META: Record<application_stage, { label: string; step: number }> = {
  APPLIED: { label: '已申请', step: 0 },
  REALNAME_OK: { label: '实名通过', step: 1 },
  FACE_OK: { label: '人脸通过', step: 2 },
  CRIMINAL_OK: { label: '无犯罪记录通过', step: 3 },
  TRAINING: { label: '培训中', step: 4 },
  EXAM_OK: { label: '考试通过', step: 5 },
  DEPOSIT_OK: { label: '保证金已缴', step: 6 },
  ACTIVE: { label: '已上架', step: 6 },
  SUSPENDED: { label: '暂停接单', step: 6 },
  BANNED: { label: '已清退', step: 6 },
}

/** 单步审核状态展示 */
export const STEP_STATUS_META: Record<step_status, { label: string; color: string }> = {
  PENDING: { label: '待提交', color: '#F5A623' },
  PASSED: { label: '已通过', color: '#1FA97A' },
  REJECTED: { label: '未通过', color: '#E64545' },
}

/** 陪聊员主档状态展示 */
export const COMPANION_STATUS_META: Record<companion_status, { label: string; color: string; bg: string }> = {
  PENDING: { label: '审核中', color: '#F5A623', bg: '#FEF3DE' },
  ACTIVE: { label: '已上架', color: '#1FA97A', bg: '#E3F6EE' },
  SUSPENDED: { label: '暂停接单', color: '#E64545', bg: '#FCE8E8' },
  BANNED: { label: '已清退', color: '#E64545', bg: '#FCE8E8' },
  RETIRED: { label: '已退出', color: '#8A7B6E', bg: '#F3EDE7' },
}

/** 信用分明细事由展示 */
export const CREDIT_LOG_META: Record<credit_log_type, string> = {
  GOOD_REVIEW: '收到好评',
  BAD_REVIEW: '收到差评',
  CANCEL: '取消订单',
  IM_VIOLATION: '私聊违规',
  FLY_ORDER: '飞单坐实',
  MANUAL: '人工调整',
  SYSTEM: '系统结算',
}

/** 保证金流水类型展示 */
export const DEPOSIT_TX_META: Record<deposit_tx_type, string> = {
  IN: '缴纳',
  OUT: '退还',
  PENALTY: '罚扣',
}

/** 提现状态展示 */
export const WITHDRAWAL_STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING_REVIEW: { label: '待审核', color: '#F5A623' },
  APPROVED: { label: '已通过', color: '#3A7BFD' },
  PROCESSING: { label: '打款中', color: '#3A7BFD' },
  SUCCESS: { label: '已到账', color: '#1FA97A' },
  REJECTED: { label: '已驳回', color: '#E64545' },
  FAILED: { label: '打款失败', color: '#E64545' },
}

/**
 * 信用分规则（架构 §8.3；端上只读展示，调整仅后台留痕）
 */
export const CREDIT_RULES = [
  { title: '初始信用分', value: '100 分', desc: '通过全部入驻审核后即为初始分值' },
  { title: '收到好评', value: '+1 分', desc: '每单最多加分一次，订单完成 7 天内结算' },
  { title: '收到差评', value: '−3 分', desc: '评价确认后即时扣减' },
  { title: '取消订单', value: '−5 分', desc: '已接单后无正当理由取消' },
  { title: 'IM 违规', value: '−10 分', desc: '脱离订单私聊、交换联系方式' },
  { title: '飞单坐实', value: '−20 分', desc: '绕过平台交易，证据由平台核验认定' },
]

/** 信用分等级分档 */
export const CREDIT_LEVELS = [
  { min: 90, label: '优秀', color: '#1FA97A', desc: '优先派单权，信用良好' },
  { min: 70, label: '良好', color: '#3A7BFD', desc: '正常派单' },
  { min: 60, label: '一般', color: '#F5A623', desc: '派单优先级降低' },
  { min: 0, label: '受限', color: '#E64545', desc: '限制接单，需联系平台申诉' },
]

/** 保证金默认金额（分）——契约 §4.1：默认 ¥500 */
export const DEFAULT_DEPOSIT_FEN = '50000'

/** 平台抽成比例（展示用；真实以服务端分账结果为准） */
export const PLATFORM_COMMISSION_RATE = 0.05

/** 提现金额区间（分）——服务端校验 ¥1–¥500 */
export const WITHDRAW_MIN_FEN = 100
export const WITHDRAW_MAX_FEN = 50000

/**
 * 提现是否放出「微信零钱」收款方式（主理人裁定 2026-10：MVP 只支持银行卡）。
 * 关闭原因：withdrawals 表只有 bankName/bankAccount，而「微信商家转账到零钱」
 * 需要企业资质 + 单独开通，属于 W1 进件阻塞的一部分，放到 Phase 4。
 * 代码（微信号校验 + 提交分支）已完整保留，届时置 true 即可，无需重写。
 */
export const WITHDRAW_WECHAT_ENABLED = false

/** 服务时长选项（分钟） */
export const DURATION_OPTIONS = [60, 90, 120, 180]

/** 隐私号拨打提示（架构 §6.4：服务完成 24h 自动解绑） */
export const PRIVACY_NUMBER_TIP = '为保护双方隐私，通话将通过隐私号码中转，服务完成 24 小时后自动失效。'

/** 客服电话（mock：TODO 接入真实客服热线） */
export const CS_PHONE = '020-8888-6666'

/** SOS 挂起提示文案（服务端裁定：前端不可自行恢复） */
export const SUSPEND_TIP = '订单已紧急挂起，平台值守介入中。请保持手机畅通，勿自行恢复服务。'
