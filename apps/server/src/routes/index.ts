// ============================================================================
// 邻伴 · 路由汇总（架构 §4.4：routes 层只做挂载，业务在 modules）
// ============================================================================

import { Router } from 'express';
import {
  activityAdminRouter,
  activityRouter,
  adminRouter,
  aiRouter,
  authRouter,
  companionAdminRouter,
  companionRouter,
  fileAdminRouter,
  fileRouter,
  imRouter,
  insuranceAdminRouter,
  insuranceRouter,
  marketingAdminRouter,
  marketingRouter,
  notificationRouter,
  orderRouter,
  paymentAdminRouter,
  paymentRouter,
  riskAdminRouter,
  riskRouter,
  reviewRouter,
  supportAdminRouter,
  supportRouter,
  userRouter,
  verificationRouter,
} from '../modules';

export const apiRouter = Router();

// ---- 三端共用（/api/v1 前缀在 app.ts 统一挂）----
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/verifications', verificationRouter);
apiRouter.use('/im', imRouter);
apiRouter.use('/ai', aiRouter);
apiRouter.use('/reviews', reviewRouter);
apiRouter.use('/insurance', insuranceRouter);
apiRouter.use('/marketing', marketingRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/risk', riskRouter);
// ---- 健康活动感知（架构 §13；契约 §13）----
apiRouter.use('/activity', activityRouter);

// ---- 陪聊员端（companion 前缀路由，含入驻四审）----
apiRouter.use('/companion', companionRouter);
apiRouter.use('/companions', companionRouter);

// ---- 管理后台（/admin 前缀，adminAuthMiddleware 在各路由内声明）----
apiRouter.use('/admin', adminRouter);
apiRouter.use('/admin', supportAdminRouter);
apiRouter.use('/admin', riskAdminRouter);
apiRouter.use('/admin', companionAdminRouter);
apiRouter.use('/admin', paymentAdminRouter);
apiRouter.use('/admin', insuranceAdminRouter);
apiRouter.use('/admin', fileAdminRouter);
apiRouter.use('/admin', marketingAdminRouter);
apiRouter.use('/admin', activityAdminRouter);

// ---- 文件（三端 + 后台共用）----
apiRouter.use('/files', fileRouter);

// ---- 客服端（support 自己的端；C 端复用 admin 的 support 前缀已挂）----
apiRouter.use('/support', supportRouter);
