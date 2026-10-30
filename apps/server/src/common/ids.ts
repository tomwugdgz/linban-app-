// ============================================================================
// 邻伴 · 业务单号生成（common 层，DATABASE.md §2.7）
// ----------------------------------------------------------------------------
// 约定：对外暴露单号、对内用自增 ID。单号格式：
//   <前缀><yyyyMMdd><10 位随机 base36 大写>
// 例：LB20261001K3F9Q2Z7XA。唯一性由 DB 唯一索引兜底（冲突即 500，
// 随机空间 36^10 ≈ 3.6e15，日单 500 下单碰撞概率可忽略）。
// ============================================================================

import { randomBytes, randomInt } from 'node:crypto';
import { BIZ_NO_PREFIX } from '@linban/shared';

export type BizNoType = keyof typeof BIZ_NO_PREFIX;

/** 生成业务单号 */
export function genBizNo(type: BizNoType, now: Date = new Date()): string {
  const prefix = BIZ_NO_PREFIX[type];
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
  return `${prefix}${y}${m}${d}${rand}`;
}

/** 生成 UUID（无横线，用于对象键/幂等键种子） */
export function genUuid(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 生成 6 位数字动态码（核销用，架构 §6.2）。
 * 用 crypto.randomInt 保证密码学随机（禁 Math.random）。
 */
export function genDynamicCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/** crypto.randomInt 包装（[min, max)） */
export { randomInt };

/**
 * 幂等键生成（客户端未传时服务端兜底）。
 * 建议客户端优先传（Idempotency-Key 头或 body.idempotency_key）。
 */
export function genIdempotencyKey(scope: string, ...parts: (string | number)[]): string {
  return `auto:${scope}:${parts.join(':')}:${Date.now()}:${randomBytes(4).toString('hex')}`;
}
