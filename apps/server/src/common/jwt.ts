// ============================================================================
// 邻伴 · JWT 工具（common 层：签发/校验，架构 §3.2/附录 B）
// ----------------------------------------------------------------------------
// access token 2h（JWT 无态）+ refresh token 30d（Redis 会话可踢）。
// 后台账号同机制 + 敏感操作二次 TOTP（otplib）。
// ============================================================================

import jwt from 'jsonwebtoken';
import { AppError } from '@linban/shared';
import { ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from '@linban/shared';
import type { user_role } from '@linban/shared';

/** 三端访问令牌载荷 */
export interface AccessTokenPayload {
  sub: string; // userId（string 防 BigInt 精度）
  role: user_role;
  /** 账号状态快照（冻结/注销即时失效） */
  st: 'ACTIVE' | 'FROZEN' | 'CANCELLED';
}

/** 后台访问令牌载荷 */
export interface AdminTokenPayload {
  sub: string; // adminId
  roleKey: string;
}

function accessSecret(): string {
  const s = process.env.JWT_ACCESS_SECRET;
  if (!s) throw new AppError(90005, 'JWT_ACCESS_SECRET 未配置');
  return s;
}

function refreshSecret(): string {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s) throw new AppError(90005, 'JWT_REFRESH_SECRET 未配置');
  return s;
}

/** 签发三端 access token */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_TOKEN_TTL_SEC, issuer: 'linban' });
}

/** 签发三端 refresh token */
export function signRefreshToken(userId: bigint): string {
  return jwt.sign({ sub: userId.toString(), typ: 'refresh' }, refreshSecret(), {
    expiresIn: REFRESH_TOKEN_TTL_SEC,
    issuer: 'linban',
  });
}

/** 校验 access token（过期抛 10003，其余抛 10002） */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, accessSecret(), { issuer: 'linban' });
    return decoded as AccessTokenPayload;
  } catch (e) {
    if ((e as Error).name === 'TokenExpiredError') {
      throw new AppError(10003, '访问令牌已过期');
    }
    throw new AppError(10002, '登录状态无效，请重新登录');
  }
}

/** 校验 refresh token */
export function verifyRefreshToken(token: string): { sub: string } {
  try {
    const decoded = jwt.verify(token, refreshSecret(), { issuer: 'linban' }) as { sub: string; typ?: string };
    if (decoded.typ !== 'refresh') throw new Error('not refresh token');
    return { sub: decoded.sub };
  } catch {
    throw new AppError(10002, '刷新令牌无效，请重新登录');
  }
}

/** 签发后台 access token */
export function signAdminToken(payload: AdminTokenPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_TOKEN_TTL_SEC, issuer: 'linban-admin' });
}

/** 校验后台 access token */
export function verifyAdminToken(token: string): AdminTokenPayload {
  try {
    return jwt.verify(token, accessSecret(), { issuer: 'linban-admin' }) as AdminTokenPayload;
  } catch (e) {
    if ((e as Error).name === 'TokenExpiredError') {
      throw new AppError(10003, '后台登录已过期');
    }
    throw new AppError(10002, '后台登录状态无效');
  }
}
