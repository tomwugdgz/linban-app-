// ============================================================================
// 枚举三层对账（enum-guard）
// ----------------------------------------------------------------------------
// 主理人原话：
//   「所有『共享包已有枚举』的域，mock 层必须有对应断言。」
//   「断言的作用域要覆盖全项目，否则就是给没检查的地方发免检牌。」
//
// 为什么这个门禁不是「又补几条 if」：
// 手写 `ok('order.status 合法', ...)` 这种断言只覆盖**我这次想到的域**。
// 上一轮我只查了 activity_touch_channel，于是 activity_status / order_status /
// user_coupon_status 这些同样有共享枚举的域全都裸奔——而 OFFLINE_TOUCHPOINTS
// 平行造了四个码值没被发现，正是因为没人给它发过门禁。
//
// 所以这里的做法是**自动发现**：遍历 mock 每个集合的每个「枚举型字段」，
// 只要它的全部取值都符合 ENUM_LIKE（SCREAMING_SNAKE）形态，就认定这是一个码值域，
// 强制要求它要么登记到 REGISTRY（对齐某个共享枚举），要么登记到 STRING_COLUMNS
// （schema 里就是 String 列，不是 enum——但必须写明理由，理由为空直接红）。
//
// 效果：
//   1. 新增 mock 集合/字段忘了登记 → 门禁自动打红，逃不掉；
//   2. 把某个码值改成自造值 → 该字段的取值不再全属于登记枚举 → 打红；
//   3. 白名单不能白申——每条必须带非空理由，且理由会被打印出来供人复核。
//
// ============================================================================
// 🔴 本门禁**守什么**
// ---------------------------------------------------------------------------
//   1. mock 各集合的枚举型字段**已被自动发现**（不靠人记得列）；
//   2. 每个被发现的字段都已登记，去向三选一：
//        REGISTRY（对齐共享包枚举，逐一比对值集合）
//        / STRING_COLUMNS（schema String 列，必须带非空理由）
//        / TS_ONLY_CONSTANTS（纯 TS 常量，必须带非空理由）；
//   3. 共享包枚举 ↔ schema enum 的镜像关系（数量对账，防 shared 漏补）；
//   4. 与服务端 `TS_ONLY_ALLOWLIST` 的键集合一致（两侧白名单不得各说各话）。
//
// 🔴 本门禁**不守什么**（声明边界，避免被当万能牌用）
// ---------------------------------------------------------------------------
//   1. **不校验枚举值本身对不对**——只校验「在登记的枚举里」，
//      不校验「这个枚举选得对不对」。值选错要靠评审，不靠门禁。
//   2. **不校验 mock 数据的业务真实性**（10 个订单 8 个已核销这种合理性一概不管）。
//   3. **不守枚举的运行时类型与取值域**。`status='DELETED'` 这类拼错会被
//      ENUM_LIKE 判为「非枚举型字段」而**静默漏检**。
//   4. **不守 schema 的 String 列注释**。schema 侧 `type String` **无强制力**，
//      注释会漂移而不报错——`reports.type` 四方分歧正是这么来的
//      （schema 注释 / 服务端 zod / 端侧 / mock 各写各的）。
//      要守它得解析 .prisma 注释，那是另一条更脆的门禁，本文件不做。
//   5. **不守字段名本身**，故**不保证发现率 100%**。`ENUM_FIELD_NAME` 是后缀启发式：
//      字段叫 `reports.type` 命中 `type$`；改叫 `report_kind` **就不命中** → 漏检。
//      本门禁守的是「**发现了就必须登记**」，不是「一定发现」。第 5 条是已知漏检面。
//   6. **不守跨层的入参/出参字段名**（前端传参 vs 服务端 zod 键、出参字段 vs 契约字段）。
//      那属smoke.mjs 的「入参对齐门禁」与「候选集截断门禁」，不属本文件职责。
// ============================================================================

/** 枚举型字段名候选：命中即视为「这是一个码值域」 */
const ENUM_FIELD_NAME = /(status|type|level|channel|source|stage|priority|scope|mode|role|action|result|key)$/i;

/** 取值形态：SCREAMING_SNAKE（可含数字），如 ORDER_COMMISSION / RV20260921000123 */
const ENUM_LIKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

export interface EnumGuardRegistryEntry {
  /** 字段在 mock 集合里的路径，形如 `orders.status` */
  path: string;
  /** 共享包枚举名，如 `order_status` */
  enumName: string;
}

/**
 * 已登记为「共享包枚举」的字段。
 * 新增一行 = 给这个域发一张门禁票；写错 = 门禁立刻打红。
 */
export const REGISTRY: EnumGuardRegistryEntry[] = [
  { path: 'companions.status', enumName: 'companion_status' },
  { path: 'applications.stage', enumName: 'application_stage' },
  { path: 'applications.realnameStatus', enumName: 'step_status' },
  { path: 'applications.faceStatus', enumName: 'step_status' },
  { path: 'applications.criminalStatus', enumName: 'step_status' },
  { path: 'orders.status', enumName: 'order_status' },
  { path: 'orders.serviceType', enumName: 'service_type' },
  { path: 'sharings.status', enumName: 'profit_sharing_status' },
  { path: 'withdrawals.status', enumName: 'withdrawal_status' },
  { path: 'reconciliations.channel', enumName: 'recon_channel' },
  { path: 'reconciliations.status', enumName: 'recon_status' },
  { path: 'giftCards.status', enumName: 'gift_card_status' },
  { path: 'commissions.type', enumName: 'commission_type' },
  { path: 'commissions.status', enumName: 'commission_status' },
  { path: 'coupons.type', enumName: 'coupon_type' },
  //券模板状态**不在** schema enum 里（schema:1432 是 `String @default("DRAFT")` VarChar 列，
  //改 enum 要ALTER TABLE 改列类型、有投放数据的表锁表风险不值当），
  // 故由 shared 的 COUPON_STATUS 词表承载，并已登记进 enum-mirror 的 TS_ONLY_ALLOWLIST。
  { path: 'coupons.status', enumName: 'COUPON_STATUS' },
  { path: 'userCoupons.status', enumName: 'user_coupon_status' },
  { path: 'userCoupons.source', enumName: 'user_coupon_source' },
  { path: 'complaints.priority', enumName: 'complaint_priority' },
  { path: 'complaints.status', enumName: 'complaint_status' },
  { path: 'reports.status', enumName: 'report_status' },
  { path: 'reports.rewardStatus', enumName: 'report_reward_status' },
  { path: 'riskEvents.level', enumName: 'risk_level' },
  { path: 'riskEvents.status', enumName: 'risk_event_status' },
  { path: 'adminAccounts.status', enumName: 'admin_status' },
  { path: 'blacklists.targetType', enumName: 'blacklist_target_type' },
  { path: 'blacklists.scope', enumName: 'blacklist_scope' },
  { path: 'blacklists.status', enumName: 'blacklist_status' },
  { path: 'activityElders.status', enumName: 'activity_status' },
  { path: 'activityElders.deviceStatus', enumName: 'wifi_device_status' },
  { path: 'activityElders.consentStatus', enumName: 'activity_consent_status' },
  { path: 'activityElders.consentScopeLevel', enumName: 'activity_consent_scope_level' },
  { path: 'healthAlerts.type', enumName: 'health_alert_type' },
  { path: 'healthAlerts.level', enumName: 'health_alert_level' },
  { path: 'healthAlerts.status', enumName: 'health_alert_status' },
  // 告警的 triggeredStatus 是**触发时刻**老人的活动状态（activity_status 五态），
  // 与 status（处置状态机六态）语义不同——别把这两个混成一个枚举。
  { path: 'healthAlerts.triggeredStatus', enumName: 'activity_status' },
  // 线下触点渠道键 =共享枚举 activity_touch_channel 七值。
  // 曾平行自造 GATE_BANNER/UNIT_DOOR/GROUP_BUY/OPEN_DOOR_APP 四个值，
  // 真接后端时四类线下触点全部映射不上、归因整体缺失且零报错。
  { path: 'OFFLINE_TOUCHPOINTS.key', enumName: 'activity_touch_channel' },
  { path: 'funnelChannels.channelKey', enumName: '@community_code' },
];

/**
 * 解析枚举名到值域：先找 `<name>_values`，再找 `<name>_VALUES`。
 * （共享包两种命名都有：schema 镜像用 `_values`，TS 词表用 `_VALUES`。）
 */
export function resolveEnumValues(shared: Record<string, unknown>, enumName: string): string[] | null {
  const v = shared[`${enumName}_values`] ?? shared[`${enumName}_VALUES`];
  return Array.isArray(v) ? (v as string[]) : null;
}

/**
 * 明确**不是**共享包枚举的码值字段（schema 里就是 VarChar 列）。
 * 每条必须写理由——理由为空即视为「随手白申」，门禁打红。
 */
export const STRING_COLUMNS: Record<string, string> = {
  'distributors.status':
    'schema.prisma:1517 `status String @default("ACTIVE")` 是 VarChar 列，宋砚秋未落 enum；值域与 admin_status 相同但语义不同（团长状态≠后台账号状态），故不复用。',
  'complaints.complainantRole':
    'schema.prisma:1400 `complainant_role String` 是 VarChar 列（USER/COMPANION），无对应 enum。',
  'complaints.targetType':
    'schema.prisma:1401 `target_type String`（USER/COMPANION/ORDER/PLATFORM），是多态指向且值域比 blacklist_target_type 多 PLATFORM，故不复用。',
  'complaints.type':
    'schema.prisma:1403 `type String`（SERVICE_QUALITY/SAFETY/...），schema 未落 enum。',
  'reports.reporterRole':
    'schema.prisma:1617 `reporter_role String` 是 VarChar 列（USER/COMPANION），无对应 enum。',
  'reports.targetType':
    'schema.prisma:1618 `target_type String`（COMPANION/USER），无对应 enum。',
  'reports.type':
    // 2026-10 修正：本行原先写 OFFLINE_PRICE/CONTACT_EXCHANGE/OTHER，那是从
    // **schema 注释**抄来的过时建模名。四方分歧（schema 注释 / 服务端 zod / 端侧 / mock）
    // 由此产生，事实源已裁定为服务端 zod `risk.routes.ts:36`：
    //   FLY_ORDER / OFF_PLATFORM_PAY / OTHER
    // schema 侧是 `type String @db.VarChar(32)`（**非 enum 类型，无强制力**），
    // 所以注释可以漂移而不报错 —— **注释永远不能当枚举来源**。
    // 值一致性由 smoke.mjs 的「mock 举报类型 ≡ 服务端 zod」断言守住。
    'schema.prisma:1620 `type String`（FLY_ORDER/OFF_PLATFORM_PAY/OTHER），无对应 enum；' +
    '事实源是服务端 zod risk.routes.ts，不是 schema 注释。',
  'samplingTasks.targetType':
    'schema 抽检任务表 `target_type String`（AI_SESSION/IM_MESSAGE/REVISIT），无对应 enum。',
  'samplingTasks.status':
    '抽检任务状态 PENDING/REVIEWED 是本域自有流转，schema 未落 enum（不要复用 im_review_status，那是 IM 消息审核态）。',
  'samplingTasks.reviewResult':
    '抽检结论 PASS/REJECT，schema 未落 enum。',
  'riskEvents.type':
    'schema.prisma:1590 `type String`（SENSITIVE_WORD/GPS_DEVIATION/.../），风控规则库会持续扩值，刻意不落 enum。',
  'riskEvents.subjectType':
    'schema.prisma:1592 `subject_type String`（USER/COMPANION/ORDER/IM_MESSAGE/DEVICE），多态指向，无对应 enum。',
  'riskEvents.actionTaken':
    'schema.prisma:1596 `action_taken String?`（WARN/INTERCEPT/LIMIT/PENALTY/BAN），处置动作会随规则库扩展，刻意不落 enum。',
  'auditLogs.action':
    'schema.prisma:1670 `action String`（create/update/approve/...），审计动作是开放集，无 enum。',
  'auditLogs.targetType':
    'schema.prisma:1672 `target_type String?`，多态指向，无对应 enum。',
  'blacklists.reason':
    '自由文本（黑名单理由），不是码值。',
  'funnelChannels.channelLabel':
    '展示用全称（= communities.community_name），不是码值；码值在 channelKey。',
  'OFFLINE_TOUCHPOINTS.label':
    '线下触点中文名，展示用不是码值。',
  'OFFLINE_TOUCHPOINTS.desc':
    '触点说明，自由文本。',
  'OFFLINE_TOUCHPOINTS.onsiteAdvice':
    '现场引导建议，自由文本。',
};

/**
 * 遍历 mock 集合，自动发现所有「枚举型字段」。
 * @returns {path, values}[] 未登记也不在白名单里的字段
 */
export function discoverUnregisteredEnumFields(
  collections: Record<string, unknown>,
): { path: string; values: string[] }[] {
  const out: { path: string; values: string[] }[] = [];
  for (const [collName, raw] of Object.entries(collections)) {
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const first = raw[0] as Record<string, unknown>;
    for (const field of Object.keys(first)) {
      if (!ENUM_FIELD_NAME.test(field)) continue;
      const values = [
        ...new Set(
          raw
            .map((r) => (r as Record<string, unknown>)[field])
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        ),
      ];
      if (values.length === 0) continue;
      // 只有「全部取值都是码值形态」才认定为码值域；
      // 掺了自由文本的字段（如 blacklists.reason）不误判。
      if (!values.every((v) => ENUM_LIKE.test(v))) continue;
      out.push({ path: `${collName}.${field}`, values });
    }
  }
  return out;
}

/** 某字段路径的取值是否全部属于给定枚举 */
export function allInEnum(values: string[], allowed: string[]): string[] {
  const set = new Set(allowed);
  return values.filter((v) => !set.has(v));
}

// ============================================================================
// TS-only 常量登记（shared 有、schema 无 enum 的纯 TS 常量）
// ----------------------------------------------------------------------------
// 为什么必须有这张表：
//   shared 里有些导出是「全 string 值的对象」，形态上与 schema enum 镜像**完全一样**，
//   但它根本不是落库枚举（落的是 VarChar 列 / 内存映射 / 展示表）。
//   不登记的话，跨层核对就会把它们当成「schema 少了镜像」→ 误报；
//   更糟的是反过来：将来 schema 新增了同名 enum，shared 的这个常量**不会**被
//   识别成冲突，两边值域悄悄分叉。
//
// **这张表与 server 侧 enum-mirror.test.ts 的 TS_ONLY_ALLOWLIST 是同一份事实的两处副本**，
// 两处都写明理由；smoke 里有断言校验两侧键集合一致（防单侧漏登记）。
// ============================================================================

/**
 * shared 有、schema 无 enum 的纯 TS 常量。**每条必须写理由**（理由为空即视为随手白申，打红）。
 *
 * 判据与 server 侧 collectSharedEnums 一致：
 *   导出是「非数组对象」且「所有值都是 string」→ 形态上像 enum 镜像。
 */
export const TS_ONLY_CONSTANTS: Record<string, string> = {
  activity_bonus_reason:
    '落 orders.dispatch_reason_code（VarChar(32) 字符串列），schema 侧刻意不用 enum，避免 ALTER TYPE 锁表',
  COUPON_STATUS:
    'coupons.status 为 String 列（避免 ALTER 锁表），常量即其唯一口径来源。'
    + '注意它的值域数组后缀是大写 _VALUES（与 schema 镜像的 _values 命名不一致，shared 里两种都有）',
  QUEUE_NAMES: 'BullMQ 队列名常量（Redis 侧约定，非落库枚举）',
  BIZ_NO_PREFIX: '业务单号前缀（genBizNo 用，落 orders.biz_no 等字符串列）',
  SPLIT_MODE: '分账模式标识（落 profit_sharing_records.split_mode 字符串列）',
  ACTIVITY_COPY_SCENE: '推荐话术场景码（A6 话术库选句键，落 activity_touchpoints 之外的内存映射）',
  CONFIG_LABELS:
    '配置项中文名表（纯展示用 Record<string,string>）。system_configs.key 是 VarChar 字符串列，'
    + '不是落库枚举；本表的值域由 SYSTEM_CONFIG_DEFAULTS 的键集合约束，'
    + '而非由 schema enum 约束（键集合一致性另有 config-changelog-group.test.ts 守）。'
    + '**前端侧已上收为 shared 的单一事实源**（apps/admin-web/src/shared/config-meta.ts 只做 re-export）。',
};

/**
 * 从 shared 的导出里自动发现「形态像 enum 镜像、但 schema 里没有对应 enum」的常量名。
 * 与 server 侧 collectSharedEnums 同一判据 —— 两侧口径必须一致，否则对账永远对不上。
 */
export function discoverTsOnlyConstants(
  shared: Record<string, unknown>,
  schemaEnumNames: Set<string>,
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(shared)) {
    if (key.endsWith('_values')) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length === 0 || !vals.every((v) => typeof v === 'string')) continue;
    if (schemaEnumNames.has(key)) continue;
    out.push(key);
  }
  return out.sort();
}