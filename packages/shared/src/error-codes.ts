// ============================================================================
// 邻伴 · 错误码表（三端 + 服务端共用，架构附录 B：错误响应 { code, message, requestId }）
// ----------------------------------------------------------------------------
// 分段规则（每段 1000，段内留余量）：
//   0     成功
//   10xxx 通用（参数/认证/权限/限流/幂等/资源）
//   11xxx auth    三端登录、Token、后台账密 + TOTP
//   12xxx user    老人档案、子女绑定、家庭关系
//   13xxx companion 入驻四审、信用分、保证金、日程
//   14xxx order   下单/派单/抢单/取消/时段
//   15xxx payment 支付/分账/回退/退款/提现/对账
//   16xxx verification 动态码/人脸/GPS/双向确认
//   17xxx im      会话/消息/隐私号
//   18xxx ai      ASR/LLM/TTS/内容安全
//   19xxx 营销域  评价 190xx / 保险 191xx / 营销 192xx
//   20xxx risk    风控/黑名单/举报/投诉/SOS
//   21xxx admin/support/file 后台/工单/文件
//   22xxx activity 感知采集与上报（健康活动感知，架构 §13）
//   23xxx activity 活动查询与看板
//   24xxx activity 告警处置
//   90xxx 系统级  数据库/缓存/队列/第三方/配置
//
// 号段纪律：14xxx/15xxx/16xxx 已分别被订单/支付/核销占满（各 19/20/11 码全用），
// 感知模块另起 22-24xxx，不得复用既有段（避免三端按段分类时误判）。
// ============================================================================

/** 统一成功码（架构附录 B：{ code: 0, data, requestId }） */
export const CODE_SUCCESS = 0;

export interface ErrorCodeDef {
  /** 机器可读键（与常量名一致） */
  key: string;
  /** 面向用户的中文文案（可直接透传给小程序/后台，禁止暴露内部细节） */
  message: string;
  /** 建议 HTTP 状态码（接入层据此映射） */
  httpStatus: number;
}

/** 错误码注册表：code -> 定义 */
export const ERROR_CODES = {
  // ---- 通用 10xxx ----
  10001: { key: 'PARAM_INVALID', message: '请求参数校验失败', httpStatus: 400 },
  10002: { key: 'UNAUTHORIZED', message: '未登录或登录已过期', httpStatus: 401 },
  10003: { key: 'TOKEN_EXPIRED', message: '访问令牌已过期，请刷新', httpStatus: 401 },
  10004: { key: 'FORBIDDEN', message: '无权限访问', httpStatus: 403 },
  10005: { key: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试', httpStatus: 429 },
  10006: { key: 'IDEMPOTENCY_CONFLICT', message: '重复提交的请求内容不一致', httpStatus: 409 },
  10007: { key: 'NOT_FOUND', message: '资源不存在', httpStatus: 404 },
  10008: { key: 'CONFLICT', message: '资源状态冲突', httpStatus: 409 },
  10009: { key: 'INTERNAL_ERROR', message: '服务开小差了，请稍后再试', httpStatus: 500 },
  10010: { key: 'DEPENDENCY_UNAVAILABLE', message: '依赖服务暂不可用', httpStatus: 503 },

  // ---- auth 11xxx ----
  11001: { key: 'WX_CODE_INVALID', message: '微信 code 无效或已过期', httpStatus: 400 },
  11002: { key: 'WX_LOGIN_FAILED', message: '微信登录失败', httpStatus: 502 },
  11003: { key: 'PHONE_ALREADY_BOUND', message: '手机号已绑定其他账号', httpStatus: 409 },
  11004: { key: 'ACCOUNT_FROZEN', message: '账号已冻结，请联系客服', httpStatus: 403 },
  11005: { key: 'ACCOUNT_CANCELLED', message: '账号已注销', httpStatus: 403 },
  11006: { key: 'ADMIN_LOGIN_FAILED', message: '账号或密码错误', httpStatus: 401 },
  11007: { key: 'TOTP_REQUIRED', message: '该操作需要二次验证', httpStatus: 401 },
  11008: { key: 'TOTP_INVALID', message: '二次验证码错误', httpStatus: 401 },
  11009: { key: 'LOGIN_FAIL_TOO_MANY', message: '登录失败次数过多，请 30 分钟后再试', httpStatus: 429 },

  // ---- user 12xxx ----
  12001: { key: 'ELDER_PROFILE_NOT_FOUND', message: '老人档案不存在', httpStatus: 404 },
  12002: { key: 'FAMILY_BINDING_EXISTS', message: '绑定关系已存在', httpStatus: 409 },
  12003: { key: 'FAMILY_BINDING_NOT_FOUND', message: '绑定关系不存在', httpStatus: 404 },
  12004: { key: 'FAMILY_BINDING_REVOKED', message: '绑定关系已解除', httpStatus: 409 },
  12005: { key: 'FAMILY_BINDING_PENDING', message: '绑定待对方确认', httpStatus: 409 },
  12006: { key: 'ELDER_ONLY', message: '仅老人账号可操作', httpStatus: 403 },

  // ---- companion 13xxx ----
  13001: { key: 'COMPANION_NOT_FOUND', message: '陪聊员不存在', httpStatus: 404 },
  13002: { key: 'APPLICATION_NOT_FOUND', message: '入驻申请不存在', httpStatus: 404 },
  13003: { key: 'APPLICATION_IN_PROGRESS', message: '已有在审申请，请勿重复提交', httpStatus: 409 },
  13004: { key: 'STAGE_ILLEGAL_TRANSITION', message: '四审流程不允许的流转', httpStatus: 409 },
  13005: { key: 'REALNAME_FAILED', message: '实名认证未通过', httpStatus: 422 },
  13006: { key: 'FACE_VERIFY_FAILED', message: '人脸核验未通过', httpStatus: 422 },
  13007: { key: 'EXAM_NOT_PASSED', message: '认证考试未通过（需 ≥80 分）', httpStatus: 422 },
  13008: { key: 'EXAM_ATTEMPTS_EXCEEDED', message: '考试次数已用尽', httpStatus: 409 },
  13009: { key: 'DEPOSIT_NOT_PAID', message: '保证金未缴纳', httpStatus: 409 },
  13010: { key: 'DEPOSIT_INSUFFICIENT', message: '保证金余额不足', httpStatus: 409 },
  13011: { key: 'COMPANION_NOT_ACTIVE', message: '陪聊员未上架或已暂停接单', httpStatus: 409 },
  13012: { key: 'CREDIT_FROZEN', message: '信用分过低，已停止接单', httpStatus: 403 },
  13013: { key: 'ID_CARD_DUPLICATE', message: '该身份证已注册', httpStatus: 409 },
  13014: { key: 'SCHEDULE_NOT_FOUND', message: '日程不存在', httpStatus: 404 },
  13015: { key: 'SCHEDULE_CONFLICT', message: '日程时段冲突', httpStatus: 409 },

  // ---- order 14xxx ----
  14001: { key: 'ORDER_NOT_FOUND', message: '订单不存在', httpStatus: 404 },
  14002: { key: 'ORDER_STATUS_ILLEGAL', message: '订单状态不允许该操作', httpStatus: 409 },
  14003: { key: 'SLOT_OCCUPIED', message: '该时段已被占用', httpStatus: 409 },
  14004: { key: 'SLOT_LOCK_FAILED', message: '时段锁竞争失败，请重试', httpStatus: 409 },
  14005: { key: 'PAY_TIMEOUT', message: '支付超时，订单已关单', httpStatus: 409 },
  14006: { key: 'NIGHT_ORDER_DISABLED', message: '夜间订单暂未开放', httpStatus: 403 },
  14007: { key: 'NIGHT_ORDER_NEED_CONFIRM', message: '夜间订单需子女端确认', httpStatus: 409 },
  14008: { key: 'DISPATCH_NO_CANDIDATE', message: '附近暂无合适陪聊员', httpStatus: 409 },
  14009: { key: 'DISPATCH_TIMEOUT', message: '派单超时无人接单', httpStatus: 409 },
  14010: { key: 'NOT_ORDER_COMPANION', message: '非本单接单陪聊员', httpStatus: 403 },
  14011: { key: 'ORDER_CANCELLED', message: '订单已取消', httpStatus: 409 },
  14012: { key: 'ORDER_NOT_PAID', message: '订单未支付', httpStatus: 409 },
  14013: { key: 'ORDER_NOT_ACCEPTED', message: '订单未被接单', httpStatus: 409 },
  14014: { key: 'CANCEL_FORBIDDEN', message: '当前状态不允许取消', httpStatus: 409 },
  14015: { key: 'AMOUNT_MISMATCH', message: '订单金额不一致', httpStatus: 409 },
  14016: { key: 'SELF_COMPANION_ORDER', message: '陪聊员账号不能下单', httpStatus: 403 },
  14017: { key: 'SERVICE_DATE_PAST', message: '服务时间已过', httpStatus: 400 },
  14018: { key: 'GRAB_LOCK_FAILED', message: '抢单竞争失败，请重试', httpStatus: 409 },
  14019: { key: 'ORDER_HAS_ACTIVE_VERIFICATION', message: '订单存在进行中的核销', httpStatus: 409 },

  // ---- payment 15xxx ----
  15001: { key: 'PAYMENT_NOT_FOUND', message: '支付单不存在', httpStatus: 404 },
  15002: { key: 'PAYMENT_ALREADY_SUCCESS', message: '支付单已是成功态', httpStatus: 409 },
  15003: { key: 'WX_PREPAY_FAILED', message: '微信下单失败', httpStatus: 502 },
  15004: { key: 'WX_NOTIFY_INVALID', message: '微信回调验签失败', httpStatus: 400 },
  15005: { key: 'SHARING_RECORD_NOT_FOUND', message: '分账记录不存在', httpStatus: 404 },
  15006: { key: 'SHARING_GATE_BLOCKED', message: '分账校验未通过，已暂停并告警', httpStatus: 409 },
  15007: { key: 'SHARING_STATUS_ILLEGAL', message: '分账记录状态不允许该操作', httpStatus: 409 },
  15008: { key: 'SHARING_RETRY_EXHAUSTED', message: '分账重试已达上限，已升级人工工单', httpStatus: 409 },
  15009: { key: 'SHARING_EXECUTE_FAILED', message: '分账执行失败', httpStatus: 502 },
  15010: { key: 'WX_UNFREEZE_FAILED', message: '解除待分账失败', httpStatus: 502 },
  15011: { key: 'REFUND_NOT_ALLOWED', message: '当前状态不允许退款', httpStatus: 409 },
  15012: { key: 'REFUND_AMOUNT_EXCEEDED', message: '退款金额超出可退额度', httpStatus: 409 },
  15013: { key: 'WX_REFUND_FAILED', message: '微信退款失败', httpStatus: 502 },
  15014: { key: 'WITHDRAWAL_NOT_FOUND', message: '提现单不存在', httpStatus: 404 },
  15015: { key: 'WITHDRAWAL_LIMIT_EXCEEDED', message: '提现金额超出限额', httpStatus: 409 },
  15016: { key: 'WITHDRAWAL_NEED_VERIFY', message: '提现需完成人脸/短信二次验证', httpStatus: 409 },
  15017: { key: 'WITHDRAWAL_STATUS_ILLEGAL', message: '提现单状态不允许该操作', httpStatus: 409 },
  15018: { key: 'SPLIT_MODE_UNSUPPORTED', message: '当前结算模式不支持该操作', httpStatus: 409 },
  15019: { key: 'RECON_DIFF_FOUND', message: '对账发现差异，需人工处理', httpStatus: 409 },
  15020: { key: 'RECON_ALREADY_RUNNING', message: '对账批次已在进行中', httpStatus: 409 },

  // ---- verification 16xxx ----
  16001: { key: 'VERIFICATION_NOT_FOUND', message: '核销记录不存在', httpStatus: 404 },
  16002: { key: 'DYNAMIC_CODE_INVALID', message: '动态码不正确', httpStatus: 400 },
  16003: { key: 'DYNAMIC_CODE_EXPIRED', message: '动态码已过期', httpStatus: 409 },
  16004: { key: 'DYNAMIC_CODE_TOO_MANY', message: '动态码错误次数过多', httpStatus: 429 },
  16005: { key: 'FACE_SCORE_TOO_LOW', message: '人脸比对未通过', httpStatus: 422 },
  16006: { key: 'LIVENESS_FAILED', message: '活体检测未通过', httpStatus: 422 },
  16007: { key: 'GPS_DEVIATION_TOO_LARGE', message: '签到位置偏离服务地址过远', httpStatus: 422 },
  16008: { key: 'VERIFICATION_ALREADY_PASSED', message: '核销已通过，请勿重复提交', httpStatus: 409 },
  16009: { key: 'VERIFICATION_EXPIRED', message: '核销已过期', httpStatus: 409 },
  16010: { key: 'BOTH_CONFIRM_REQUIRED', message: '需双方确认后才能完成订单', httpStatus: 409 },
  16011: { key: 'COMPLETION_ALREADY_CONFIRMED', message: '您已确认过，等待对方确认', httpStatus: 409 },

  // ---- im 17xxx ----
  17001: { key: 'CONVERSATION_NOT_FOUND', message: '会话不存在', httpStatus: 404 },
  17002: { key: 'CONVERSATION_CLOSED', message: '会话已关闭', httpStatus: 409 },
  17003: { key: 'MESSAGE_BLOCKED', message: '消息包含违规内容，已被拦截', httpStatus: 422 },
  17004: { key: 'PRIVACY_BINDING_NOT_FOUND', message: '隐私号绑定不存在', httpStatus: 404 },
  17005: { key: 'PRIVACY_BINDING_EXPIRED', message: '隐私号绑定已过期', httpStatus: 409 },
  17006: { key: 'PRIVACY_BINDING_EXISTS', message: '隐私号绑定已存在', httpStatus: 409 },
  17007: { key: 'IM_CONTENT_REJECTED', message: '内容审核未通过', httpStatus: 422 },

  // ---- ai 18xxx ----
  18001: { key: 'AI_SESSION_NOT_FOUND', message: 'AI 会话不存在', httpStatus: 404 },
  18002: { key: 'ASR_FAILED', message: '语音识别失败，请重试', httpStatus: 502 },
  18003: { key: 'TTS_FAILED', message: '语音合成失败，请重试', httpStatus: 502 },
  18004: { key: 'LLM_UNAVAILABLE', message: '陪聊助手暂不可用', httpStatus: 503 },
  18005: { key: 'AI_CONTENT_BLOCKED', message: '内容安全拦截', httpStatus: 422 },
  18006: { key: 'CRISIS_DETECTED', message: '检测到异常情绪信号，已通知人工跟进', httpStatus: 200 },
  18007: { key: 'AI_QUOTA_EXCEEDED', message: '今日陪聊次数已用完', httpStatus: 429 },

  // ---- review 190xx ----
  19001: { key: 'REVIEW_ALREADY_EXISTS', message: '本单该方向已评价', httpStatus: 409 },
  19002: { key: 'REVIEW_NOT_FOUND', message: '评价不存在', httpStatus: 404 },
  19003: { key: 'REVIEW_WINDOW_CLOSED', message: '评价窗口已关闭', httpStatus: 409 },

  // ---- insurance 191xx ----
  19101: { key: 'POLICY_NOT_FOUND', message: '保单不存在', httpStatus: 404 },
  19102: { key: 'POLICY_ALREADY_BOUND', message: '订单已绑定保单', httpStatus: 409 },
  19103: { key: 'POLICY_STATUS_ILLEGAL', message: '保单状态不允许该操作', httpStatus: 409 },
  19104: { key: 'CLAIM_NOT_ALLOWED', message: '当前保单不可理赔', httpStatus: 409 },

  // ---- marketing 192xx ----
  19201: { key: 'GIFT_CARD_NOT_FOUND', message: '时长卡不存在', httpStatus: 404 },
  19202: { key: 'GIFT_CARD_BALANCE_INSUFFICIENT', message: '时长卡余额不足', httpStatus: 409 },
  19203: { key: 'GIFT_CARD_EXPIRED', message: '时长卡已过期', httpStatus: 409 },
  19204: { key: 'COUPON_NOT_FOUND', message: '优惠券不存在', httpStatus: 404 },
  19205: { key: 'COUPON_NOT_AVAILABLE', message: '优惠券不可用', httpStatus: 409 },
  19206: { key: 'COUPON_ALREADY_USED', message: '优惠券已使用', httpStatus: 409 },
  19207: { key: 'COUPON_MIN_SPEND', message: '未达到优惠券使用门槛', httpStatus: 409 },

  // ---- risk 20xxx ----
  20001: { key: 'BLACKLISTED', message: '账号存在异常，操作已被限制', httpStatus: 403 },
  20002: { key: 'RISK_EVENT_PENDING', message: '订单存在未处理的风控工单', httpStatus: 409 },
  20003: { key: 'RISK_EVENT_NOT_FOUND', message: '风控事件不存在', httpStatus: 404 },
  20004: { key: 'REPORT_NOT_FOUND', message: '举报不存在', httpStatus: 404 },
  20005: { key: 'REPORT_ALREADY_HANDLED', message: '举报已处理', httpStatus: 409 },
  20006: { key: 'REPORT_SELF_FORBIDDEN', message: '不能举报自己', httpStatus: 400 },
  20007: { key: 'COMPLAINT_NOT_FOUND', message: '投诉不存在', httpStatus: 404 },
  20008: { key: 'COMPLAINT_ALREADY_HANDLED', message: '投诉已处理', httpStatus: 409 },

  // ---- admin/support/file 21xxx ----
  21001: { key: 'ADMIN_NOT_FOUND', message: '后台账号不存在', httpStatus: 404 },
  21002: { key: 'ADMIN_FROZEN', message: '后台账号已冻结', httpStatus: 403 },
  21003: { key: 'CONFIG_KEY_INVALID', message: '配置项不存在或不允许修改', httpStatus: 400 },
  21004: { key: 'FILE_NOT_FOUND', message: '文件不存在', httpStatus: 404 },
  21005: { key: 'STS_ISSUE_FAILED', message: '上传授权签发失败', httpStatus: 502 },
  21006: { key: 'SUPPORT_TICKET_NOT_FOUND', message: '工单不存在', httpStatus: 404 },

  // ---- activity 感知采集与上报 22xxx（架构 §13；原始值不入库，红线②） ----
  22001: { key: 'ACTIVITY_CONSENT_REQUIRED', message: '未开启健康活动感知授权，无法采集', httpStatus: 403 },
  22002: { key: 'ACTIVITY_DEVICE_NOT_BOUND', message: '感知设备未绑定', httpStatus: 409 },
  22003: { key: 'ACTIVITY_DEVICE_OFFLINE', message: '感知设备离线', httpStatus: 409 },
  22004: { key: 'ACTIVITY_FEATURE_INVALID', message: '上报特征格式不合法', httpStatus: 400 },
  22005: { key: 'ACTIVITY_CHANNEL_AUTH_FAILED', message: '设备令牌校验失败', httpStatus: 401 },
  22006: { key: 'ACTIVITY_COLLECTION_STOPPED', message: '采集已停止（本人已关闭健康活动感知）', httpStatus: 403 },

  // ---- activity 活动查询与看板 23xxx ----
  23001: { key: 'ACTIVITY_DATA_NOT_READY', message: '感知数据尚未就绪（需 3–7 天积累）', httpStatus: 409 },
  23002: { key: 'ACTIVITY_CONFIDENCE_TOO_LOW', message: '数据置信度不足，结论仅供参考', httpStatus: 409 },
  23003: { key: 'ACTIVITY_DATE_RANGE_INVALID', message: '日期范围不合法', httpStatus: 400 },
  23004: { key: 'ACTIVITY_ACCESS_DENIED', message: '无权查看该老人的健康活动数据', httpStatus: 403 },
  23005: { key: 'ACTIVITY_SUMMARY_NOT_FOUND', message: '暂无活动日报', httpStatus: 404 },

  // ---- activity 告警处置 24xxx ----
  24001: { key: 'ACTIVITY_ALERT_NOT_FOUND', message: '健康告警不存在', httpStatus: 404 },
  24002: { key: 'ACTIVITY_ALERT_ALREADY_HANDLED', message: '该告警已处置', httpStatus: 409 },
  24003: { key: 'ACTIVITY_ALERT_SUPPRESSED', message: '同类告警处于抑制窗口内，不重复推送', httpStatus: 409 },
  24004: { key: 'ACTIVITY_CROSS_VERIFY_INSUFFICIENT', message: '交叉验证不足，需人工确认', httpStatus: 409 },
  24005: { key: 'ACTIVITY_ALERT_ESCALATE_FAILED', message: '告警升级失败', httpStatus: 500 },
  24006: { key: 'ACTIVITY_ALERT_LEVEL_INVALID', message: '告警级别与触发条件不匹配（单通道不得直接产出 URGENT）', httpStatus: 400 },
  24007: { key: 'ACTIVITY_ALERT_TRANSITION_INVALID', message: '告警状态不允许该流转', httpStatus: 409 },

  // ---- 系统级 90xxx ----
  90001: { key: 'DB_ERROR', message: '数据库服务异常', httpStatus: 500 },
  90002: { key: 'REDIS_ERROR', message: '缓存服务异常', httpStatus: 500 },
  90003: { key: 'QUEUE_ERROR', message: '任务队列异常', httpStatus: 500 },
  90004: { key: 'THIRD_PARTY_ERROR', message: '第三方服务异常', httpStatus: 502 },
  90005: { key: 'CONFIG_MISSING', message: '系统配置缺失', httpStatus: 500 },
} as const;

/** 错误码联合类型（数字字面量） */
export type ErrorCode = keyof typeof ERROR_CODES;

/** 错误码 key 联合类型（字符串字面量，日志与前端判断用） */
export type ErrorCodeKey = (typeof ERROR_CODES)[ErrorCode]['key'];

/** 查询错误码定义；未知 code 回落 10009 */
export function getErrorDef(code: number): ErrorCodeDef {
  return (ERROR_CODES as Record<number, ErrorCodeDef>)[code] ?? ERROR_CODES[10009];
}

/** 由 key 反查 code（不存在返回 undefined） */
export function codeByKey(key: ErrorCodeKey): number | undefined {
  for (const [code, def] of Object.entries(ERROR_CODES)) {
    if (def.key === key) return Number(code);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AppError：三端共用的受控异常（领域/服务层抛出，接入层统一转换响应）
// ---------------------------------------------------------------------------

/** 业务受控异常：携带错误码 + 可选覆盖文案 + 可选附加数据 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly key: string;
  readonly httpStatus: number;
  /** 覆盖默认文案（运营可解释的细化说明，不暴露内部堆栈） */
  readonly detail?: string;
  /** 附加数据（如分账门闩未过的具体原因列表） */
  readonly payload?: Record<string, unknown>;

  constructor(code: ErrorCode, detail?: string, payload?: Record<string, unknown>) {
    const def = getErrorDef(code);
    super(detail ? `${def.message}（${detail}）` : def.message);
    this.name = 'AppError';
    this.code = code;
    this.key = def.key;
    this.httpStatus = def.httpStatus;
    this.detail = detail;
    this.payload = payload;
  }
}

/** 快速构造：new AppError(14001) 等价于 errOrder(14001) */
export function appError(code: ErrorCode, detail?: string, payload?: Record<string, unknown>): AppError {
  return new AppError(code, detail, payload);
}

/** 判断未知异常是否 AppError（接入层据此区分「受控业务错误」与「系统错误」） */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

// ---------------------------------------------------------------------------
// 统一响应结构（架构附录 B）
// ---------------------------------------------------------------------------

/** 成功响应 */
export interface ApiOk<T = unknown> {
  code: 0;
  data: T;
  requestId: string;
}

/** 失败响应 */
export interface ApiErr {
  code: ErrorCode;
  message: string;
  requestId: string;
  /** 附加数据（可选，如门闩阻塞原因） */
  data?: Record<string, unknown>;
}
