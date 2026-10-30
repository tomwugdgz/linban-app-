// ============================================================================
// 全局常量：订单状态展示元数据 / 四审阶段 / 话题短语 / 评价标签 等
// ============================================================================

import {
  order_status,
  application_stage,
  credit_log_type,
  verification_status,
} from '@/types'

/** 订单状态展示（醒目状态色，适老化：语义色 + 图标文字双通道） */
export const ORDER_STATUS_META: Record<
  order_status,
  { label: string; color: string; bg: string; desc: string }
> = {
  CREATED: { label: '待支付', color: '#F5A623', bg: '#FEF3DE', desc: '订单已锁定时段，请在 15 分钟内完成支付' },
  PAID: { label: '待派单', color: '#3A7BFD', bg: '#E8F0FF', desc: '支付成功，正在为您匹配陪聊员' },
  DISPATCHED: { label: '派单中', color: '#3A7BFD', bg: '#E8F0FF', desc: '已推送附近陪聊员，等待接单' },
  ACCEPTED: { label: '已接单', color: '#8E5BF0', bg: '#F1EAFE', desc: '陪聊员已接单，请保持电话畅通' },
  ARRIVED: { label: '已到岗', color: '#1FA97A', bg: '#E3F6EE', desc: '陪聊员已到场并通过核销' },
  IN_SERVICE: { label: '服务中', color: '#1FA97A', bg: '#E3F6EE', desc: '服务进行中，可随时联系家人' },
  PENDING_CONFIRM: { label: '待确认', color: '#F5A623', bg: '#FEF3DE', desc: '服务结束，请确认完成' },
  COMPLETED: { label: '已完成', color: '#1FA97A', bg: '#E3F6EE', desc: '双方确认完成，欢迎评价' },
  SUSPENDED: { label: '处理中', color: '#E64545', bg: '#FCE8E8', desc: '订单异常，客服正在处理' },
  CANCELLED: { label: '已取消', color: '#8A7B6E', bg: '#F3EDE7', desc: '订单已取消' },
  CLOSED: { label: '已关闭', color: '#8A7B6E', bg: '#F3EDE7', desc: '订单已完成关闭' },
  REFUNDED: { label: '已退款', color: '#8A7B6E', bg: '#F3EDE7', desc: '退款已完成' },
}

/** 订单筛选 tab（订单列表页） */
export const ORDER_TABS: { key: string; label: string; statuses: order_status[] }[] = [
  { key: 'all', label: '全部', statuses: [] },
  { key: 'pending', label: '待服务', statuses: [order_status.CREATED, order_status.PAID, order_status.DISPATCHED, order_status.ACCEPTED] },
  { key: 'serving', label: '服务中', statuses: [order_status.ARRIVED, order_status.IN_SERVICE, order_status.PENDING_CONFIRM] },
  { key: 'done', label: '已完成', statuses: [order_status.COMPLETED, order_status.CLOSED, order_status.REFUNDED, order_status.CANCELLED] },
]

/** 核销状态展示 */
export const VERIFY_STATUS_META: Record<verification_status, { label: string; color: string }> = {
  PENDING: { label: '待核验', color: '#F5A623' },
  PASSED: { label: '已通过', color: '#1FA97A' },
  FAILED: { label: '未通过', color: '#E64545' },
  EXPIRED: { label: '已过期', color: '#8A7B6E' },
}

/** 服务时长选项（分钟） */
export const DURATION_OPTIONS = [60, 90, 120, 180]

/** 四审阶段展示（陪聊员端复用） */
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

/** 信用分明细事由展示（陪聊员端） */
export const CREDIT_LOG_META: Record<credit_log_type, string> = {
  GOOD_REVIEW: '好评',
  BAD_REVIEW: '差评',
  CANCEL: '取消订单',
  IM_VIOLATION: '私聊违规',
  FLY_ORDER: '飞单坐实',
  MANUAL: '人工调整',
  SYSTEM: '系统结算',
}

/** AI 陪聊话题引导快捷短语（适老：口语化、短句） */
export const AI_TOPIC_PHRASES = [
  '今天天气真好，陪我聊聊',
  '讲个年轻时候的故事吧',
  '我想念儿女了',
  '教我几句养生顺口溜',
  '附近有什么散步的好去处',
  '给我念念今天的新闻',
]

/** 评价快捷标签 */
export const REVIEW_TAGS = ['有耐心', '守时', '聊得来', '声音亲切', '很专业', '注重安全']

/** 服务边界确认书版本（架构 §10.3，下单前勾选存证 order_timeline） */
export const BOUNDARY_AGREEMENT_VERSION = 'v1.0-202609'

/** 隐私号拨打提示（架构 §6.4：服务完成 +24h 自动解绑） */
export const PRIVACY_NUMBER_TIP = '为保护双方隐私，通话将通过隐私号码中转，服务完成 24 小时后自动失效。'

/** 客服电话（mock：TODO 接入真实客服热线） */
export const CS_PHONE = '020-8888-6666'

/** 挂起态提示文案（SOS / 服务超时 / 客服手动挂起；前端不可自行恢复） */
export const SUSPEND_TIP = '订单已紧急挂起，平台值守介入中。请保持电话畅通，恢复或终止由客服裁决。'

/** 夜间单待子女确认提示（契约 §8 夜间单三态） */
export const NIGHT_PENDING_TIP = '夜间单需由绑定的子女在 30 分钟内确认，未确认将自动取消并全额退款。'

/** 夜间单确认超时自动取消提示（终态 REFUNDED） */
export const NIGHT_TIMEOUT_TIP = '确认超时已自动取消，款项已全额原路退回。'
