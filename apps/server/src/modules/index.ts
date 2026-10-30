// ============================================================================
// 邻伴 · modules 层统一出口（13 业务域 + file/oss）
// 模块划分按业务边界（架构 §4.1），不按技术分层。
// ============================================================================

export { authRouter } from './auth/auth.routes';
export { userRouter } from './user/user.routes';
export { companionRouter, companionAdminRouter } from './companion/companion.routes';
export { orderRouter } from './order/order.routes';
export { paymentRouter, paymentAdminRouter } from './payment/payment.routes';
export { verificationRouter } from './verification/verification.routes';
export { imRouter } from './im/im.routes';
export { aiRouter } from './ai/ai.routes';
export { reviewRouter } from './review/review.routes';
export { insuranceRouter, insuranceAdminRouter } from './insurance/insurance.routes';
export { marketingRouter } from './marketing/marketing.routes';
export { marketingAdminRouter } from './marketing/marketing-admin.routes';
export { notificationRouter, sendNotification, sendSmsDirect } from './notification/notification.routes';
export { riskRouter, riskAdminRouter } from './risk/risk.routes';
export { adminRouter, loadAllConfigs } from './admin/admin.routes';
export { supportRouter, supportAdminRouter } from './support/support.routes';
export { fileRouter, fileAdminRouter } from './file/file.routes';
export { activityRouter, activityAdminRouter } from './activity/activity.routes';
