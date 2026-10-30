// ============================================================================
// 券模板状态（coupon_status）—— 落 `coupons.status` 字符串列
// ----------------------------------------------------------------------------
// 为什么是纯 TS 常量、不进 Prisma enum：
//   `coupons.status` 在 schema 侧是 `String @default("DRAFT") @db.VarChar(16)`，
//   刻意不用 enum —— 券状态将来大概率要加值（如 EXHAUSTED），改成 MySQL ENUM
//   需要 ALTER TABLE 改列类型，而这张表有投放数据，锁表风险不值当。
//   故与 `activity_bonus_reason`（落 orders.dispatch_reason_code）同一口径处理。
//
// 为什么单独一个文件、不并进 enums.ts：
//   enums.ts 是「schema Prisma enum 的逐字镜像」，由霍承钧独占维护；
//   本常量**没有** schema enum 对应物，属 shared 侧的受控词表，单独成文件
//   以免污染镜像关系（enum-mirror CI 门禁靠 TS_ONLY_ALLOWLIST 登记它）。
//
// 取值口径：**与 schema 注释逐字一致**（DRAFT/ACTIVE/PAUSED/ENDED）。
//   注意别与 `user_coupon_status`（UNUSED/USED/EXPIRED，用户手里的券）混淆——
//   那是用户券，这是券模板。
// ============================================================================

/// 券模板状态（落 coupons.status 字符串列 VarChar(16)）
export const COUPON_STATUS = {
  DRAFT: 'DRAFT', // 草稿（未投放）
  ACTIVE: 'ACTIVE', // 投放中
  PAUSED: 'PAUSED', // 已暂停
  ENDED: 'ENDED', // 已结束
} as const;

/// 券模板状态联合类型
export type CouponStatus = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];

/// 券模板状态取值数组（供 zod 枚举 / 单测遍历）
export const COUPON_STATUS_VALUES = Object.values(COUPON_STATUS);
