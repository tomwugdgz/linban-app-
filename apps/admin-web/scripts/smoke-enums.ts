// ============================================================================
// 冒烟专用出口（第二个 esbuild 入口）：把「共享包枚举值域」与「mock 数据集合」
// 同时暴露给 smoke.mjs，供枚举门禁遍历。
// ----------------------------------------------------------------------------
// 主理人派单原话：
//   「所有『共享包已有枚举』的域，mock 层必须有对应断言。」
//   「断言的作用域要覆盖全项目，否则就是给没检查的地方发免检牌。」
//
// 为什么必须是「自动发现 +映射表」而不是再手写几条 if：
// 上一轮我只查了 activity_touch_channel 一个域，于是 activity_status /
// order_status / user_coupon_status 这些同样有共享枚举的域全都裸奔——
// 而 OFFLINE_TOUCHPOINTS 平行自造了四个码值没被发现，正是因为没人给它发过门禁。
//
// 这里的机制（详见 enum-guard.ts）：
//   自动遍历 mock 每个集合的枚举型字段 → 强制要求它要么对齐某个共享枚举（REGISTRY），
//   要么显式声明「schema 里就是 String 列」并写明理由（STRING_COLUMNS）。
//   新增字段忘了登记 → 自动打红；把码值改成自造值 → 自动打红。
//
// **不放在 src/ 下**：这是测试元数据，不是产品代码。
// ============================================================================

import * as shared from '@linban/shared';
import * as db from '../src/api/mock/db';
import * as act from '../src/api/mock/db-activity';
import { CONFIG_GROUPS } from '../src/shared/config-meta';

export { shared };
export { CONFIG_GROUPS };
export { REGISTRY, STRING_COLUMNS, discoverUnregisteredEnumFields, resolveEnumValues, allInEnum } from './enum-guard';
// TS-only 常量登记（shared 有、schema 无 enum 的纯 TS 常量）及其自动发现函数。
// 与 server 侧 enum-mirror.test.ts 的 TS_ONLY_ALLOWLIST 是同一份事实的两处副本，
// smoke.mjs 里有断言校验两侧键集合一致 —— 单侧漏登记会打红。
export { TS_ONLY_CONSTANTS, discoverTsOnlyConstants } from './enum-guard';

/** mock 全部集合（枚举门禁遍历对象） */
export const mockCollections: Record<string, unknown> = {
  companions: db.companions,
  applications: db.applications,
  orders: db.orders,
  sharings: db.sharings,
  withdrawals: db.withdrawals,
  reconciliations: db.reconciliations,
  giftCards: db.giftCards,
  distributors: db.distributors,
  commissions: db.commissions,
  coupons: db.coupons,
  userCoupons: db.userCoupons,
  complaints: db.complaints,
  reports: db.reports,
  samplingTasks: db.samplingTasks,
  riskEvents: db.riskEvents,
  adminAccounts: db.adminAccounts,
  auditLogs: db.auditLogs,
  blacklists: db.blacklists,
  activityElders: act.activityElders,
  healthAlerts: act.healthAlerts,
  OFFLINE_TOUCHPOINTS: act.OFFLINE_TOUCHPOINTS,
  funnelChannels: act.funnelChannels,
};

/** 按 `集合.字段` 取去重取值 */
export function valuesOf(path: string): string[] {
  const [coll, field] = path.split('.');
  const arr = mockCollections[coll];
  if (!Array.isArray(arr)) return [];
  return [
    ...new Set(
      arr
        .map((r) => (r as Record<string, unknown>)[field!])
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  ];
}

// ---------------------------------------------------------------------------
// 业务单号号段（generalize 承钧发现的 coupon 缺口）
// ----------------------------------------------------------------------------
// 起因：霍承钧写 createCoupon 时 tsc 报「'coupon' 不在 BizNoType」——
// `BIZ_NO_PREFIX`（shared/constants.ts:371，服务端 `genBizNo` 的唯一前缀表）
// 当时只有 15 个号段、没有 coupon，于是他补了 `coupon: 'CPN'`。
//
// **同一个缺口不止一处**，而且两侧都可能有：
//   · 服务端侧：schema 里某个 `*_no` 列已存在，但 BIZ_NO_PREFIX 没登记 → tsc 会报出来；
//   · mock侧（本表）：mock 自己写了个前缀字面量，与 BIZ_NO_PREFIX 不一致，
//     **tsc 查不出来**（mock 是自由文本），真接后端时客服搜单号搜不到。
// 我本轮就踩了 9 处（PS/WD/CM/CP/RP/ST/RE/CP/HA 全部与号段表不符）。
//
// 所以这里把「mock 每个 *No 字段的前缀」与 BIZ_NO_PREFIX 逐条对账。
// ---------------------------------------------------------------------------

/** mock 的 `集合.字段` → BIZ_NO_PREFIX 的键（null = 该列不属BIZ_NO_PREFIX 体系） */
export const BIZ_NO_FIELDS: Record<string, string | null> = {
  'orders.orderNo': 'order',
  'applications.applicationNo': 'application',
  'sharings.sharingNo': 'sharing',
  'withdrawals.withdrawalNo': 'withdrawal',
  'complaints.complaintNo': 'complaint',
  'reports.reportNo': 'report',
  'samplingTasks.taskNo': 'task',
  'giftCards.cardNo': 'card',
  'commissions.commissionNo': 'commission',
  'coupons.couponNo': 'coupon',
  'riskEvents.eventNo': 'riskEvent',
  'healthAlerts.alertNo': 'healthAlert',
  // 以下四列不在 BIZ_NO_PREFIX 体系内，理由见 STRING_NO_FIELDS
  'reconciliations.batchNo': null,
  'distributors.distributorNo': null,
  'sharings.manualTicketNo': null,
  'withdrawals.wxBatchNo': null,
};

/** 不属 BIZ_NO_PREFIX 体系的列 + 理由（空理由即视为随手白申，打红） */
export const STRING_NO_FIELDS: Record<string, string> = {
  'reconciliations.batchNo':
    '对账批次号 `reconciliations.batch_no`（schema:1060 unique）。schema 的 `*_no` 清单里无对应项，且 BIZ_NO_PREFIX 无 recon 项——待承钧核是否该补 `recon`。当前 mock 用 `RC`。',
  'distributors.distributorNo':
    '团长编号 `distributors.distributor_no`（schema:1515 unique）。BIZ_NO_PREFIX 无 distributor 项，mock 用 `DT`。属**真实缺口候选**，已报承钧。',
  'sharings.manualTicketNo':
    '人工工单号 `profit_sharing_records.manual_ticket_no`（schema:1012）。注意服务端 `split-executor.ts:187` 实际是 `genBizNo(\'sharing\')` **复用分账单号空间（SHR 前缀）**，与 mock 的 `TK` 不一致——已报承钧。',
  'withdrawals.wxBatchNo':
    '微信商户提现批次号 `withdrawals.wx_batch_no`（schema:1043），是**微信侧返回的外部单号**，不属我方号段体系。',
};

/** 取某mock 单号字段的前缀（大写字母开头部分） */
export function prefixOf(path: string): string {
  const [coll, field] = path.split('.');
  const arr = mockCollections[coll];
  if (!Array.isArray(arr)) return '';
  const sample = (arr as Record<string, unknown>[]).find((r) => typeof r[field!] === 'string' && r[field!] !== '');
  const v = sample ? String(sample[field!]) : '';
  return /^[A-Z]+/.exec(v)?.[0] ?? '';
}
// ---------------------------------------------------------------------------
// 订阅营收 · mock 摊分与服务端摊分**真数据对账**
// ---------------------------------------------------------------------------
// 起因（2026-10 苏映棠）：mock 里复刻了一份摊分算法（prorateSubscriptionMock），
// 因为 mock 不能连库。**两份算法一旦分叉，前端在 mock 下「对得上」的数字
// 切真机就变了 —— 而这种差异没有任何测试会发现**（两侧各自自洽）。
//
// 这正是本项目反复踩到的「存在 ≠ 生效」：mock 摊分「存在」不等于它「与服务端一致」。
//
// 所以这里**不抠源码比对**（承钧对 bodyOf 的批评：抠源码只能证明「那段文本长得
// 像我以为的样子」），而是**把两边的纯函数都跑一遍同一批真数据，逐条对账**：
//   · 服务端 apps/server/src/domain/revenue.ts 的 prorateSubscription（bigint）
//   · mock    src/api/mock/db-activity.ts 的 prorateSubscriptionMock（number）
// 任一字段不一致即红。改了一边忘了改另一边 → 立刻红。
//
// 为什么能跨包 import：esbuild 把 TS 源码一起打包（@linban/shared 走 alias），
// 服务端 domain 是**纯函数**（无 Prisma 依赖），故可被 admin-web 冒烟直接调用。
export {
  mockSubscriptions,
  prorateSubscriptionMock,
  REVENUE_TIER_ORDER,
} from '../src/api/mock/db-activity';

export { prorateSubscription } from '../../server/src/domain/revenue';
