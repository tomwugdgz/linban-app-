// ============================================================================
// 邻伴 · Prisma Client 单例（infra 层）
// ----------------------------------------------------------------------------
// 单例纪律：开发期 tsx watch 热重载会反复 import 本模块，必须挂
// globalThis 防多实例耗尽连接池（架构 §11.1：max_connections ≥ 200）。
// 连接串约定见 DATABASE.md §2.6：必须带 ?timezone=UTC，容器 MySQL
// time_zone='+00:00'，全链路存 UTC，仅展示层转 Asia/Shanghai。
// ============================================================================

import { Prisma, PrismaClient } from '@prisma/client';

/** 全局单例容器（防热重载多实例） */
const globalForPrisma = globalThis as unknown as { __linbanPrisma?: PrismaClient };

/** 创建 Prisma 客户端（日志按环境分级） */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
    // BigInt 原生透传（schema 约定 1：金额一律 BigInt 存分）
    // 出参序列化统一走 common/bigint.ts，杜绝 JSON.stringify 抛错。
  });
}

/** 应用级 Prisma 单例 */
export const prisma: PrismaClient = globalForPrisma.__linbanPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__linbanPrisma = prisma;
}

/**
 * 事务助手：交互事务（默认 5s 超时，可按调用方覆盖）。
 * 资金链路（支付回调/分账执行/退款）的事务边界在 service 层显式声明。
 */
export async function withTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number },
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: options?.timeoutMs ?? 5000,
    maxWait: options?.maxWaitMs ?? 5000,
  });
}

/** 优雅关闭（app.ts 停机钩子调用） */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
