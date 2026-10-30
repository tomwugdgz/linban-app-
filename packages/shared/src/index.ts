// ============================================================================
// 邻伴 · @linban/shared 统一出口
// 三端（用户小程序 / 陪聊员小程序 / admin-web）+ 服务端共用的唯一共享包。
// ----------------------------------------------------------------------------
// 使用约定：
//   · 枚举值与 prisma schema 逐字一致，服务端与 Prisma 客户端零转换互通；
//   · 错误码（ERROR_CODES/AppError）三端共用，服务端接入层统一转换响应；
//   · 常量（SYSTEM_CONFIG_DEFAULTS/CREDIT_RULES/...）是 system_configs 种子
//     与领域规则的唯一镜像，修改须同步 ARCHITECTURE.md 附录 C / DATABASE.md §8。
// ============================================================================

export * from './enums';
export * from './error-codes';
export * from './constants';
export * from './activity-copy';
export * from './coupon-status';
export * from './dto';
