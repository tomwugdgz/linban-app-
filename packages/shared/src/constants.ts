// ============================================================================
// 邻伴 · 通用常量（三端 + 服务端共用）
// ----------------------------------------------------------------------------
// 分三类：
//   1. SYSTEM_CONFIG_DEFAULTS —— system_configs 表种子默认值（架构附录 C +
//      DATABASE.md §8），服务端启动/缓存失效时以此回落，后台可热更新；
//   2. CREDIT_RULES / COMMISSION —— 架构 §8.3/§7.3 的领域规则数值（进 domain 层
//      单测），与枚举一样属于「不可在代码里另立山头」的常量；
//   3. 运行期硬约束（超时、TTL、缓存键模板、业务边界）。
// ============================================================================

// ---------------------------------------------------------------------------
// 1. system_configs 种子默认值（DATABASE.md §8 全量 12 项）
//    注意：金额类一律「分」；布尔小写字符串；DECIMAL 以字符串存储。
// ---------------------------------------------------------------------------

export type ConfigValueType = 'STRING' | 'INT' | 'BOOL' | 'DECIMAL';

export interface SystemConfigSeed {
  value: string;
  valueType: ConfigValueType;
  description: string;
}

export const SYSTEM_CONFIG_DEFAULTS: Record<string, SystemConfigSeed> = {
  // ---- 架构附录 C 原样 10 项 ----
  commission_rate: {
    value: '0.05',
    valueType: 'DECIMAL',
    description: '平台抽成比例 5–10%，支持阶梯规则（应用层换算基点 500）',
  },
  deposit_amount: {
    value: '50000',
    valueType: 'INT',
    description: '陪聊员保证金（分）＝¥500（DATABASE.md §10 Q1：附录 C 的 500(分) 与 §6.6 的 ¥500 矛盾，按 ¥500=50000 分落值）',
  },
  dynamic_code_ttl: {
    value: '300',
    valueType: 'INT',
    description: '到岗动态码有效期（秒）',
  },
  face_match_threshold: {
    value: '80',
    valueType: 'INT',
    description: '人脸比对通过阈值（0–100）',
  },
  gps_max_deviation: {
    value: '2000',
    valueType: 'INT',
    description: '签到 GPS 与订单地址最大偏差（米）',
  },
  dispatch_timeout_min: {
    value: '30',
    valueType: 'INT',
    description: '派单无人接单转人工时长（分钟）',
  },
  privacy_number_valid_hours_after_done: {
    value: '24',
    valueType: 'INT',
    description: '隐私号服务完成后保留时长（小时），到期自动解绑',
  },
  night_order_enabled: {
    value: 'false',
    valueType: 'BOOL',
    description: '夜间订单开关（22:00–06:00 需子女确认）',
  },
  ai_sample_rate: {
    value: '0.05',
    valueType: 'DECIMAL',
    description: 'AI 会话人工抽检比例',
  },
  report_reward: {
    value: '2000',
    valueType: 'INT',
    description: '飞单举报属实奖励（分）＝¥20',
  },
  // ---- DATABASE.md §8 建议新增 2 项（§8.3 阈值配置化） ----
  credit_limit_threshold: {
    value: '60',
    valueType: 'INT',
    description: '信用分低于此值限流派单（§8.3）',
  },
  credit_freeze_threshold: {
    value: '40',
    valueType: 'INT',
    description: '信用分低于此值冻结接单（§8.3）',
  },
  // ---- team-lead 裁定③④：安全挂起 / 夜间单确认阈值（DATABASE.md §8 回写：宋砚秋） ----
  service_overtime_suspend_min: {
    value: '60',
    valueType: 'INT',
    description: '服务中订单超过预约结束时间多少分钟未完成确认且 IM 静默，则自动挂起待客服核实（裁定③）',
  },
  im_silence_suspend_min: {
    value: '30',
    valueType: 'INT',
    description: '自动挂起判定附加条件：订单 IM 多少分钟无互动（与服务超时阈值同时满足才挂起，裁定③）',
  },
  night_confirm_timeout_min: {
    value: '30',
    valueType: 'INT',
    description: '夜间单（22:00–06:00）子女确认时限（分钟，自下单起算），超时自动取消并全额退款（裁定④）',
  },
  // ---- 架构 §7.6 兜底模式开关（宋砚秋 review 补缺，DATABASE.md v1.1 §8 第 13 项） ----
  split_mode: {
    value: 'wechat_profit_sharing',
    valueType: 'STRING',
    description:
      '分账执行模式（§7.6）：wechat_profit_sharing=主路径服务商自动分账（默认）；manual_settlement_fallback=兜底人工结算（仅灰度联调，上线前必须切回）',
  },
  // ---- 取消违约金比例（team-lead 裁定，2026-10：后台可配） ----
  // 口径：基点（1 bp = 0.01%），1000 = 10%。此前硬编码在 order.service.ts 的
  // CANCELLATION_FEE_RATE_BP，硬编码的致命问题不是"改不了"，而是**改的时候
  // 没有变更留痕**——财务查不出"违约金从 10% 调到 12% 是谁在何时改的"。
  // 移进 system_configs 后，任何改动都必落 audit_logs（见 §5.7 配置变更历史端点）。
  cancel_penalty_rate_bp: {
    value: '1000',
    valueType: 'INT',
    description: '接单后取消的违约金比例（基点，1000=10%），补偿陪聊员；改动人须留审计',
  },
  // ---- 健康活动感知（架构 §13.11 / PRD §3-§8，11 项权威清单 team-lead 裁定；
  //单通道不得直接下健康结论；activity_insight_configs 不建表，并入 system_configs） ----
  activity_watch_enabled: {
    value: 'false',
    valueType: 'BOOL',
    description: '健康活动感知总开关（默认关=opt-in）：关闭时采集入口直接拒绝，且不出任何分级/告警',
  },
  activity_signal_ttl: {
    value: '21600',
    valueType: 'INT',
    description: '活动信号有效期（秒，默认 6h）：超期分级强制回落 UNKNOWN',
  },
  activity_still_alert_min: {
    value: '240',
    valueType: 'INT',
    description: '久静告警阈值（分钟，连续静默时长）',
  },
  activity_low_trend_window_days: {
    value: '3',
    valueType: 'INT',
    description: '低活跃趋势判定窗口（天，连续下降天数）',
  },
  activity_drop_pct_threshold: {
    value: '30',
    valueType: 'INT',
    description: '活动量下降超过此百分比（%）触发引流触发器①与 LOW_TREND 预警',
  },
  activity_alert_suppress_min: {
    value: '180',
    valueType: 'INT',
    description: '同类告警抑制窗口（分钟，防告警疲劳；窗口内不重复推送）',
  },
  activity_signal_retention_days: {
    value: '14',
    valueType: 'INT',
    description: '原始特征留存天数（PRD 红线⑥ 硬上限 14 天，sweep 自动清理）',
  },
  activity_dispatch_bonus_low: {
    value: '5',
    valueType: 'INT',
    description: '派单活动加成（分）：LOW 状态 +5（Q10 定稿为加分数口径，原 ×1.1 乘数作废；仅同档内微调，不得跨档）',
  },
  activity_dispatch_bonus_still: {
    value: '10',
    valueType: 'INT',
    description: '派单活动加成（分）：STILL 状态 +10（Q10 定稿为加分数口径，原 ×1.2 乘数作废；服务半径硬约束不因加成放宽）',
  },
  activity_cross_verify_required: {
    value: 'true',
    valueType: 'BOOL',
    description: '紧急告警是否强制双通道交叉验证（PRD 红线，建议锁 true；交叉不通过一律降级为预警待人工确认）',
  },
  activity_lead_incentive_newinstall: {
    value: '2000',
    valueType: 'INT',
    description: '新装体验触发的优惠额度（分）——引流触发器③，注册即发券，券 source=ACTIVITY_LEAD 并关联 touchpoint_id',
  },
};

/** 强类型读取 system_configs 默认值的助手（领域层/服务层回落用） */
export function defaultConfigInt(key: keyof typeof SYSTEM_CONFIG_DEFAULTS): number {
  return Number(SYSTEM_CONFIG_DEFAULTS[key]!.value);
}

// ---------------------------------------------------------------------------
// 配置域分组（唯一权威 · 宋砚秋 2026-10 上收）
// ---------------------------------------------------------------------------
// 【为什么上收，此前是三处双写面】
//   服务端 admin.routes.ts 的 GROUP_KEYS 只有 2 组 16 键（SQL 过滤白名单），
//   前端 admin-web/src/shared/config-meta.ts 的 CONFIG_GROUPS 是 6 组 28 键（展示分组）。
//   实测前端 28 键 === SYSTEM_CONFIG_DEFAULTS 全集，故**前端就是全集**，
//   服务端缺的 12 键是**漏实现**而非另一种语义 —— 后果是配置变更历史页
//   6 个筛选项里 4 个会被服务端 zod 400（运营点得到、查不出、无报错提示），
//   且 `report_reward` 在两边归属不同组（前端「风控与信用」/ 服务端「分账与资金」）。
//   故两份表合并为**这一份**，两端都从这里取，不再各自维护。
//
// 【键集不变式（由 doc:check:configs 段 6 断言，不等即红）】
//   ① 扁平并集 === SYSTEM_CONFIG_DEFAULTS 键集（不多不少，一个不漏一个不重）
//   ② 每个键恰好出现在 1 个组（重复归属会让运营在前端 A 组看到、服务端按 B 组筛）
//
// 【键序即前端展示顺序】必须与原config-meta.ts 完全一致，否则前端一改顺序又是一个漂移点。
//
// 【形态说明（依赖方必读）—— 霍承钧 2026-10 提出，宋砚秋落笔】
//   本表是「**对象套 string[]**」形态：`Object.values()` 得到的是**数组**，
//   数组的 `typeof` 是 `'object'` 而非 `'string'`，
//   故 enum-mirror 的 `collectSharedEnums` 里
//   `!vals.every(v => typeof v === 'string')` 成立 → 本表被 `continue` 跳过
//   → **不会**被误登记为 schema 枚举，故**无需**进 `TS_ONLY_ALLOWLIST`。
//   实测结论见 `apps/server/scripts/probes/probe-enum-collect.ts`（一次性诊断探针，非门禁）。
//
//   ⚠️ **若将来 `collectSharedEnums` 的判定被放宽**（例如改成「任意对象都收」），
//   本表会**立刻**被误收集 → enum-mirror 会报
//   「shared 有但 schema 无，且未登记到 TS_ONLY_ALLOWLIST」。
//   **正确处置是登记进 `TS_ONLY_ALLOWLIST` 并写明理由**（不是回退判定本身 ——
//   放宽判定可能是为了支持别的合法形态）。
//   同批需要复核登记的还有：`SYSTEM_CONFIG_DEFAULTS`（对象套对象，值非 string）。
//
//   判定逻辑侧的同一份说明在
//   `apps/server/src/modules/activity/enum-mirror.test.ts`（`collectSharedEnums` 函数下方）。
//   **两处都要写**：约束的主人在这边，执行检查的在那边 ——
//   只写一处，任一侧单独改动就会形成单向漂移。
export const CONFIG_DOMAIN_GROUPS = {
  分账与资金: [
    'commission_rate',
    'deposit_amount',
    'split_mode',
    'cancel_penalty_rate_bp',
  ],
  核销与到岗: ['dynamic_code_ttl', 'face_match_threshold', 'gps_max_deviation'],
  派单与隐私: [
    'dispatch_timeout_min',
    'privacy_number_valid_hours_after_done',
    'night_order_enabled',
  ],
  风控与信用: [
    'ai_sample_rate',
    'report_reward',
    'credit_limit_threshold',
    'credit_freeze_threshold',
  ],
  自动挂起与夜间确认: [
    'service_overtime_suspend_min',
    'im_silence_suspend_min',
    'night_confirm_timeout_min',
  ],
  健康活动感知: [
    'activity_watch_enabled',
    'activity_signal_ttl',
    'activity_still_alert_min',
    'activity_low_trend_window_days',
    'activity_drop_pct_threshold',
    'activity_alert_suppress_min',
    'activity_signal_retention_days',
    'activity_dispatch_bonus_low',
    'activity_dispatch_bonus_still',
    'activity_cross_verify_required',
    'activity_lead_incentive_newinstall',
  ],
} as const;

/** 配置域分组名（对外 group 参数的唯一取值域；加组自动生效，无需改zod） */
export type ConfigDomainGroup = keyof typeof CONFIG_DOMAIN_GROUPS;

/** 全部配置键的扁平并集（去重）。供「键集 === SYSTEM_CONFIG_DEFAULTS」断言与校验用。 */
export const CONFIG_GROUP_KEYS: readonly string[] = Object.freeze(
  [...new Set(Object.values(CONFIG_DOMAIN_GROUPS).flat() as string[])].sort(),
);

/** 某配置键归属的分组；未登记返回 undefined（**不给兜底组**，宁可显式缺失也不静默归「其他」——
 *  静默兜底会让漏归组的键混进「其他」，运营永远发现不了配置错误）。 */
export function configDomainGroupOf(key: string): ConfigDomainGroup | undefined {
  for (const [group, keys] of Object.entries(CONFIG_DOMAIN_GROUPS)) {
    if ((keys as readonly string[]).includes(key)) return group as ConfigDomainGroup;
  }
  return undefined;
}

/** 配置项中文名（展示用截短版；**权威释义是 SYSTEM_CONFIG_DEFAULTS[key].description**，
 *  两者分工：label 用于表格列宽，description 用于 tooltip/详情。
 *  主理人 2026-10 裁定：configLabel 出参取 description，本表降级为列宽参考）。 */
export const CONFIG_LABELS: Record<string, string> = {
  commission_rate: '平台抽成率',
  deposit_amount: '保证金金额',
  split_mode: '分账执行模式',
  cancel_penalty_rate_bp: '取消违约金率',
  dynamic_code_ttl: '动态码有效期',
  face_match_threshold: '人脸匹配阈值',
  gps_max_deviation: 'GPS 最大偏差',
  dispatch_timeout_min: '派单等待超时',
  privacy_number_valid_hours_after_done: '隐私号有效期（完成后）',
  night_order_enabled: '夜间单开关',
  ai_sample_rate: 'AI 抽检比例',
  report_reward: '举报飞单奖励额',
  credit_limit_threshold: '信用分限流阈值',
  credit_freeze_threshold: '信用分冻结阈值',
  service_overtime_suspend_min: '服务超时自动挂起',
  im_silence_suspend_min: 'IM 静默自动挂起',
  night_confirm_timeout_min: '夜间单子女确认超时',
};

/** 以「分」为单位的配置键（展示须除 100，禁止浮点运算） */
export const FEN_CONFIGS: ReadonlySet<string> = new Set([
  'deposit_amount',
  'report_reward',
  'activity_dispatch_bonus_low',
  'activity_dispatch_bonus_still',
  'activity_lead_incentive_newinstall',
]);

/** 以「基点」为单位的配置键（1% = 100bp，展示除 100 得百分比） */
export const BP_CONFIGS: ReadonlySet<string> = new Set(['cancel_penalty_rate_bp']);

// ---------------------------------------------------------------------------
// 2. 信用分规则（架构 §8.3，数值进 domain 层单测）
// ---------------------------------------------------------------------------

/** 信用分满分 */
export const CREDIT_FULL_SCORE = 100;
/** 信用分下限（不低于 0） */
export const CREDIT_MIN_SCORE = 0;

/**
 * 信用分加减规则（架构 §8.3）：
 *   好评 +1 / 差评 −3 / 取消 −2 / 私聊违规 −5 / 飞单坐实 −20 并清退。
 * MANUAL/SYSTEM 为人工调整/系统结算事由，分值由操作输入，不在此表。
 */
export const CREDIT_RULES = {
  GOOD_REVIEW: 1,
  BAD_REVIEW: -3,
  CANCEL: -2,
  IM_VIOLATION: -5,
  FLY_ORDER: -20,
} as const;

/** 飞单举报属实奖励（分）＝¥20（= system_configs.report_reward，以券形式发放） */
export const REPORT_REWARD_FEN = 2000;

/** 限流派单阈值（默认值，实际以 system_configs.credit_limit_threshold 为准） */
export const CREDIT_LIMIT_THRESHOLD_DEFAULT = 60;
/** 冻结接单阈值（默认值，实际以 system_configs.credit_freeze_threshold 为准） */
export const CREDIT_FREEZE_THRESHOLD_DEFAULT = 40;

// ---------------------------------------------------------------------------
// 3. 抽成规则（架构 §7.3：以「分」为单位的整数运算，bp 基点快照）
// ---------------------------------------------------------------------------

/** 基点定义：1% = 100bp */
export const BP_PER_PERCENT = 100;

/** 抽成比例下限 5% = 500bp */
export const COMMISSION_RATE_MIN_BP = 500;
/** 抽成比例上限 10% = 1000bp */
export const COMMISSION_RATE_MAX_BP = 1000;
/** 默认抽成 5% = 500bp */
export const COMMISSION_RATE_DEFAULT_BP = 500;

/** 业务边界：陪聊时薪 200–300 元/小时 = 20000–30000 分（产品定价带） */
export const HOURLY_RATE_MIN_FEN = 20000;
export const HOURLY_RATE_MAX_FEN = 30000;

// ---------------------------------------------------------------------------
// 4. 运行期硬约束
// ---------------------------------------------------------------------------

/** 订单支付超时（分钟，架构 §6.1：CREATED 15min 支付超时） */
export const ORDER_PAY_TIMEOUT_MIN = 15;
/** 派单无人接单默认时长（分钟，架构 §6.1；实际以 system_configs 为准） */
export const DISPATCH_TIMEOUT_MIN_DEFAULT = 30;
/** 分账失败重试上限（架构 §6.2/§7.5：≥3 次升级人工工单） */
export const SHARING_RETRY_MAX = 3;
/** 待分账超时告警（天，架构 §7.2：每日扫描「已超 7 天未分账」） */
export const SHARING_STALE_ALERT_DAYS = 7;
/** 微信待分账资金强制处理上限（天，架构 §7.2：微信侧 30 天） */
export const SHARING_WX_DEADLINE_DAYS = 30;
/** 动态码长度（6 位） */
export const DYNAMIC_CODE_LENGTH = 6;
/** 动态码默认 TTL（秒） */
export const DYNAMIC_CODE_TTL_DEFAULT = 300;
/** GPS 模糊化精度范围（米，架构 §6.2 3d / §5.3：精度衰减至 100–300m） */
export const GPS_FUZZY_MIN_M = 100;
export const GPS_FUZZY_MAX_M = 300;
/** 人脸比对通过阈值（默认，实际以 system_configs.face_match_threshold 为准） */
export const FACE_MATCH_THRESHOLD_DEFAULT = 80;
/** 签到 GPS 最大偏差（米，默认，实际以 system_configs.gps_max_deviation 为准） */
export const GPS_MAX_DEVIATION_DEFAULT = 2000;
/** 隐私号服务后保留时长（小时，默认，实际以 system_configs 为准） */
export const PRIVACY_VALID_HOURS_DEFAULT = 24;

/** Token TTL（架构 §3.2/附录 B）：access 2h，refresh 30d */
export const ACCESS_TOKEN_TTL_SEC = 2 * 60 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
/** 后台敏感操作（财务/超管）二次 TOTP 有效期（秒） */
export const TOTP_STEP_SEC = 30;

/** 幂等键缓存时长（小时，架构 §5.2 idem:<key> 24h） */
export const IDEMPOTENCY_TTL_HOURS = 24;
/** Redis 时段锁 TTL（分钟，架构 §5.2：10min，成交转订单） */
export const SLOT_LOCK_TTL_MIN = 10;
/** 抢单互斥锁 TTL（分钟，架构 §5.2） */
export const GRAB_LOCK_TTL_MIN = 5;
/** 系统配置热缓存 TTL（秒，架构 §5.2：5min + 主动失效） */
export const CONFIG_CACHE_TTL_SEC = 5 * 60;

/** 登录限流：5/min（架构附录 B）；后台登录失败锁定 30min */
export const LOGIN_RATE_LIMIT_PER_MIN = 5;
export const ADMIN_LOGIN_LOCK_MIN = 30;
/** 下单限流：10/min（架构附录 B） */
export const ORDER_RATE_LIMIT_PER_MIN = 10;

/** 服务时长边界（分钟）：单次服务最短/最长（MVP 按小时档，1–8 小时） */
export const SERVICE_DURATION_MIN_MINUTES = 60;
export const SERVICE_DURATION_MAX_MINUTES = 480;
/** 服务时长步长（分钟）：按半小时档售卖 */
export const SERVICE_DURATION_STEP_MINUTES = 30;

/** 夜间订单时段（本地时间 22:00–06:00，架构 §10.3） */
export const NIGHT_ORDER_START_HOUR = 22;
export const NIGHT_ORDER_END_HOUR = 6;

/** 注销冷静期（天，架构 §10.1：15 天） */
export const ACCOUNT_CANCEL_COOLDOWN_DAYS = 15;
/** 退出退还保证金无纠纷期（天，架构 §8.3：30 天） */
export const DEPOSIT_REFUND_GRACE_DAYS = 30;

/** 提现单笔限额（分，默认 50000=¥500；财务可调，走 system_configs 扩展位） */
export const WITHDRAW_SINGLE_LIMIT_FEN = 50000;
/** 提现 T+1 审核（架构 §7.5） */
export const WITHDRAW_REVIEW_DELAY_DAYS = 1;

/** 对账 cron 时间（架构 §7.5：每日 03:00） */
export const RECON_CRON_EXPR = '0 3 * * *';
/** 老人语音确认关键词（架构 §6.2 5：老人可语音说「满意」→ ASR 记录） */
export const ELDER_CONFIRM_KEYWORDS = ['满意', '可以', '没问题', '好', '确认'];

// ---------------------------------------------------------------------------
// 5. Redis 键模板（架构 §5.2 全量，服务端 infra/redis 使用）
// ---------------------------------------------------------------------------

export const REDIS_KEYS = {
  /** Token 会话/黑名单校验：sess:<userId> */
  session: (userId: string | number | bigint) => `sess:${userId}`,
  /** 短信验证码：code:<phone> */
  smsCode: (phone: string) => `code:${phone}`,
  /** 时段锁：lock:slot:<companionId>:<slot> */
  slotLock: (companionId: string | number | bigint, slot: string) => `lock:slot:${companionId}:${slot}`,
  /** 抢单互斥：lock:grab:<orderId> */
  grabLock: (orderId: string | number | bigint) => `lock:grab:${orderId}`,
  /** 幂等结果缓存：idem:<key> */
  idempotency: (key: string) => `idem:${key}`,
  /** 附近陪聊员列表：cache:companion:list:<geoHash> */
  companionList: (geoHash: string) => `cache:companion:list:${geoHash}`,
  /** 系统配置热数据：cache:config */
  config: 'cache:config',
  /** 后台登录失败计数：login:fail:<username> */
  adminLoginFail: (username: string) => `login:fail:${username}`,
  /** 分账执行锁（防并发重复分账）：lock:sharing:<orderId> */
  sharingLock: (orderId: string | number | bigint) => `lock:sharing:${orderId}`,
  /** 动态码（核销进行时态，DB 之外的快速校验缓存）：verify:code:<orderId> */
  verifyCode: (orderId: string | number | bigint) => `verify:code:${orderId}`,
} as const;

// ---------------------------------------------------------------------------
// 6. BullMQ 队列名（infra/queue 定义，架构 §3.4）
// ---------------------------------------------------------------------------

export const QUEUE_NAMES = {
  /** 分账执行/重试（架构 §6.2 6a） */
  profitSharing: 'profit-sharing',
  /** 通知发送（订阅消息/短信/IM 系统消息） */
  notification: 'notification',
  /** 支付回调补偿（掉单扫描） */
  payCallback: 'pay-callback',
  /** AI 会话处理（ASR→LLM→TTS 管道重活） */
  aiPipeline: 'ai-pipeline',
  /** AI 抽检任务 */
  aiSample: 'ai-sample',
  /** 每日对账（03:00） */
  reconciliation: 'reconciliation',
  /** 隐私号到期解绑扫描 */
  privacyExpire: 'privacy-expire',
  /** 优惠券/时长卡过期扫描 */
  couponExpire: 'coupon-expire',
  /** 订单超时关单/派单超时扫描 */
  orderTimeout: 'order-timeout',
  /** 待分账超时告警扫描 */
  sharingStale: 'sharing-stale',
  /** IM/AI 内容审核 */
  contentReview: 'content-review',
  /** 活动感知日聚合（架构 §13.7，每日 02:15） */
  activityAggregate: 'activity-aggregate',
  /** 活动原始特征留存清理（架构 §13.7，红线⑥ ≤14 天，每日 03:40） */
  activityRetention: 'activity-retention',
} as const;

// ---------------------------------------------------------------------------
// 7. 业务单号前缀（对外暴露单号，架构/DATABASE.md §2.7）
// ---------------------------------------------------------------------------
//
// 【形态说明 + 调用点标注】（主理人 2026-10 硬要求）
//
//   每条号段必须写清三件事，缺一不可：
//     ① **形态**：<键名> = <落库表>.<列名>（或「不落库，仅内存/日志」）
//     ② **调用点**：<file:line>（实测日期）
//     ③ 若无调用点：**必须写清「为什么不需要」**（不能只写「暂无调用点」）
//
//   **为什么要求这个**（主理人原话）：
//   > 我上一轮吃过「登记了但没有调用点 = 号段空占」的亏（policy/commission 至今是死键）。
//   > 形态说明 + 调用点标注能让「这个号段到底有没有在用」一眼可查，而不是靠翻代码。
//
//   **本表由 `doc:check:configs` 段 6.7 双向核对**：
//     6.7-a 漏登记（用了但未登记）= 0 → ERROR
//     6.7-b 登记未使用（登记了但全库无调用点）→ **已加严为 ERROR（除白名单）**
//   故本表与实际调用点**必须同步**，否则门禁红。
//
//   ⚠️ **camelCase 键名是设计如此**（`riskEvent` / `depositTx` / `healthAlert` 都在），
//   不要「顺手改成 snake_case」—— `BizNoType = keyof typeof BIZ_NO_PREFIX`
//   使 TS 在编译期保证调用点合法，改名会连带改所有 `genBizNo('xxx')` 调用。
//
export const BIZ_NO_PREFIX = {
  // 形态：order = orders.order_no
  // 调用点：apps/server/src/modules/order/order.service.ts:300（2026-10-22 实测）
  order: 'LB',
  // 形态：payment = payments.payment_no（另有 outTradeNo 走微信商户单号，见 payment.service.ts:77）
  // 调用点：apps/server/src/modules/payment/payment.service.ts:80、:77（2026-10-22 实测）
  payment: 'PAY',
  // 形态：sharing = profit_sharing_records.sharing_no；人工工单复用同号空间（manual_ticket_no）
  // 调用点：apps/server/src/modules/payment/payment.service.ts:171、
  //        apps/server/src/adapters/split-executor.ts:187（2026-10-22 实测）
  sharing: 'SHR',
  // 形态：withdrawal = withdrawals.withdrawal_no
  // 调用点：apps/server/src/modules/payment/payment.routes.ts:263（2026-10-22 实测）
  withdrawal: 'WDR',
  // 形态：application = companion_applications.application_no
  // 调用点：apps/server/src/modules/companion/companion.service.ts:143（2026-10-22 实测）
  application: 'APP',
  // 形态：complaint = complaints.complaint_no
  // 调用点：apps/server/src/modules/risk/risk.routes.ts:92、
  //        apps/server/src/modules/activity/alert.service.ts:343（2026-10-22 实测）
  complaint: 'CMP',
  // 形态：report = reports.report_no
  // 调用点：apps/server/src/modules/risk/risk.routes.ts:58（2026-10-22 实测）
  report: 'RPT',
  // 形态：task = ai_sessions.session_no（生成后把 TSK 前缀替换为 AI，见 ai.routes.ts:37）
  // 调用点：apps/server/src/modules/ai/ai.routes.ts:37（2026-10-22 实测）
  task: 'TSK',
  // 形态：batch = payment_batches.batch_no
  // 调用点：apps/server/src/modules/payment/payment.service.ts:503（2026-10-22 实测）
  batch: 'BAT',
  // 形态：card = marketing_cards.card_no
  // 调用点：apps/server/src/modules/marketing/marketing.routes.ts:125（2026-10-22 实测）
  card: 'GC',
  // 🔴 形态：policy = insurance_policies.policy_no
  //
  // 【2026-10-22 实测更正 —— 上一条注释是错的，照旧会误导下一个人】
  //   旧注释写：「保险产品/条款由 system_configs 驱动，不建独立的 policy 单据表」
  //   **实测：`insurance_policies` 表真实存在**（schema.prisma:1559），
  //   有 `policy_no @unique` 唯一索引，且**有完整写入路径**：
  //     modules/insurance/insurance.routes.ts:45 `prisma.insurance_policies.create(...)`
  //   所以「不产生政策单号」是错的——它每天都在产生。
  //
  // 【真缺陷：单号生成绕过了号段体系】
  //   写入时 `policy_no` 来自 **adapter 返回值**，而 adapter 里是硬编码拼接：
  //     adapters/insurance.ts:58
  //     policyNo: `POL${Date.now()}${input.orderNo.slice(-6)}`
  //   **没有任何 genBizNo 调用** → 本键确实是「登记未使用」。
  //   这不只是「号段空占」，而是**同一业务两种单号已经发生**：
  //     adapter 硬编码 POL 开头（无号段规则、无长度约束、无统一入口）
  //     vs BIZ_NO_PREFIX 登记 POL（本键）
  //   将来若有人改用 genBizNo('policy')，两种格式会并存，历史单号无法统一解析。
  //   **正确处置：把 adapter 的硬编码换成 genBizNo('policy')**，接上号段体系。
  //   接入渠道方真实保单号（adapter 返回外部单号）时，须在契约层区分
  //   「我方保单号」与「渠道保单号」两个字段，不要混用一个列。
  policy: 'POL',
  // 形态：distributor = distributors.distributor_no
  //   —— **本期不登记**（主理人 2026-10-22 裁定）。
  //   实测：`distributors` 表存在（schema.prisma:1513），但
  //   `genBizNo('DR')` 全仓 0 命中，且无任何代码创建团长（团长只来自 seed）。
  //   **登记而不实现 = 号段空占**，将来同一业务两种单号分裂。
  //   待分账链路接通后，与调用点同批登记。
  //
  // 形态：commission = commissions.commission_no
  //
  // 【2026-10-22 实测更正 —— 上一条注释也是错的】
  //   旧注释写：「佣金在 profit_sharing_records 内闭环，没有独立的佣金单号业务对象」
  //   **实测**：
  //     ① `commissions` 表存在（schema.prisma:1535），且有
  //        `commission_no @unique` **和** `idempotency_key @unique`（幂等已设计好）；
  //     ② 但 `prisma.commissions` 在 src/ 下**零命中** —— **无任何写入路径**。
  //   所以真实状态是「**已设计未实现**」：表与唯一索引都建好了，没有代码写它。
  //   **危害比「号段空占」更硬**：一旦有人开始写这张表，`commission_no`
  //   没有生成逻辑 → 走默认值 → `@unique` 冲突 → **第二条记录写不进去**。
  //   处置：本键与 commissions 表的写入逻辑（含 durableInvoice 幂等）同批实现。
  //   现进 6.7-b 白名单，理由见 verify-doc-configs.ts 的 BIZ_NO_DEAD_ALLOWLIST。
  commission: 'CMS',
  // 形态：riskEvent = risk_events.event_no
  // 调用点：apps/server/src/modules/risk/risk.routes.ts:167、
  //        apps/server/src/middlewares/outbound-cipher-guard.ts:73（2026-10-22 实测）
  riskEvent: 'RSK',
  // 形态：depositTx = deposit_transactions.tx_no
  // 调用点：apps/server/src/modules/companion/companion.service.ts:280（2026-10-22 实测）
  depositTx: 'DPT',
  // 形态：healthAlert = health_alerts.alert_no（架构 §13；health_alerts.alert_no 唯一索引兜底）
  // 调用点：apps/server/src/modules/activity/alert.service.ts:142（2026-10-22 实测）
  healthAlert: 'HAL',
  // 形态：coupon = coupons.coupon_no（VarChar(32) 唯一）
  // 调用点：apps/server/src/modules/marketing/coupon-admin.service.ts:177（2026-10-22 实测）
  coupon: 'CPN',
} as const;

/** 分账执行模式（架构 §7.5/§7.6，由 system_configs.split_mode 驱动） */
export const SPLIT_MODE = {
  /** 主路径：微信服务商自动分账（默认） */
  WECHAT_PROFIT_SHARING: 'wechat_profit_sharing',
  /** 兜底：平台收款 + 人工结算（仅灰度联调，上线前必须切回主路径） */
  MANUAL_SETTLEMENT_FALLBACK: 'manual_settlement_fallback',
} as const;
export type SplitMode = (typeof SPLIT_MODE)[keyof typeof SPLIT_MODE];
