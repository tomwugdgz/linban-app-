// ============================================================================
// 邻伴 · 中间件：requestId / 鉴权 / RBAC / 限流 / 幂等
// ============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '@linban/shared';
import type { user_role } from '@linban/shared';
import { genUuid } from '../common/ids';
import { verifyAccessToken, verifyAdminToken } from '../common/jwt';
import { sessionAlive } from '../infra/redis';

/** 请求上下文（挂 req.user / req.admin） */
export interface RequestUser {
  userId: bigint;
  role: user_role;
  status: 'ACTIVE' | 'FROZEN' | 'CANCELLED';
}

export interface RequestAdmin {
  adminId: bigint;
  roleKey: string;
  username: string;
}

/** requestId 透传（架构附录 B：全链路一个 requestId） */
export const requestIdMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming.slice(0, 64) : genUuid();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

/** 三端鉴权：Authorization: Bearer <accessToken> */
export const authMiddleware: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(10002, '缺少访问令牌');
    }
    const payload = verifyAccessToken(header.slice(7));
    const user: RequestUser = {
      userId: BigInt(payload.sub),
      role: payload.role,
      status: payload.st,
    };
    // 账号状态快照 + Redis 会话双重校验（冻结/注销/踢下线即时生效）
    if (user.status !== 'ACTIVE') {
      throw user.status === 'FROZEN' ? new AppError(11004) : new AppError(11005);
    }
    if (!(await sessionAlive(user.userId))) {
      throw new AppError(10002, '登录状态已失效，请重新登录');
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

/** 角色守卫（如仅老人账号可操作） */
export function roleGuard(...roles: user_role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError(10002));
    if (!roles.includes(req.user.role)) return next(new AppError(10004, `需要角色: ${roles.join('/')}`));
    next();
  };
}

/** 后台鉴权：Authorization: Bearer <adminToken> */
export const adminAuthMiddleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(10002, '缺少后台访问令牌');
    }
    const payload = verifyAdminToken(header.slice(7));
    req.admin = {
      adminId: BigInt(payload.sub),
      roleKey: payload.roleKey,
      username: '', // 详情由 handler 按需查库
    };
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * 后台权限点守卫（RBAC：role_permissions）。
 * MVP 简化：按 roleKey 映射权限集合（角色四类 admin/ops/finance/cs，
 * 权限点表种子数据见 prisma/seed.ts）。
 *
 * 匹配规则（主理人裁定，2026-10 修正）：
 *   1. 精确匹配：`rolePerms` 含该权限点 → 通过；
 *   2. **通配匹配**：`rolePerms` 含 `'<模块>:*'`（如 `risk:*`）→ 该模块下任意权限点通过，
 *      含 `risk:read`；
 *   3. **超管**：`rolePerms` 含 `'*'` → 通过全部检查。
 * 修正原因：原实现用 `rolePerms.includes(p)` 精确匹配，导致
 *   ① admin（权限为 `['*']`）访问任何后台端点都被拒（10004）；
 *   ② 持有 `risk:*` 的角色访问 `risk:read` 被拒。
 *   两者都会让后台功能实际不可用。
 */
/**
 * 单权限点判定（**纯函数，导出供单测直接调用**）。
 *
 * 为什么要导出而不是把逻辑藏在中间件里：
 *   中间件内的 `granted` 是闭包，测它只能靠"起一个假 req 打一发"，
 *   或者——更常见的做法——在测试文件里**复刻一份**。
 *   后者是自欺：复刻的那份自己没人测，若把 `p.split(':')[0]` 写成
 *   `p.split(':')[1]`（取到子动作而非模块），断言会**全部按错误实现通过**，
 *   真实实现是对的而测试永绿 —— 比没有测试更糟，因为它给人虚假的安全感。
 *   导出后测试打的是真实现，错了就红。
 *
 * 匹配规则（主理人裁定，2026-10 修正）：
 *   1. 超管：`rolePerms` 含 `'*'` → 通过全部；
 *   2. 精确：含该权限点 → 通过；
 *   3. 模块级通配：含 `'<模块>:*'`（如 `risk:*`）→ 该模块下任意权限点通过，
 *      含三段式 `risk:alert:handle`（模块段取第0 段，不是第 1 段）。
 *
 * 修正原因：原实现用 `rolePerms.includes(p)` 精确匹配，导致
 *   ① admin（权限为 `['*']`）访问任何后台端点都被拒（10004）；
 *   ② 持有 `risk:*` 的角色访问 `risk:read` 被拒。
 */
export function permGranted(rolePerms: readonly string[], need: string): boolean {
  if (rolePerms.includes('*')) return true;
  if (rolePerms.includes(need)) return true;
  // 模块级通配：`risk:*` 覆盖 `risk:read` / `risk:*` / `risk:alert:handle`
  const mod = need.split(':')[0] ?? '';
  return mod.length > 0 && rolePerms.includes(`${mod}:*`);
}

export function adminPermGuard(...perms: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.admin) return next(new AppError(10002));
    const rolePerms = ROLE_PERMISSIONS[req.admin.roleKey] ?? [];
    const ok = perms.every((p) => permGranted(rolePerms, p));
    if (!ok) return next(new AppError(10004, `缺少权限: ${perms.join(',')}`));
    next();
  };
}

/** RBAC 静态映射（MVP：四角色硬映射；动态角色后续进 roles 表）
 *  必须与 prisma/seed.ts 的 ROLES 保持逐值一致（RBAC 双写面，两处）。
 *  语义：`'*'` = 超管全部；`'<模块>:*'` = 该模块全部权限点（含 `:<模块>:read` 等子权限）。
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'], // 超管
  ops: [
    'order:*',
    'companion:*',
    'verification:*',
    'risk:*',
    'risk:read',
    'report:*',
    'complaint:*',
    'complaint:handle',
    'review:*',
    'marketing:*',
    'marketing:read',
  ],
  finance: [
    'payment:*',
    'withdrawal:*',
    'recon:*',
    'commission:*',
    'config:read',
    'risk:read', // 漏斗/健康看板：投放 CAC 与带新成本需财务可见（主理人裁定）
    'marketing:read', // 券发放与团长结算单需财务只读
    'revenue:read', // 订阅营收是财务科目（Q8）；独立于分账，不用 payment:* 复用
  ],
  cs: [
    'order:read',
    'complaint:*',
    'complaint:handle',
    'support:*',
    'user:read',
    'risk:read',
    'marketing:read', // 客服发券/查时长卡
    //刻意不给 revenue:read：客服无营收查看职责
  ],
};
