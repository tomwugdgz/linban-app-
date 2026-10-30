// ============================================================================
// Express 请求对象扩展（req.user / req.admin / locals）
// ============================================================================

import type { user_role } from '@linban/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** 三端登录用户（authMiddleware 注入） */
      user?: {
        userId: bigint;
        role: user_role;
        status: 'ACTIVE' | 'FROZEN' | 'CANCELLED';
      };
      /** 后台登录账号（adminAuthMiddleware 注入） */
      admin?: {
        adminId: bigint;
        roleKey: string;
        username: string;
      };
    }
  }
}

export {};
