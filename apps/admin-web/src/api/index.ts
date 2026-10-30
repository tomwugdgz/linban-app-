// API 统一出口：页面只从这里取模块，路径与契约 §5 对齐
export { http, ApiError } from './request';
export { authApi } from './auth';
export { dashboardApi } from './dashboard';
export { profitApi, configApi } from './profit';
export { withdrawalApi } from './withdrawal';
export { reconApi } from './recon';
export { applicationApi } from './application';
export { companionApi, blacklistApi } from './companion';
export { orderApi } from './order';
export { giftCardApi, distributorApi, commissionApi, couponApi, inviteRuleApi } from './marketing';
export { riskEventApi, reportApi, complaintApi, samplingApi } from './risk';
export { activityApi } from './activity';
export { auditApi, adminAccountApi, roleApi, csApi } from './system';
