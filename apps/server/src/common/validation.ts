// ============================================================================
// 邻伴 · 请求校验助手（common 层，zod → AppError(10001)）
// ----------------------------------------------------------------------------
// 所有入参（body/query/params）必须经 zod schema 校验，杜绝注入与脏数据
// （架构 §10.1 输入校验铁律）。校验失败统一 10001 + issues 明细。
// ============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '@linban/shared';
import { z } from 'zod';

/** 解析并断言（不通过抛 AppError 10001，带 issues） */
export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(10001, '请求参数校验失败', {
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
    });
  }
  return result.data;
}

/**
 * 中间件版：校验 body（可扩展 query/params）。
 * 用法：router.post('/', validateBody(schema), handler)
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = parseOrThrow(schema, req.body);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 校验 query（合并已验证结果回 req.query） */
export function validateQuery<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      (req as Request & { validatedQuery: unknown }).validatedQuery = parseOrThrow(schema, req.query);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 校验路径参数 */
export function validateParams<T extends z.ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.params = parseOrThrow(schema, req.params) as Request['params'];
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** 通用 schema 片段：分页 */
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** 通用 schema 片段：游标分页 */
export const cursorSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 通用 schema 片段：BigInt ID（string 数字串，防精度丢失） */
export const idSchema = z.string().regex(/^\d+$/, 'ID 必须为数字字符串');

/** 通用 schema 片段：金额（整分，string 数字串） */
export const fenSchema = z.string().regex(/^\d+$/, '金额必须为整分数字字符串');

/** 通用 schema 片段：ISO 时间 */
export const isoSchema = z.string().datetime({ offset: true });

/** 通用 schema 片段：本地日期 */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式 YYYY-MM-DD');

/** 通用 schema 片段：本地时分 */
export const hmSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, '时间格式 HH:mm');
