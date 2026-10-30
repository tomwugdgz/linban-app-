// ============================================================================
// 邻伴 · 中间件：限流与幂等（架构附录 B：幂等中间件 + 限流配置）
// ----------------------------------------------------------------------------
// 限流（附录 B）：
//   登录 5/min、下单 10/min；后台登录失败 5 次锁 30min（Redis 计数）。
// 幂等（附录 B）：
//   Idempotency-Key 头 → Redis 占位（idem:<key> 24h）；
//   占位失败（已有在途）→ 10006；命中已完成结果 → 直接回放。
//   DB 唯一键（idempotency_key 列）为最终兜底。
// ============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '@linban/shared';
import { LOGIN_RATE_LIMIT_PER_MIN, ORDER_RATE_LIMIT_PER_MIN } from '@linban/shared';
import { claimIdempotency, getIdempotentResult, setIdempotentResult } from '../infra/redis';
import { sendOk } from '../common/errors';

/** 登录限流 5/min（按 IP） */
export const loginRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: LOGIN_RATE_LIMIT_PER_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { code: 10005, message: '操作过于频繁，请稍后再试' },
});

/** 下单限流 10/min（按用户；未登录按 IP） */
export const orderRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: ORDER_RATE_LIMIT_PER_MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req.user ? `u:${req.user.userId}` : `ip:${req.ip ?? 'unknown'}`),
  message: { code: 10005, message: '操作过于频繁，请稍后再试' },
});

/**
 * 幂等中间件（写操作统一挂载）。
 * 流程：取 Idempotency-Key → 查已完成结果（命中直接回放）→ 占位
 * （失败=在途 → 10006）→ next() → handler 执行后由 route 包装
 * 调 setIdempotentResult 落结果。
 */
export const idempotencyMiddleware: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = (req.headers['idempotency-key'] as string | undefined) ?? (req.body?.idempotency_key as string | undefined);
    if (!key) {
      // 未传幂等键：放行（DB 唯一键兜底），但不缓存结果
      return next();
    }
    if (!/^[\w:-]{8,128}$/.test(key)) {
      throw new AppError(10001, 'Idempotency-Key 格式不合法（8–128 位字母数字）');
    }
    // 1) 命中已完成结果 → 直接回放（含 BigInt 已序列化）
    const done = await getIdempotentResult<unknown>(key);
    if (done && (done as { __pending__?: boolean }).__pending__ !== true) {
      sendOk(res, done);
      return;
    }
    // 2) 占位（防并发双跑）
    const claimed = await claimIdempotency(key);
    if (!claimed) {
      throw new AppError(10006, '同一请求正在处理中，请勿重复提交');
    }
    res.locals.idempotencyKey = key;
    next();
  } catch (e) {
    next(e);
  }
};

/** handler 执行成功后调用：落幂等结果 */
export async function rememberIdempotentResult(res: Response, result: unknown): Promise<void> {
  const key = res.locals.idempotencyKey as string | undefined;
  if (key) await setIdempotentResult(key, result);
}

/** 内部助手：从 body 取幂等键（供未走中间件的 handler 用） */
export function idempotencyKeyOf(req: Request): string | null {
  const header = req.headers['idempotency-key'] as string | undefined;
  const bodyKey = (req.body as { idempotency_key?: string } | undefined)?.idempotency_key;
  return header ?? bodyKey ?? null;
}

export type { NextFunction };
