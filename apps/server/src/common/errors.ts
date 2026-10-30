// ============================================================================
// 邻伴 · 统一响应与错误处理（common 层，架构附录 B）
// ----------------------------------------------------------------------------
// 成功：{ code: 0, data, requestId }
// 失败：{ code, message, requestId, data? }
// 接入层职责：捕获 AppError → 按 httpStatus 映射；未知异常 → 10009 + 日志。
// ============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ErrorCode, ErrorCodeDef } from '@linban/shared';
import { CODE_SUCCESS, ERROR_CODES, getErrorDef, isAppError } from '@linban/shared';
import { serializeBigInts } from './bigint';
import { OutboundCipherLeakError } from './outbound';
import { logger } from './logger';

/** 成功响应 */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body = {
    code: CODE_SUCCESS,
    data: serializeBigInts(data),
    requestId: res.locals.requestId ?? 'unknown',
  };
  res.status(status).json(body);
}

/** 失败响应（按错误码查 HTTP 状态与文案） */
export function sendErr(
  res: Response,
  code: ErrorCode,
  message?: string,
  data?: Record<string, unknown>,
): void {
  const def: ErrorCodeDef = getErrorDef(code);
  const body = {
    code,
    message: message ?? def.message,
    requestId: res.locals.requestId ?? 'unknown',
    ...(data ? { data } : {}),
  };
  res.status(def.httpStatus).json(body);
}

/**
 * 全局错误处理中间件（必须最后注册，且签名 4 参）。
 * 顺序：AppError → zod（10001）→ 未知（10009 + 错误日志）。
 */
export const errorHandler: (err: unknown, req: Request, res: Response, next: NextFunction) => void = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  void next; // 签名占位
  const requestId = res.locals.requestId ?? 'unknown';

  // 1) 受控业务错误
  if (isAppError(err)) {
    logger.warn(
      { requestId, errCode: err.code, errKey: err.key, path: req.path, detail: err.detail },
      `业务错误 ${err.code} ${err.key}`,
    );
    sendErr(res, err.code as ErrorCode, err.message, err.payload);
    return;
  }

  // 2) 出参密文泄漏（守卫中间件抛出）：必须显眼，不能混进"未知异常"
  if (err instanceof OutboundCipherLeakError) {
    logger.error(
      { requestId, path: req.path, method: req.method, paths: err.paths },
      '出参密文泄漏已阻断——该端点必须显式挑选安全字段',
    );
    sendErr(res, 10009);
    return;
  }

  // 3) zod 校验错误（message 含 issues）
  const maybeZod = err as { name?: string; issues?: unknown[] };
  if (maybeZod?.name === 'ZodError' && Array.isArray(maybeZod.issues)) {
    logger.warn({ requestId, path: req.path, issues: maybeZod.issues }, '参数校验失败');
    sendErr(res, 10001, '请求参数校验失败', { issues: maybeZod.issues as Record<string, unknown>[] });
    return;
  }

  // 4) 未知错误：不泄露内部细节给客户端，完整堆栈进日志
  logger.error(
    { requestId, path: req.path, method: req.method, err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    '未捕获异常',
  );
  sendErr(res, 10009);
};

/** 404 兜底（未匹配路由） */
export const notFoundHandler: RequestHandler = (req: Request, res: Response) => {
  sendErr(res, 10007, `路由不存在: ${req.method} ${req.path}`);
};

/** 错误码表查询（供 /healthz 或文档端点） */
export function errorCodeCatalog(): Record<string, ErrorCodeDef> {
  return ERROR_CODES as unknown as Record<string, ErrorCodeDef>;
}
