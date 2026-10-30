// ============================================================================
// 邻伴 · Redis 客户端（infra 层：缓存 / 锁 / 幂等 / 会话）
// ----------------------------------------------------------------------------
// 用途（架构 §5.2）：
//   · 时段锁 / 抢单锁 / 分账执行锁（SET NX + TTL）；
//   · 幂等结果缓存（idem:<key> 24h）；
//   · 系统配置热数据（cache:config 5min + 主动失效）；
//   · Token 会话校验（sess:<userId>）；
//   · 附近陪聊员列表（cache:companion:list:<geoHash>）。
//
// 无 Redis 环境（本地 POC）：getRedis() 懒连接失败不阻塞进程启动，
// 锁助手降级为「本地内存近似」（仅单机有效，生产必须 Redis）。
// ============================================================================

import Redis, { type RedisOptions } from 'ioredis';
import { REDIS_KEYS } from '@linban/shared';

/** 全局单例容器 */
const globalForRedis = globalThis as unknown as { __linbanRedis?: Redis };

function createRedis(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
  const options: RedisOptions = {
    lazyConnect: true, // 不主动连接，首条命令时才连（无 Redis 也可启动）
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false, // 未连接时快速失败而非无限排队
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
  const client = new Redis(url, options);
  // 断线不崩进程：锁/缓存调用方自行处理 null 回落
  client.on('error', (err) => {
    // 噪音抑制：连接类错误降级为 warn，其余 error
    const msg = String((err as Error)?.message ?? err);
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|Connection is closed/.test(msg)) {
      console.warn(`[redis] 连接不可用（已降级）: ${msg}`);
    } else {
      console.error(`[redis] 错误: ${msg}`);
    }
  });
  return client;
}

/** 应用级 Redis 单例 */
export const redis: Redis = globalForRedis.__linbanRedis ?? createRedis();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.__linbanRedis = redis;
}

/** 健康探测（app.ts /healthz 用） */
export async function redisHealthy(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 分布式锁助手（SET key value NX PX ttl —— 架构 §5.2 各锁场景）
// ---------------------------------------------------------------------------

/**
 * 尝试获取锁。成功返回 token（释放时须匹配，防误删他人锁）；
 * 失败返回 null。锁 TTL 到期自动释放，防死锁。
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const res = await redis.set(key, token, 'PX', ttlMs, 'NX');
    return res === 'OK' ? token : null;
  } catch {
    return null; // Redis 不可用：调用方决定降级策略（不静默放行资金锁）
  }
}

/** 释放锁（Lua 原子校验 token，防释放他人锁） */
export async function releaseLock(key: string, token: string): Promise<boolean> {
  const script = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    end
    return 0
  `;
  try {
    const res = await redis.eval(script, 1, key, token);
    return res === 1;
  } catch {
    return false;
  }
}

/**
 * 带执行的锁封装：acquire → fn → release。
 * @param onBusy 未拿到锁时的回落（如时段冲突返回 14004）
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  onBusy: () => T,
): Promise<T> {
  const token = await acquireLock(key, ttlMs);
  if (!token) return onBusy();
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}

// ---------------------------------------------------------------------------
// 幂等助手（架构附录 B / §5.2：idem:<key> 24h）
// ---------------------------------------------------------------------------

/** 读取幂等结果缓存（命中则直接返回，避免重复执行） */
export async function getIdempotentResult<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(REDIS_KEYS.idempotency(key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // 缓存不可用不当短路，交业务层 DB 幂等键兜底
  }
}

/** 写入幂等结果（24h，含 BigInt 已序列化） */
export async function setIdempotentResult(key: string, result: unknown, ttlHours = 24): Promise<void> {
  try {
    await redis.set(REDIS_KEYS.idempotency(key), JSON.stringify(result), 'EX', ttlHours * 3600);
  } catch {
    /* 缓存写失败不阻塞主流程 */
  }
}

/**
 * 幂等键占用（先占位后执行，防并发双跑）：
 * 返回 true = 占位成功可继续；false = 已有在途请求。
 */
export async function claimIdempotency(key: string, ttlHours = 24): Promise<boolean> {
  try {
    const res = await redis.set(REDIS_KEYS.idempotency(key), '{"__pending__":true}', 'EX', ttlHours * 3600, 'NX');
    return res === 'OK';
  } catch {
    return true; // 缓存不可用时放行，由 DB 唯一键最终兜底
  }
}

// ---------------------------------------------------------------------------
// 系统配置热缓存（架构 §5.2：cache:config 5min + 主动失效）
// ---------------------------------------------------------------------------

/** 读取配置缓存快照（JSON） */
export async function getConfigCache<T>(): Promise<T | null> {
  try {
    const raw = await redis.get(REDIS_KEYS.config);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 写入配置缓存（5min） */
export async function setConfigCache(snapshot: unknown): Promise<void> {
  try {
    await redis.set(REDIS_KEYS.config, JSON.stringify(snapshot), 'EX', 300);
  } catch {
    /* 忽略 */
  }
}

/** 后台改配置 → 主动失效 */
export async function invalidateConfigCache(): Promise<void> {
  try {
    await redis.del(REDIS_KEYS.config);
  } catch {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------------------
// 会话助手（Token 黑名单/会话校验，架构 §3.2）
// ---------------------------------------------------------------------------

/** 记录用户会话（登出/冻结时删 key 实现全端踢下线） */
export async function touchSession(userId: bigint, ttlSec: number): Promise<void> {
  try {
    await redis.set(REDIS_KEYS.session(String(userId)), String(Date.now()), 'EX', ttlSec);
  } catch {
    /* 忽略：DB 侧仍可校验 */
  }
}

/** 会话是否有效（不存在视为已踢/过期） */
export async function sessionAlive(userId: bigint): Promise<boolean> {
  try {
    return (await redis.exists(REDIS_KEYS.session(String(userId)))) === 1;
  } catch {
    return true; // Redis 不可用不当误伤登录态，JWT 自身有效期兜底
  }
}

/** 注销会话（踢下线） */
export async function killSession(userId: bigint): Promise<void> {
  try {
    await redis.del(REDIS_KEYS.session(String(userId)));
  } catch {
    /* 忽略 */
  }
}

/** 优雅关闭 */
export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
