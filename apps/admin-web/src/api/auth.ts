// 认证 API（契约 §1.2：POST /auth/admin-login 签发 adminToken；GET /admin/me）
import { http } from './request';
import type { AdminInfo, LoginResult } from '@/shared/types';

export const authApi = {
  login(username: string, password: string) {
    return http.post<LoginResult>('/auth/admin-login', { username, password }, { silent: true });
  },
  me() {
    return http.get<{ admin: AdminInfo; permissions: string[] }>('/admin/me');
  },
};
