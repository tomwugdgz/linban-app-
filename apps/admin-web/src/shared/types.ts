// ============================================================================
// DTO 类型（与 schema.prisma 字段对齐；金额一律字符串「分」，BigInt 经 API 序列化）
// 待 packages/shared 交付后替换为 @linban/shared 同名类型。
// ============================================================================

export interface AdminInfo {
  id: string;
  username: string;
  realName: string;
  phoneMasked?: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: 'ACTIVE' | 'FROZEN';
  lastLoginAt?: string;
}

export interface LoginResult {
  adminToken: string;
  admin: AdminInfo;
  permissions: string[];
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

/**
 * 🔴 订阅营收明细表上限，须与 `apps/server/.../revenue.service.ts:85` 的
 * `DETAIL_LIMIT` **逐字一致**（500）。
 *
 * **为什么前端要抄这个常量**：服务端超限会 slice 明细，但**当前没有回 truncated 标记**
 * —— 它的注释写「超限截断并置 truncated」，实际返回对象里没这个字段。
 * 「明细是否被截断」这个信息在接口层丢失，前端只能按「条数正好等于上限」兜底判断。
 * 已报霍承钧补出参字段；字段到位后**本常量应删除**，改读服务端返回值。
 *
 * ⚠️ 兜底**必然有误差**：真截断且恰好 500 条时会误报。仍要兜的理由是
 * 漏报代价更大——本页用途是「财务逐笔复核」，静默少显示会让财务以为看到了全量。
 *
 * **为什么放本文件而不是 `@/shared/constants`**：那个文件含 `import.meta.env`
 * （USE_MOCK），**Node 侧 import 会崩**（esbuild 打出的 mock server 会炸）。
 * 本文件无 env 依赖，mock 与页面都能安全引用。这条边界由 smoke.mjs 断言守着。
 */
export const REVENUE_DETAIL_LIMIT = 500;

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 🔴 应用层筛选端点的分页出参（契约 §5.7.7已知限制）。
 *
 * `operator` / `keyword` 只能应用层筛（audit_logs 无对应列），所以服务端须设
 * 候选集上限 500并回 `truncated: boolean`。**契约明文要求**：
 * ① `truncated === true` 时前端必须提示「请收紧筛选条件」；
 * ② **不得把候选集条数当成 `total` 展示** —— 否则运营会以为全库只有这么多条变更。
 *
 *为什么单独开类型而不是给 `PageResult` 加可选字段：
 * `total` 在这些端点上语义已经变了（是「候选集条数」不是「全库条数」），
 * 加成可选字段等于让所有端点都能合法忽略它—— 而这正是契约要防的那件事。
 * 类型上分开，漏读`truncated` 会是编译错误而不是运行时静默。
 */
export interface TruncatedPageResult<T> extends PageResult<T> {
  /** 候选集被截断（服务端候选集上限 500）。true 时 total 不可当全库条数展示。 */
  truncated: boolean;
}

// ---- 看板 ----
export interface DashboardMetrics {
  gmvFen: string;            // GMV（订单实收合计，分）
  orderCount: number;        // 订单量
  frozenSharingFen: string;  // 分账冻结额（待分账，分）
  profitIncomeFen: string;   // 平台分账收入（抽成，分）
  activeCompanions: number;  // 活跃陪聊员
  verificationPassRate: number; // 核销通过率（0–100）
  riskEventCount: number;    // 待处置风控事件数
}
export interface TrendPoint {
  date: string;              // yyyy-MM-dd
  gmvFen: string;
  orderCount: number;
  profitFen: string;
}
export interface DashboardTodo {
  pendingApplications: number;
  pendingWithdrawals: number;
  pendingComplaints: number;
  pendingRiskEvents: number;
  pendingReports: number;
}

// ---- 分账 ----
export interface ProfitSharingRecord {
  id: string;
  sharingNo: string;
  orderId: string;
  orderNo: string;
  paymentId: string;
  status: string;
  frozenAmountFen: string;
  platformCommissionFen: string;
  companionIncomeFen: string;
  commissionRateBp: number;
  companionName?: string;
  wxTransactionId: string;
  wxSharingOrderNo?: string;
  sharedAt?: string;
  returnAmountFen: string;
  wxReturnNo?: string;
  returnedAt?: string;
  returnReason?: string;
  retryCount: number;
  lastError?: string;
  manualTicketNo?: string;
  createdAt: string;
}

export interface SystemConfig {
  configKey: string;
  configValue: string;
  valueType: string; // STRING/INT/BOOL/DECIMAL
  description?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface Withdrawal {
  id: string;
  withdrawalNo: string;
  companionId: string;
  companionName: string;
  amountFen: string;
  feeFen: string;
  actualAmountFen: string;
  bankName: string;
  bankAccountMasked: string;
  accountNameMasked: string;
  status: string;
  faceVerified: boolean;
  smsVerified: boolean;
  rejectReason?: string;
  wxBatchNo?: string;
  createdAt: string;
  reviewedAt?: string;
}
export interface ReconDiffItem {
  bizNo: string;
  local: string;
  wx: string;
  reason: string;
}
export interface ReconciliationRecord {
  id: string;
  batchNo: string;
  batchDate: string;
  channel: string;
  localCount: number;
  localAmountFen: string;
  wxCount: number;
  wxAmountFen: string;
  matchCount: number;
  diffCount: number;
  diffAmountFen: string;
  status: string;
  diffDetail?: ReconDiffItem[];
  resolveNote?: string;
  resolvedAt?: string;
  createdAt: string;
}

// ---- 陪聊员 ----
export interface CompanionApplication {
  id: string;
  applicationNo: string;
  companionId: string;
  companionName: string;      // 脱敏姓名
  phoneMasked: string;
  stage: string;
  // ① 实名
  realnameStatus: string;
  realnameReviewerId?: string;
  realnameReviewedAt?: string;
  realnameComment?: string;
  realnameOcrBizId?: string;
  // ② 人脸
  faceStatus: string;
  faceScore?: number;
  faceComment?: string;
  faceVerifyId?: string;
  facePhotoUrl?: string;      // 预签名 URL（仅审核岗可见，L4 记审计）
  // ③ 无犯罪记录
  criminalStatus: string;
  criminalComment?: string;
  criminalMaterialUrl?: string;
  // 培训/考试
  trainingCompletedAt?: string;
  examScore?: number;
  examAttemptNo: number;
  // ④ 保证金
  depositAmountFen?: string;
  depositPaidAt?: string;
  submittedAt: string;
  decidedAt?: string;
  rejectReason?: string;
}

export interface Companion {
  id: string;
  userId: string;
  nameMasked: string;
  phoneMasked: string;
  status: string;
  level: number;
  creditScore: number;
  hourlyRateFen: string;
  serviceRadiusM: number;
  tags: string[];
  ratingAvg: number;
  ratingCount: number;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  depositBalanceFen: string;
  createdAt: string;
}

export interface BlacklistItem {
  id: string;
  targetType: string; // USER/COMPANION/DEVICE
  targetId: string;
  targetNameMasked: string;
  deviceFingerprint?: string;
  reason: string;
  scope: string;
  status: string;
  expiresAt?: string;
  liftedAt?: string;
  liftReason?: string;
  createdAt: string;
}

// ---- 订单 ----
export interface OrderTimelineItem {
  id: string;
  fromStatus?: string;
  toStatus: string;
  action: string;
  operatorType: string;
  operatorId?: string;
  operatorName?: string;
  reason?: string;
  createdAt: string;
}
export interface OrderVerification {
  id: string;
  type: string;
  status: string;
  attemptNo: number;
  dynamicCode?: string;
  codeMode?: string;
  faceScore?: number;
  facePassed?: boolean;
  livenessScore?: number;
  gpsDeviationM?: number;
  arrivedAt?: string;
  companionConfirmedAt?: string;
  elderConfirmedAt?: string;
  elderVoiceAsr?: string;
  failReason?: string;
  createdAt: string;
}
export interface OrderSharingBrief {
  id: string;
  sharingNo: string;
  status: string;
  frozenAmountFen: string;
  platformCommissionFen: string;
  companionIncomeFen: string;
  commissionRateBp: number;
  createdAt: string;
}
export interface Order {
  id: string;
  orderNo: string;
  status: string;
  serviceType: string;
  durationMinutes: number;
  serviceDate: string;
  slotStart: string;
  slotEnd: string;
  hourlyRateFen: string;
  originalAmountFen: string;
  couponDeductFen: string;
  giftCardDeductFen: string;
  totalAmountFen: string;
  elderNameMasked: string;
  elderPhoneMasked: string;
  companionNameMasked?: string;
  addressMasked: string;
  distanceM: number;
  nightOrder: boolean;
  cancelReason?: string;
  refundAmountFen: string;
  remark?: string;
  createdAt: string;
  completedAt?: string;
}
export interface OrderDetail extends Order {
  timeline: OrderTimelineItem[];
  verifications: OrderVerification[];
  sharings: OrderSharingBrief[];
}

// ---- 裂变营销 ----
export interface GiftCard {
  id: string;
  cardNo: string;
  buyerNameMasked: string;
  recipientNameMasked: string;
  boundUserNameMasked?: string;
  faceAmountFen: string;
  durationMinutes: number;
  balanceAmountFen: string;
  balanceDurationMinutes: number;
  status: string;
  message?: string;
  purchasedAt: string;
  boundAt?: string;
  expiresAt?: string;
}
export interface Distributor {
  id: string;
  distributorNo: string;
  name: string;
  phoneMasked: string;
  communityName: string;
  inviteCode: string;
  status: string;
  totalCommissionFen: string;
  settledCommissionFen: string;
  pendingCommissionFen: string;
  createdAt: string;
}
export interface Commission {
  id: string;
  commissionNo: string;
  distributorId: string;
  distributorName: string;
  orderNo?: string;
  relatedUserNameMasked?: string;
  type: string;
  amountFen: string;
  status: string;
  settledAt?: string;
  paidAt?: string;
  createdAt: string;
}
/**
 * 券模板（schema:1421 coupons）。
 *
 * 金额铁律：`minSpendFen` 是字符串（后端 BigInt 分，JSON 不可用 number 承载）。
 * `value` 的单位随 `type` 变——满减=分 / 时长=分钟，**不可跨类型相加**，
 * 展示前先查 COUPON_VALUE_UNIT 决定列头与格式化方式。
 */
export interface Coupon {
  id: string;
  couponNo: string;
  name: string;
  type: string;
  /** 满减=减免分；时长=抵扣分钟。展示必须带单位，见 COUPON_VALUE_UNIT */
  value: number;
  minSpendFen: string;
  validDays: number;
  totalCount: number;
  claimedCount: number;
  usedCount: number;
  status: string;
  /** 适用范围规则（Json，服务类型 / 金额段），未设=全量可用 */
  scopeRules?: string;
  startAt?: string;
  endAt?: string;
  createdAt?: string;
  updatedAt?: string;
}
/** 新建/编辑券的入参：金额类一律字符串传分，避免前端先 Number 再乘 100 */
export interface CouponInput {
  name: string;
  type: string;
  value: number | string;
  minSpendFen: number | string;
  validDays: number;
  totalCount: number;
  scopeRules?: string;
  startAt?: string;
  endAt?: string;
}
export interface UserCoupon {
  id: string;
  couponName: string;
  userNameMasked: string;
  status: string;
  source: string;
  usedOrderNo?: string;
  receivedAt: string;
  expiredAt?: string;
}
export interface InviteRule {
  id: string;
  name: string;
  rewardType: 'COUPON' | 'BALANCE';
  rewardValue: string;        // 券 id 或金额（分）
  inviteeCondition: string;   // 被邀请人条件说明
  enabled: boolean;
  updatedAt?: string;
}

// ---- 风控 ----
export interface Complaint {
  id: string;
  complaintNo: string;
  complainantNameMasked: string;
  complainantRole: string;
  targetType: string;
  targetId: string;
  orderNo?: string;
  type: string;
  priority: string;
  description: string;
  status: string;
  handlerName?: string;
  compensationAmountFen: string;
  resultNote?: string;
  createdAt: string;
  handledAt?: string;
}
export interface Report {
  id: string;
  reportNo: string;
  reporterNameMasked: string;
  reporterRole: string;
  targetType: string;
  targetId: string;
  targetNameMasked: string;
  orderNo?: string;
  type: string;
  description: string;
  status: string;
  rewardStatus: string;
  rewardAmountFen: string;
  handlerName?: string;
  handleNote?: string;
  createdAt: string;
  handledAt?: string;
}
export interface SamplingTask {
  id: string;
  taskNo: string;
  targetType: string;   // AI_SESSION / IM_MESSAGE / REVISIT
  targetRef: string;    // 会话号/消息ID/回访任务号
  subjectNameMasked: string;
  sampleRate: number;
  status: string;       // PENDING/REVIEWED
  contentPreview: string;
  reviewerName?: string;
  reviewResult?: string; // PASS/REJECT
  createdAt: string;
  reviewedAt?: string;
}
export interface RiskEvent {
  id: string;
  eventNo: string;
  type: string;
  level: string;
  subjectType: string;
  subjectId: string;
  subjectNameMasked: string;
  orderNo?: string;
  ruleCode: string;
  hitDetail?: string;
  status: string;
  actionTaken?: string;
  handlerName?: string;
  handleNote?: string;
  createdAt: string;
  handledAt?: string;
}

// ---- 系统管理 ----
export interface PermissionItem {
  id: string;
  permKey: string;
  module: string;
  name: string;
  description?: string;
}
export interface RoleItem {
  id: string;
  roleKey: string;
  name: string;
  description?: string;
  isSystem: boolean;
  adminCount: number;
  permissions: string[];
}
export interface AdminAccount {
  id: string;
  username: string;
  realName: string;
  phoneMasked?: string;
  roleId: string;
  roleName: string;
  status: string;
  lastLoginAt?: string;
  createdAt: string;
}
export interface AuditLog {
  id: string;
  adminId?: string;
  adminName: string;
  action: string;
  module: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  ip?: string;
  createdAt: string;
}

// ---- 客服 / 台账（契约 5.5 / 5.6）----
export interface DispatchTimeoutItem {
  id: string;
  orderNo: string;
  elderNameMasked: string;
  serviceDate: string;
  slotStart: string;
  createdAt: string;
  waitMinutes: number;
}
export interface RevisitItem {
  id: string;
  orderNo: string;
  elderNameMasked: string;
  completedAt: string;
  revisitStatus: string;
}
export interface PolicyItem {
  id: string;
  policyNo: string;
  orderNo: string;
  elderNameMasked: string;
  companionNameMasked: string;
  amountFen: string;
  status: string;
  createdAt: string;
}
export interface FileItem {
  id: string;
  fileType: string;
  bizType: string;
  bizId: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
}
export interface SweepStaleResult {
  sweptCount: number;
  sweptAmountFen: string;
}
export interface GrantResult {
  granted: number;
}
export interface SettleAllResult {
  settledCount: number;
  settledAmountFen: string;
}

// ============================================================================
// 健康活动感知（契约 §10 / 架构 §13 / PRD MODULE-ACTIVITY-SENSE.md）
// 隐私约束：所有出参为聚合值，禁止携带原始特征（SSID/BSSID/MAC/实时轨迹）；
// 老人标识一律脱敏（王**·72岁），运营在后台看到的即老人端可见的。
// ============================================================================

/** 看板概览（GET /admin/activity/dashboard） */
export interface ActivityDashboard {
  /** 在管老人数（已授权感知且设备在册） */
  managedElderCount: number;
  /** 探针在线 / 离线 / 待首次心跳 */
  probeOnlineCount: number;
  probeOfflineCount: number;
  probePendingCount: number;
  /** 设备在线率（0–100） */
  deviceOnlineRate: number;
  /** 今日告警：未处置 / 已处置 / 误报（分色展示） */
  todayAlertUnhandled: number;
  todayAlertHandled: number;
  todayAlertDismissed: number;
  /** 告警处理时效（分钟）：平均首次响应时长 */
  avgHandleMinutes: number;
  /** URGENT 告警未处置数（>0 时页面顶部强提示，等同 P0） */
  urgentUnhandledCount: number;
  /** 近 7 日活跃趋势（按状态的每日老人数） */
  trend: ActivityTrendPoint[];
  /** 活跃时段分布（0–23 时在线老人数），用于判断「什么时候该派单」 */
  activeSlots: { hour: number; activeElderCount: number }[];
}

export interface ActivityTrendPoint {
  date: string;
  activeCount: number;
  lowCount: number;
  stillCount: number;
  awayCount: number;
  unknownCount: number;
}

/** 老人活动列表行（GET /admin/activity/elders） */
export interface ActivityElderRow {
  id: string;
  /** 脱敏昵称（王**）+ 年龄段，如「王**·72 岁」 */
  elderNameMasked: string;
  age: number;
  /**
   * 所属社区（脱敏到小区名，不含门牌）。
   * A7 社区字段：主理人裁定走独立 `communities` 表 + `elder_profiles.community_id` 外键。
   * **null 是正常业务态**——老人档案可能确实没填社区，不是数据错误，页面须中性灰呈现，
   * 且与 UNKNOWN 分区（「信号不可判读」）语义区分：这里是「档案没填」，那里是「判读不出」。
   */
  community: string | null;
  /** 最近活动状态（ACTIVITY_STATUS 五态） */
  status: string;
  /** 置信度 0–1（单通道上限 0.6，PRD 红线①） */
  confidence: number;
  /** 依据码（可审计，落 explain_code 列） */
  explainCode: string;
  /** 最近信号时间（ISO-8601 UTC）；用于判断新鲜度 */
  lastSignalAt?: string;
  /** 最近有效信号距今秒数；超过 activity_signal_ttl 视为数据过期 */
  freshnessSec: number;
  /** 数据是否已过期（新鲜度超 TTL）→ 列表须标「数据过期」 */
  stale: boolean;
  /** UNKNOWN 原因（数据不足时必填，如「有效采集窗口仅 3 分钟」），禁止空着混进正常列表 */
  unknownReason?: string;
  /** 近 7 日活跃折线（sparkline 数据点：每日活跃分钟） */
  sparkline: number[];
  /** 探针状态（WIFI_DEVICE_STATUS） */
  deviceStatus: string;
  consentStatus: string;
  /** 子女可见范围档位 */
  consentScopeLevel: string;
  /** 30 日内陪聊下单数（关联订单归因，非实时轨迹） */
  orderCount30d: number;
}

/** 告警工作台行（GET /admin/activity/alerts） */
export interface HealthAlertRow {
  id: string;
  alertNo: string;
  elderId: string;
  elderNameMasked: string;
  /** 所属社区（同 A7：null 为「档案未关联」，正常业务态） */
  community: string | null;
  /** 告警类型（HEALTH_ALERT_TYPE） */
  type: string;
  /** 级别（REMIND/WARN/URGENT） */
  level: string;
  status: string;
  confidence: number;
  /** 依据码（必须展示中文释义，不能只给英文枚举） */
  explainCode: string;
  /** 交叉验证是否满足（契约 §10.1：紧急告警强制双通道，singleChannel 不得下结论） */
  crossVerifySatisfied: boolean;
  /** 触发时的活动状态快照 */
  triggeredStatus: string;
  triggeredAt: string;
  /** 首次响应时间（ack 时落库），未响应为 undefined */
  ackBy?: string;
  ackAt?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  /** 处置结论说明 */
  resolveNote?: string;
  /** 升级后关联的工单号（escalate → complaints，Q11） */
  complaintNo?: string;
  /** 关联订单（导出对照用） */
  orderNo?: string;
  /** 连续静默分钟（STILL_TOO_LONG 专用） */
  stillMinutes?: number;
}

/** 引流漏斗（GET /admin/activity/funnel，契约 §13.6 + §13.9） */
export interface ActivityFunnel {
  /** 漏斗层级，顺序即契约 §13.6 的 7 触点 */
  stages: ActivityFunnelStage[];
  /** 归因触发器命中分布（ACTIVITY_DROP / LOW_TREND / NEWINSTALL_EXPERIENCE） */
  triggerBreakdown: { trigger: string; count: number; label: string }[];
  /** 维度口径：community=按小区 / trigger=按活动类型 / date=按时间 / touchpoint=按线下触点 */
  dimension: string;
  /** 统计窗口天数（7 / 30 / 90） */
  days: number;
  /** 分渠道明细 */
  channels: ActivityFunnelChannel[];
  /** 总量卡：触达（装机）/ 完成双层同意 / 首次下单 / 复购 */
  totals: {
    reach: number;
    consentGranted: number;
    firstOrder: number;
    reorder: number;
  };
  /** 单均带新成本（分）——归因指标，PRD §4 */
  cacPerOrderFen?: string;
  /** 线下触点归因（PRD §护城河 / 架构 §98；与漏斗层级正交，始终随漏斗一并返回） */
  offlineTouchpoints?: OfflineTouchpointAttribution[];
  /**
   * 🔴 归因聚合结果**是否被截断**（服务端 `take: 5000` 候选集上限所致）。
   *
   * ⚠️ **字段名待契约裁定**：主理人 2026-10 裁定三处 `truncated` 改名区分语义，
   * 本字段拟用 `attributionTruncated`；**但契约改名要等服务端实现落盘后才做**
   * （顺序：服务端实现 → 契约改名 → 前端对齐）。故现在**刻意不写进类型**，
   * 等承钧落盘 + 图南改完契约再补。
   *
   * **为什么它不能用「count 偏小」来推断**：`take: 5000` 的 orderBy 只到
   * `community_code`（`admin.service.ts:418`），**同一份数据两次查询可能返回不同的
   * 5000 条**——所以这不是「偏小」而是**不可复现**。前端不能自己算，也猜不出来，
   * 只能等服务端告知。
   *
   * **为什么它危害大**：偏差落在**每个社区自己的数字**上，不是少列几行。
   * `byCommunity[].count` 偏小看起来完全像「小社区本来就人少」，无异常特征。
   */
  attributionTruncated?: boolean;
  disclaimer: string;
}

export interface ActivityFunnelStage {
  /** 触点枚举（activity_touchpoint_type） */
  touchpoint: string;
  /** 本层转化数（去重老人/账号数） */
  converted: number;
  /** 相对上一层的转化率（0–100），首层为 100 */
  stepRate: number;
  /** 相对首层的转化率（0–100） */
  overallRate: number;
  /** 相对上一层的流失数 */
  churned: number;
  /**
   * 样本是否足够支撑结论。
   * 低于阈值时页面须显示「数据不足」而**不是 0%**——
   * 0%（没人做到）与「样本太少看不出来」在业务上是两件事，混淆会让运营做错决策。
   */
  dataSufficient: boolean;
  /** 是否为当前最大流失环节（页面需高亮并给优化建议） */
  biggestChurn: boolean;
  /** 该层对应的可落地运营动作（每层都给，让运营知道这一层该做什么） */
  action: string;
  /** 流失最大环节的针对性优化建议（会引用本维度下流失最集中的具体渠道 + 该渠道现场引导动作） */
  advice?: string;
}

export interface ActivityFunnelChannel {
  /** 渠道键（小区名 / 触发器 / 日期 / 线下触点，取决于所选维度） */
  channelKey: string;
  channelLabel: string;
  /** 各触点转化数（与 stages 顺序一致，缺失为 0） */
  counts: number[];
  /** 该渠道最终下单数 */
  firstOrderCount: number;
  /** 该渠道样本是否足够（首层 < 阈值时标数据不足） */
  dataSufficient: boolean;
}

/**
 * 线下触点渠道归因（PRD §护城河 / 架构 §98）。
 * 与漏斗层级正交：漏斗回答「同一个人从安装到复购的转化路径」，
 * 触点回答「他从哪个线下入口来」——两者不可混为一层。
 * 落位 activity_touchpoints.metadata.channel（schema 留Json 字段，非共享枚举）。
 */
export interface OfflineTouchpointAttribution {
  key: string;
  label: string;
  /** 触点说明（运营据此判断该在哪加投放） */
  desc: string;
  /** 触达（装机）数 */
  reach: number;
  /** 完成双层同意数 */
  consent: number;
  /** 首次下单数 */
  firstOrder: number;
  /** 复购数 */
  reorder: number;
  /** 装机 → 首单转化率（0–100） */
  reachToOrderRate: number;
  /** 样本是否足够支撑结论 */
  dataSufficient: boolean;
  /** 该触点内的最大流失环节 + 现场引导建议（引用到具体触点，不给泛泛而谈的通用建议） */
  bottleneck: {
    touchpoint: string;
    churned: number;
    onsiteAdvice: string;
  };
}

// ---------------------------------------------------------------------------
// 订阅营收（契约 §13.6 GET /admin/activity/revenue，权限 revenue:read）
// ---------------------------------------------------------------------------
/**
 * 🔴 **Q8 账务隔离**：订阅收入是**独立科目**，不进陪聊分账池。
 *
 * 这个类型存在本身就是隔离的一部分——它与分账报表（SharingsPage / LedgerPage）
 * 是**两套不相加的数字**。任何「把订阅收入和佣金收入合成一个『总收入』」的改动
 * 都会让财务对账时无法解释差额。
 *
 * 摊分口径（承钧 2026-10 定稿）：**累计比例差分法**，不是「整段一次确认」。
 * 年费用户每月都有确认收入（¥49/365≈13分/天），不是首月一次性入账 ¥49。
 * 故「本月入账」不会因为来了个年费单就突然跳 4900 分。
 */

/** 订阅档位（schema enum activity_subscription_tier） */
export type RevenueTier = 'FREE' | 'PRO' | 'INSTITUTIONAL';

/**
 * 未计入当期收入的原因（**可审计**：报表数与在册数差额必须能解释）。
 *
 * 全部来自服务端 domain/revenue.ts 的 RevenueExcludeReason，本页**不得新增或改名**——
 * 新增一个原因就意味着报表与在册数差了一个无法解释的口子。
 */
export type RevenueExcludeReason =
  | 'COUNTED'
  | 'STATUS_NOT_CONFIRMABLE'
  | 'FREE_TIER_ZERO_PRICE'
  | 'ZERO_PRICE'
  | 'NO_OVERLAP'
  | 'INVALID_SPAN';

/** 分档汇总行（**服务端按 FREE/PRO/INSTITUTIONAL 固定序返回，不按金额排序**） */
export interface RevenueTierRow {
  tier: RevenueTier;
  /** 当期确认收入（分，字符串） */
  amountFen: string;
  /** 当期确认的订阅笔数 */
  countedCount: number;
  /** 在册订阅笔数（含未确认态与免费档；用于算付费转化） */
  totalCount: number;
}

/** 汇总视图 */
export interface RevenueSummary {
  /** 当期确认收入合计（分，字符串） */
  totalAmountFen: string;
  /** 付费档位订阅笔数（PRO + INSTITUTIONAL），仅计确认态 */
  paidCount: number;
  /** 免费档笔数 */
  freeCount: number;
  /**
   * 客单价（分，字符串）。
   *
   * ⚠️ **无付费用户时为 `null` 而非 0** —— 这是两种不同的运营含义：
   * 「本期一个付费用户都没有」vs「客单价是 0 元」。前者要提示，后者是异常数据。
   * 前端**禁止把 null 渲染成 ¥0**。
   */
  avgPriceFen: string | null;
  /** 因非确认态被排除的笔数 */
  excludedCount: number;
}

/** 明细行（供财务逐笔复核） */
export interface RevenueDetailRow {
  subscriptionNo: string;
  tier: RevenueTier;
  status: string;
  /** 订阅原价（分，字符串） */
  priceFen: string;
  /** 本期摊分确认收入（分，字符串）；未计入时为 '0' */
  proratedFen: string;
  /** 是否计入当期收入 */
  counted: boolean;
  /** 未计入原因（counted=true 时为 'COUNTED'） */
  reason: RevenueExcludeReason;
  /** 本订阅自身总跨度（天） */
  totalDays: number;
  /** 与窗口重叠天数 */
  overlapDays: number;
}

/** 订阅营收报表（契约 §13.6） */
export interface ActivityRevenue {
  /** 统计窗口起（闭区间） */
  windowStart: string;
  /** 统计窗口止（开区间） */
  windowEnd: string;
  /** 窗口天数 */
  windowDays: number;
  /** 分档汇总（固定行序 FREE/PRO/INSTITUTIONAL） */
  byTier: RevenueTierRow[];
  summary: RevenueSummary;
  /** 月度趋势（months 长度，升序） */
  trend: { month: string; amountFen: string }[];
  /** 排除原因分布（报表数与在册数差额可解释） */
  excludedReasons: { reason: RevenueExcludeReason; count: number }[];
  /** 明细（供财务逐笔复核；上限 500） */
  details: RevenueDetailRow[];
  /**
   * 科目隔离声明（Q8）。
   *
   * 🔴 **前端必须原样展示，不得改写、不得省略**。服务端原文即
   * 「订阅收入为独立科目，不进陪聊分账池（PRD §5 / Q8）；与分账报表分别对账。」
   */
  accountingNote: string;
}

/**
 * 配置变更历史行（配置域视图，数据源 audit_logs module=system，非新表）。
 *
 * 字段名严格对齐契约 §5.7.7：`configKey / beforeValue / afterValue / operator / changedAt / requestId`。
 * 前后值双字段是硬要求——财务要查「谁把佣金从 5% 改成 8%」必须有双值对照，单值查不出来。
 */
export interface ConfigChangeLog {
  id: string;
  /** 配置键（system_configs.config_key） */
  configKey: string;
  /** 变更前值（字符串原值；单位由 configKey 决定，禁止浮点运算） */
  beforeValue: string;
  /** 变更后值 */
  afterValue: string;
  /** 操作人（契约字段名为 operator，非 operatorName） */
  operator: string;
  /** 变更时间（契约字段名为 changedAt，非 createdAt） */
  changedAt: string;
  /** requestId：按此可回溯服务端日志，排查必带 */
  requestId: string;
  ip: string;
  /**
   * 配置项中文名（契约 §5.7.7 标注为「前端补充字段」）。
   * 服务端取 `SYSTEM_CONFIG_DEFAULTS[key].description`，未知键回落为键名本身
   * （`admin.routes.ts`）。本字段**不参与筛选**，纯展示。
   */
  configLabel?: string;
}

/**
 * 配置变更历史分页出参。
 *
 * 🔴 `truncated` 是**契约 §5.7.7 明文要求的字段**，不是可选项：
 * `operator` / `keyword` 只能应用层筛（audit_logs 无对应列），服务端设候选集上限 500
 * 并回该标记，前端须在true 时提示「请收紧筛选条件」，且**不得把候选集条数当 `total` 展示**。
 *
 * 已知局限：`ConfigChangeLog.truncated` 未挂在行上——它是**分页级**标记，
 * 不是每行一个。挂在行上会让 500 行返回 500 个 true，是噪音。
 */
export type ConfigChangeLogPage = TruncatedPageResult<ConfigChangeLog>;
