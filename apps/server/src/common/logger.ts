// ============================================================================
// 邻伴 · 日志（common 层，pino）
// ----------------------------------------------------------------------------
// 脱敏纪律：手机号/令牌/密文/密钥绝不入日志（架构 §10.1 与资金审计要求）。
// requestId 全链路透传（架构附录 B），排障时一键串起一次请求的所有日志。
// ============================================================================

import { pino } from 'pino';
import { maskPhone } from './crypto';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

/** 根 logger 单例 */
export const logger = pino({
  level,
  base: { service: 'linban-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.phone',
      '*.phone_cipher',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.secret',
      '*.id_card',
      '*.id_card_cipher',
      '*.bank_account_cipher',
      '*.account_name_cipher',
      'req.body.phone',
      'req.body.password',
      'req.body.dynamicCode',
    ],
    censor: '[REDACTED]',
  },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
});

/** 业务日志助手：自动脱敏手机号 */
export function bizLog(
  event: string,
  payload: Record<string, unknown> & { phone?: string },
): void {
  const safe = { ...payload };
  if (typeof safe.phone === 'string') safe.phone = maskPhone(safe.phone);
  logger.info({ event, ...safe }, event);
}

/** 子 logger（带模块名） */
export function moduleLogger(module: string) {
  return logger.child({ module });
}
