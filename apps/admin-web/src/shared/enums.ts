// ============================================================================
// 枚举中文映射 —— 单一事实源为 @linban/shared（宋砚秋，与 prisma schema 逐字一致）
// 本文件职责：把共享包的原始枚举值映射为「中文标签 + 语义色」，供后台 UI 消费；
// 页面禁止直接硬编码状态字符串，一律经本文件出口。
// 注意：coupon_status（券模板状态）已由 @linban/shared 的 COUPON_STATUS 覆盖，
//       本文件只补 UI 标签与语义色，值域不再本地硬编码。
// ============================================================================
import {
  activity_channel,
  activity_consent_scope_level,
  activity_consent_status,
  activity_status,
  activity_subscription_status,
  activity_subscription_tier,
  activity_touchpoint_type,
  admin_status,
application_stage,
  blacklist_status,
  blacklist_target_type,
  commission_type,
  companion_status,
  complaint_priority,
  complaint_status,
  coupon_type,
  commission_status,
  gift_card_status,
  health_alert_level,
  health_alert_status,
  health_alert_type,
  order_status,
  profit_sharing_status,
  recon_channel,
  recon_status,
  report_reward_status,
  report_status,
  risk_event_status,
  risk_level,
  service_type,
  step_status,
  user_coupon_source,
  user_coupon_status,
  wifi_device_status,
  withdrawal_status,
} from '@linban/shared';
/** 券模板状态原始值域（shared 的 COUPON_STATUS 与本文件的同名 LabelMap 冲突，故取别名） */
import { COUPON_STATUS as COUPON_STATUS_VALUES } from '@linban/shared';

/** 共享包原始枚举再出口（页面需要枚举值/类型时从这里取，避免多处 import） */
export {
  activity_channel,
  activity_consent_scope_level,
  activity_consent_status,
  activity_status,
  activity_subscription_status,
  activity_subscription_tier,
  activity_touchpoint_type,
  admin_status,
  application_stage,
  blacklist_status,
  blacklist_target_type,
  commission_type,
  companion_status,
  complaint_priority,
  complaint_status,
  coupon_type,
  commission_status,
  gift_card_status,
  health_alert_level,
  health_alert_status,
  health_alert_type,
  order_status,
  profit_sharing_status,
  recon_channel,
  recon_status,
  report_reward_status,
  report_status,
  risk_event_status,
  risk_level,
  service_type,
  step_status,
  user_coupon_source,
  user_coupon_status,
  wifi_device_status,
  withdrawal_status,
  COUPON_STATUS_VALUES,
};

export type TagColor =
  | 'default' | 'processing' | 'success' | 'warning' | 'error' | 'purple' | 'cyan' | 'gold' | 'blue' | 'magenta' | 'green' | 'orange';

export interface EnumOption<T extends string> {
  value: T;
  label: string;
  color: TagColor;
}

type LabelMap = Record<string, EnumOption<string>>;

/** 由「[枚举值, 中文, 色]」三元组构建选项映射（值必须与共享枚举一致） */
function build(entries: [string, string, TagColor][]): LabelMap {
  const out: LabelMap = {};
  entries.forEach(([value, label, color]) => {
    out[value] = { value, label, color };
  });
  return out;
}

// ---- 订单状态机（12 态，架构 §6.5）----
export const ORDER_STATUS: LabelMap = build([
  [order_status.CREATED, '待支付', 'default'],
  [order_status.PAID, '已支付·待分账冻结', 'processing'],
  [order_status.DISPATCHED, '派单中', 'processing'],
  [order_status.ACCEPTED, '已接单', 'blue'],
  [order_status.ARRIVED, '已到岗', 'cyan'],
  [order_status.IN_SERVICE, '服务中', 'cyan'],
  [order_status.PENDING_CONFIRM, '待双方确认', 'gold'],
  [order_status.COMPLETED, '已完成·已分账', 'success'],
  [order_status.SUSPENDED, '挂起待裁决', 'error'],
  [order_status.CANCELLED, '已取消', 'default'],
  [order_status.CLOSED, '已关闭', 'default'],
  [order_status.REFUNDED, '已退款·分账回退', 'warning'],
]);

export const SERVICE_TYPE: LabelMap = build([
  [service_type.CHAT, '陪聊', 'blue'],
  [service_type.ACCOMPANY, '陪行/陪逛', 'purple'],
]);

// ---- 分账三态（架构 §7.2）----
export const PROFIT_SHARING_STATUS: LabelMap = build([
  [profit_sharing_status.FROZEN, '待分账冻结', 'gold'],
  [profit_sharing_status.SHARED, '已分账', 'success'],
  [profit_sharing_status.RETURNED, '已回退', 'warning'],
]);

// ---- 提现单状态（T+1 审核流）----
export const WITHDRAWAL_STATUS: LabelMap = build([
  [withdrawal_status.PENDING_REVIEW, '待审核', 'gold'],
  [withdrawal_status.APPROVED, '审核通过', 'blue'],
  [withdrawal_status.REJECTED, '已驳回', 'error'],
  [withdrawal_status.PROCESSING, '微信处理中', 'processing'],
  [withdrawal_status.SUCCESS, '到账成功', 'success'],
  [withdrawal_status.FAILED, '到账失败', 'error'],
]);

// ---- 对账 ----
export const RECON_CHANNEL: LabelMap = build([
  [recon_channel.WX_PAY, '微信支付', 'blue'],
  [recon_channel.WX_SHARING, '微信分账', 'green'],
  [recon_channel.WX_REFUND, '微信退款/回退', 'orange'],
  [recon_channel.WX_WITHDRAW, '微信商户提现', 'cyan'],
]);
export const RECON_STATUS: LabelMap = build([
  [recon_status.PENDING, '待执行', 'default'],
  [recon_status.RUNNING, '执行中', 'processing'],
  [recon_status.MATCHED, '无差异', 'success'],
  [recon_status.DIFF, '有差异·告警', 'error'],
  [recon_status.RESOLVED, '差异已处理', 'blue'],
]);

// ---- 四审流阶段（10 态，架构 §6.6）----
export const APPLICATION_STAGE: LabelMap = build([
  [application_stage.APPLIED, '待实名审核', 'gold'],
  [application_stage.REALNAME_OK, '待人脸审核', 'gold'],
  [application_stage.FACE_OK, '待无犯罪记录审核', 'gold'],
  [application_stage.CRIMINAL_OK, '培训中', 'processing'],
  [application_stage.TRAINING, '培训中', 'processing'],
  [application_stage.EXAM_OK, '考试通过·待缴保证金', 'blue'],
  [application_stage.DEPOSIT_OK, '保证金已缴·待上架', 'blue'],
  [application_stage.ACTIVE, '四审通过已上架', 'success'],
  [application_stage.SUSPENDED, '暂停接单', 'warning'],
  [application_stage.BANNED, '黑名单清退', 'error'],
]);
export const STEP_STATUS: LabelMap = build([
  [step_status.PENDING, '待审核', 'gold'],
  [step_status.PASSED, '通过', 'success'],
  [step_status.REJECTED, '驳回', 'error'],
]);

// ---- 陪聊员主档状态 ----
export const COMPANION_STATUS: LabelMap = build([
  [companion_status.PENDING, '审核中', 'gold'],
  [companion_status.ACTIVE, '接单中', 'success'],
  [companion_status.SUSPENDED, '暂停接单', 'warning'],
  [companion_status.BANNED, '已封禁', 'error'],
  [companion_status.RETIRED, '已退出', 'default'],
]);

// ---- 黑名单 ----
export const BLACKLIST_TARGET_TYPE: LabelMap = build([
  [blacklist_target_type.USER, '用户', 'blue'],
  [blacklist_target_type.COMPANION, '陪聊员', 'purple'],
  [blacklist_target_type.DEVICE, '设备', 'orange'],
]);
export const BLACKLIST_STATUS: LabelMap = build([
  [blacklist_status.ACTIVE, '生效中', 'error'],
  [blacklist_status.LIFTED, '已解除', 'default'],
]);

// ---- 投诉 / 举报 / 风控 ----
export const COMPLAINT_STATUS: LabelMap = build([
  [complaint_status.PENDING, '待处理', 'gold'],
  [complaint_status.PROCESSING, '处理中', 'processing'],
  [complaint_status.RESOLVED, '已解决', 'success'],
  [complaint_status.REJECTED, '已驳回', 'default'],
]);
export const COMPLAINT_PRIORITY: LabelMap = build([
  [complaint_priority.LOW, '低', 'default'],
  [complaint_priority.NORMAL, '普通', 'blue'],
  [complaint_priority.HIGH, '高', 'orange'],
  [complaint_priority.URGENT, '紧急', 'error'],
]);
export const REPORT_STATUS: LabelMap = build([
  [report_status.PENDING, '待核查', 'gold'],
  [report_status.SUBSTANTIATED, '属实', 'error'],
  [report_status.UNFOUNDED, '不属实', 'default'],
]);
export const REPORT_REWARD_STATUS: LabelMap = build([
  [report_reward_status.NONE, '未发放', 'default'],
  [report_reward_status.PENDING, '待发放', 'gold'],
  [report_reward_status.PAID, '已发放', 'success'],
]);
export const RISK_LEVEL: LabelMap = build([
  [risk_level.LOW, '低', 'default'],
  [risk_level.MEDIUM, '中', 'blue'],
  [risk_level.HIGH, '高', 'orange'],
  [risk_level.CRITICAL, '严重', 'error'],
]);
export const RISK_EVENT_STATUS: LabelMap = build([
  [risk_event_status.PENDING, '待人工', 'gold'],
  [risk_event_status.PROCESSING, '处理中', 'processing'],
  [risk_event_status.RESOLVED, '已处置', 'success'],
  [risk_event_status.FALSE_POSITIVE, '误报', 'default'],
]);

// ---- 营销 ----
export const GIFT_CARD_STATUS: LabelMap = build([
  [gift_card_status.ACTIVE, '生效中', 'success'],
  [gift_card_status.USED, '已用完', 'default'],
  [gift_card_status.EXPIRED, '已过期', 'warning'],
  [gift_card_status.REFUNDED, '已退款', 'default'],
]);
/** 券模板状态（值域来自 @linban/shared 的 COUPON_STATUS，此处只补 UI 标签与语义色） */
export const COUPON_STATUS: LabelMap = build([
  [COUPON_STATUS_VALUES.DRAFT, '草稿', 'default'],
  [COUPON_STATUS_VALUES.ACTIVE, '投放中', 'success'],
  [COUPON_STATUS_VALUES.PAUSED, '已暂停', 'warning'],
  [COUPON_STATUS_VALUES.ENDED, '已结束', 'default'],
]);
export const COUPON_TYPE: LabelMap = build([
  [coupon_type.FULL_REDUCTION, '满减券', 'blue'],
  [coupon_type.DURATION, '时长抵扣券', 'purple'],
]);

/**
 * `coupons.value` 的单位随 `type` 变（schema:1425 注释逐字：满减=减免分 / 时长=抵扣分钟）。
 *
 * 为什么必须显式建模而不是让页面自己判断：这一列如果只显示数字，运营会以为
 * 「时长券面值 30」和「满减券面值 30」是同一量级——实际一个是 30 分钟、一个是 ¥0.30，
 * 差 200 倍。列头与tooltip 都必须把单位写出来。
 */
export type CouponValueUnit = 'fen' | 'minute';
export const COUPON_VALUE_UNIT: Record<string, CouponValueUnit> = {
  [coupon_type.FULL_REDUCTION]: 'fen',
  [coupon_type.DURATION]: 'minute',
};
export const COUPON_VALUE_UNIT_LABEL: Record<CouponValueUnit, string> = {
  fen: '分',
  minute: '分钟',
};

export const USER_COUPON_STATUS: LabelMap = build([
  [user_coupon_status.UNUSED, '未使用', 'blue'],
  [user_coupon_status.USED, '已使用', 'success'],
  [user_coupon_status.EXPIRED, '已过期', 'default'],
]);
/** 用户券来源（含 ACTIVITY_LEAD：健康活动感知新装引流触达即发，PRD 裁定③） */
export const USER_COUPON_SOURCE: LabelMap = build([
  [user_coupon_source.MANUAL, '后台手动', 'default'],
  [user_coupon_source.REPURCHASE, '复购发放', 'blue'],
  [user_coupon_source.INVITE, '老带新', 'purple'],
  [user_coupon_source.REPORT_REWARD, '举报奖励', 'green'],
  [user_coupon_source.COMPLAINT, '投诉补偿', 'orange'],
  [user_coupon_source.ACTIVITY_LEAD, '健康活动引流', 'cyan'],
]);
export const COMMISSION_TYPE: LabelMap = build([
  [commission_type.ORDER_COMMISSION, '订单分佣', 'blue'],
  [commission_type.INVITE_REWARD, '邀请奖励', 'purple'],
]);
/**
 * 老带新规则的奖励形态：COUPON=发券（rewardValue 是券模板 id），
 * BALANCE=发余额（rewardValue 是「分」，必须走fenToYuan 展示）。
 * 共享包无对应枚举，按 schema 语义本地补充。
 */
export const INVITE_REWARD_TYPE: LabelMap = build([
  ['COUPON', '优惠券', 'blue'],
  ['BALANCE', '余额（分）', 'green'],
]);
export const COMMISSION_STATUS: LabelMap = build([
  [commission_status.PENDING, '待结算', 'gold'],
  [commission_status.SETTLED, '已结算', 'blue'],
  [commission_status.PAID, '已打款', 'success'],
  [commission_status.CANCELLED, '已取消', 'default'],
]);

// ---- 后台 RBAC / 审计 ----
export const ADMIN_STATUS: LabelMap = build([
  [admin_status.ACTIVE, '正常', 'success'],
  [admin_status.FROZEN, '已冻结', 'error'],
]);

// ============================================================================
// 以下枚举为 **schema 有、共享包未覆盖** 的域，按 schema 注释逐字本地补充。
// 与上面「共享包再出口」的部分区别仅在来源；消费方式一致（页面一律经本文件出口）。
// ============================================================================

/** 动态码出示方式（schema:173 code_mode） */
export const CODE_MODE: LabelMap = build([
  ['ELDER_SHOW', '老人出示', 'blue'],
  ['COMPANION_SCAN', '陪聊员扫码', 'purple'],
]);

/** 回访任务状态（schema:1193 String 注释：PENDING/DONE/OVERDUE/CANCELLED） */
export const REVISIT_STATUS: LabelMap = build([
  ['PENDING', '待回访', 'orange'],
  ['DONE', '已回访', 'success'],
  ['OVERDUE', '已逾期', 'error'],
  ['CANCELLED', '已取消', 'default'],
]);
/** 回访任务类型（schema:1191 String 注释） */
export const REVISIT_TYPE: LabelMap = build([
  ['POST_SERVICE', '服务后回访', 'blue'],
  ['QUALITY_CHECK', '服务质量核查', 'purple'],
  ['SOS_FOLLOWUP', 'SOS 跟进', 'error'],
]);

/** 抽检任务状态与结论（schema:sampling 相关表；共享包未覆盖） */
export const SAMPLING_STATUS: LabelMap = build([
  ['PENDING', '待抽检', 'gold'],
  ['REVIEWED', '已抽检', 'blue'],
]);
export const SAMPLING_RESULT: LabelMap = build([
  ['PASS', '通过', 'success'],
  ['REJECT', '不通过', 'error'],
]);

/** 保险保单理赔状态（schema:1567 claim_status String） */
export const INSURANCE_CLAIM_STATUS: LabelMap = build([
  ['ACTIVE', '生效中', 'success'],
  ['CLAIMED', '已理赔', 'orange'],
]);

/** 到岗核验方式与结果（order_steps：老人出示码 / 陪聊员扫码） */
export const VERIFY_RESULT: LabelMap = build([
  ['PASSED', '通过', 'success'],
  ['FAILED', '未通过', 'error'],
]);

/** 配置值类型（schema:1759 value_type String：STRING/INT/BOOL/DECIMAL） */
export const CONFIG_VALUE_TYPE: LabelMap = build([
  ['STRING', '字符串', 'default'],
  ['INT', '整数', 'blue'],
  ['BOOL', '开关', 'cyan'],
  ['DECIMAL', '小数', 'purple'],
]);

/** 核销类型（schema:160 verification_type：ARRIVAL 到岗核销 / COMPLETION 完成确认） */
export const VERIFICATION_TYPE: LabelMap = build([
  ['ARRIVAL', '到岗核验', 'blue'],
  ['COMPLETION', '完成确认', 'purple'],
]);

/** 核销记录状态（schema:165 verification_status） */
export const VERIFICATION_STATUS: LabelMap = build([
  ['PENDING', '待核销', 'gold'],
  ['PASSED', '已通过', 'success'],
  ['FAILED', '未通过', 'error'],
  ['EXPIRED', '已过期', 'default'],
]);

/**
 * 风控/投诉/举报的处置动作（**请求体动作值**，非状态）。
 * 之所以也要出口：动作值会参与「弹窗必填校验」与「危险按钮配色」判断，
 * 写错的表现是校验静默失效——运营点了没反应，且没有任何报错。
 */
export const RISK_HANDLE_ACTION: LabelMap = build([
  ['PROCESSING', '标记处理中', 'processing'],
  ['RESOLVED', '确认处置', 'success'],
  ['FALSE_POSITIVE', '标记误报', 'default'],
]);
/** 处置动作的具体措施（risk_events.handle.actionTaken） */
export const RISK_ACTION_TAKEN: LabelMap = build([
  ['WARN', '警告', 'gold'],
  ['INTERCEPT', '拦截订单', 'error'],
  ['LIMIT', '限制功能', 'warning'],
  ['PENALTY', '罚扣保证金', 'error'],
  ['BAN', '封禁', 'error'],
]);
/** 投诉工单动作 */
export const COMPLAINT_ACTION: LabelMap = build([
  ['PROCESS', '受理', 'processing'],
  ['RESOLVE', '解决', 'success'],
  ['REJECT', '驳回', 'default'],
]);
/** 举报核查结论（与 report_status 同值，但语义是「本次操作」） */
export const REPORT_ACTION: LabelMap = build([
  ['SUBSTANTIATED', '核查属实', 'error'],
  ['UNFOUNDED', '核查不属实', 'default'],
]);
/** 陪聊员四审动作 */
export const APPLICATION_ACTION: LabelMap = build([
  ['PASS', '通过', 'success'],
  ['REJECT', '驳回', 'error'],
]);

/** 争议方角色（投诉人 / 举报人：USER vs COMPANION）；两处语义一致，故共用一张表 */
export const PARTY_ROLE: LabelMap = build([
  ['USER', '用户', 'blue'],
  ['COMPANION', '陪聊员', 'purple'],
]);

/**
 * 订单挂起裁决动作（客服工作台；与 order_status 终态 + 分账回退比例联动）。
 * 值取自 order suspended 裁决请求体的 decision 字段（前端补充端点，契约未覆盖）。
 */
export const ORDER_DECISION: LabelMap = build([
  ['COMPLETE', '裁决完成', 'success'],
  ['PARTIAL_REFUND', '部分退款 50%', 'warning'],
  ['FULL_REFUND', '全额退款', 'error'],
]);

/** 取枚举中文标签，未知值原样返回（后端新增枚举值时前端不白屏） */
export function enumLabel(map: LabelMap, value?: string | null): string {
  if (!value) return '-';
  return map[value]?.label ?? value;
}

/**
 * 状态下拉的选项数组；筛选项也用它，保证下拉与标签映射同一事实源。
 * 注意：enumLabel 遇未知值会原样返回，所以这个数组**不能**用来做「枚举全集」断言。
 */
export function enumOptions(map: LabelMap): EnumOption<string>[] {
  return Object.values(map);
}

/**
 * 状态归属判断：`inEnum(ORDER_STATUS, x.status, 'PENDING')`。
 *
 * 为什么不直接写 `x.status === 'PENDING'`：硬编码字符串散落在十几个页面里，
 * 共享包一旦给枚举改名就全站哑掉（比较永远 false，按钮静默消失且不报错——
 * 这类 bug 最难查）。走这个函数后，值写错至少是编译期/单点可改。
 */
export function inEnum(map: LabelMap, value: string | undefined | null, ...allowed: string[]): boolean {
  if (!value) return false;
  return allowed.some((a) => map[a]?.value === value);
}

/** 取枚举颜色 */
export function enumColor(map: LabelMap, value?: string | null): TagColor {
  if (!value) return 'default';
  return map[value]?.color ?? 'default';
}

// ============================================================================
// 健康活动感知（契约 §10 / 架构 §13 / PRD MODULE-ACTIVITY-SENSE.md）
// ============================================================================

/**
 * 活动状态五级（PRD §3：必须带置信度与新鲜度，禁止「假装确定」）。
 * 语义色严格对应运营判断的第一眼信息：绿=可放心 / 黄=需留意 / 橙=需介入 /
 * 灰=不在家（正常）/ 深灰=数据不足（**不可读作正常**，PRD 红线）。
 */
export const ACTIVITY_STATUS: LabelMap = build([
  [activity_status.ACTIVE, '活跃', 'success'],
  [activity_status.LOW, '低活跃', 'warning'],
  [activity_status.STILL, '久静', 'orange'],
  [activity_status.AWAY, '外出/离线', 'default'],
  [activity_status.UNKNOWN, '数据不足', 'default'],
]);

/**
 * 状态色块（表格/看板首眼信息用）。
 * 独立于 Tag 色板：AWAY 浅灰（正常外出）与 UNKNOWN 深灰（数据不足）必须一眼可区分，
 * 否则运营会把「没采到数据」误读为「老人没事」——这是 PRD 隐私红线的直接落点。
 */
export const ACTIVITY_STATUS_HEX: Record<string, string> = {
  [activity_status.ACTIVE]: '#52c41a',
  [activity_status.LOW]: '#faad14',
  [activity_status.STILL]: '#fa541c',
  [activity_status.AWAY]: '#bfbfbf',
  [activity_status.UNKNOWN]: '#434343',
};

export const HEALTH_ALERT_TYPE: LabelMap = build([
  [health_alert_type.STILL_TOO_LONG, '久静超阈', 'orange'],
  [health_alert_type.DEVICE_OFFLINE, '探针离线', 'default'],
  [health_alert_type.LOW_TREND, '低活跃趋势', 'warning'],
  [health_alert_type.NOCTURNAL_ACTIVITY, '夜间异常活跃', 'blue'],
  [health_alert_type.FALL_SUSPECT, '跌倒疑似（W+1）', 'error'],
  [health_alert_type.RESPIRATORY_TREND, '呼吸趋势（W+2）', 'purple'],
]);

/** 告警级别：REMIND 看板提示 / WARN 推送+推荐位 / URGENT 外呼+紧急联系人（与 SOS 同出口） */
export const HEALTH_ALERT_LEVEL: LabelMap = build([
  [health_alert_level.REMIND, '提醒', 'default'],
  [health_alert_level.WARN, '预警', 'warning'],
  [health_alert_level.URGENT, '紧急', 'error'],
]);

/** 告警状态自闭环（契约 §13.6：OPEN → ACKNOWLEDGED → PROCESSING → RESOLVED/DISMISSED/ESCALATED） */
export const HEALTH_ALERT_STATUS: LabelMap = build([
  [health_alert_status.OPEN, '待处置', 'error'],
  [health_alert_status.ACKNOWLEDGED, '已确认', 'gold'],
  [health_alert_status.PROCESSING, '处置中', 'processing'],
  [health_alert_status.RESOLVED, '已处置', 'success'],
  [health_alert_status.DISMISSED, '误报', 'default'],
  [health_alert_status.ESCALATED, '已升级', 'magenta'],
]);

export const WIFI_DEVICE_STATUS: LabelMap = build([
  [wifi_device_status.PENDING, '待首次心跳', 'gold'],
  [wifi_device_status.ONLINE, '在线', 'success'],
  [wifi_device_status.OFFLINE, '离线', 'default'],
  [wifi_device_status.UNBOUND, '已解绑', 'default'],
  [wifi_device_status.REVOKED, '已撤销授权', 'error'],
]);

export const ACTIVITY_CONSENT_STATUS: LabelMap = build([
  [activity_consent_status.PENDING, '待本人确认', 'gold'],
  [activity_consent_status.GRANTED, '已授权', 'success'],
  [activity_consent_status.REVOKED, '已撤销', 'error'],
  [activity_consent_status.EXPIRED, '已到期', 'default'],
]);

/** 子女可见范围档位（PRD 红线④第二层；默认不做实时轨迹回放） */
export const ACTIVITY_CONSENT_SCOPE: LabelMap = build([
  [activity_consent_scope_level.NONE, '不可见', 'default'],
  [activity_consent_scope_level.DAILY_SUMMARY, '仅活动日报', 'blue'],
  [activity_consent_scope_level.ALERT_ONLY, '仅告警', 'warning'],
  [activity_consent_scope_level.TREND, '日/周趋势+告警', 'success'],
]);

export const ACTIVITY_TOUCHPOINT_TYPE: LabelMap = build([
  [activity_touchpoint_type.INSTALL, '装机', 'default'],
  [activity_touchpoint_type.ACTIVATION, '激活', 'blue'],
  [activity_touchpoint_type.CONSENT_GRANTED, '双层同意完成', 'purple'],
  [activity_touchpoint_type.DATA_AVAILABLE, '数据可用', 'cyan'],
  [activity_touchpoint_type.ALERT_RAISED, '告警触达', 'orange'],
  [activity_touchpoint_type.FIRST_ORDER, '首次下单', 'green'],
  [activity_touchpoint_type.REORDER, '复购', 'gold'],
]);

export const ACTIVITY_SUBSCRIPTION_TIER: LabelMap = build([
  [activity_subscription_tier.FREE, '免费层', 'default'],
  [activity_subscription_tier.PRO, '高级层 ¥49/月', 'purple'],
  [activity_subscription_tier.INSTITUTIONAL, '机构层', 'cyan'],
]);
export const ACTIVITY_SUBSCRIPTION_STATUS: LabelMap = build([
  [activity_subscription_status.PENDING, '待生效', 'gold'],
  [activity_subscription_status.ACTIVE, '订阅中', 'success'],
  [activity_subscription_status.EXPIRED, '已到期', 'default'],
  [activity_subscription_status.CANCELLED, '已取消', 'default'],
  [activity_subscription_status.SUSPENDED, '已暂停', 'warning'],
]);

/**
 * 依据码（explain_code）中文释义 —— 与 server 端 domain/activity.ts 的
 * ACTIVITY_EXPLAIN 逐字对应。运营/客服只看中文释义做判断，英文码仅供审计回溯。
 * 依据码可审计、可回放（架构 §13），前端不得只给英文枚举。
 */
export const ACTIVITY_EXPLAIN_LABEL: Record<string, { label: string; reason: string }> = {
  ACTIVE_HIGH: { label: '活跃度高', reason: '采集窗口内活跃时长占比 ≥ 60%，网络切换正常' },
  LOW_ACTIVITY: { label: '低活跃', reason: '活跃时长占比 < 15%，但未达久静判据' },
  STILL_NO_MOTION: { label: '久静无活动', reason: '窗口内活跃分钟 ≤ 2 且网络切换 ≤ 1 次' },
  AWAY_CONFIRMED: { label: '确认外出', reason: '未连接已知家庭网络且无网络切换，判为外出' },
  PROBE_OFFLINE: { label: '探针离线', reason: '探针离线，无法采集；信号缺失，不做任何健康推断' },
  SIGNAL_EXPIRED: { label: '信号过期', reason: '最近有效信号超过 activity_signal_ttl，强制回落 UNKNOWN' },
  INSUFFICIENT_DATA: { label: '数据不足', reason: '有效采集窗口 < 5 分钟，样本不足以分级' },
};

/** 引流触发器（契约 §13.9 detectLeadTriggers）：三触发器释义，供漏斗页归因说明 */
export const LEAD_TRIGGER_LABEL: Record<string, string> = {
  ACTIVITY_DROP: '活跃下降触发',
  LOW_TREND: '低活跃趋势触发',
  NEWINSTALL_EXPERIENCE: '新装体验触发',
};
