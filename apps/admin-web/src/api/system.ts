// 系统管理 API（契约 5.1 的 configs/audit-logs；admins/roles 为契约缺口）
import { http } from './request';
import type {
  AdminAccount,
  AuditLog,
  DispatchTimeoutItem,
  FileItem,
  PageQuery,
  PageResult,
  PolicyItem,
  RevisitItem,
  RoleItem,
} from '@/shared/types';

export const auditApi = {
  list(params: PageQuery & { module?: string; action?: string; keyword?: string }) {
    return http.get<PageResult<AuditLog>>('/admin/audit-logs', params);
  },
};

export const adminAccountApi = {
  list(params: PageQuery & { keyword?: string }) {
    return http.get<PageResult<AdminAccount>>('/admin/system/admins', params);
  },
  create(data: { username: string; realName: string; phone: string; roleId: string }) {
    return http.post<AdminAccount>('/admin/system/admins', data);
  },
  freeze(id: string) {
    return http.post<AdminAccount>(`/admin/system/admins/${id}/freeze`);
  },
  unfreeze(id: string) {
    return http.post<AdminAccount>(`/admin/system/admins/${id}/unfreeze`);
  },
};

export const roleApi = {
  list() {
    return http.get<RoleItem[]>('/admin/system/roles');
  },
  savePermissions(roleId: string, permKeys: string[]) {
    return http.put<RoleItem>(`/admin/system/roles/${roleId}/permissions`, { permKeys });
  },
};

// ---- 客服/台账（契约 5.5 / 5.6，登录即可）----
export const csApi = {
  dispatchTimeouts(params: PageQuery) {
    return http.get<PageResult<DispatchTimeoutItem>>('/admin/dispatch-timeout', params);
  },
  revisits(params: PageQuery) {
    return http.get<PageResult<RevisitItem>>('/admin/revisits', params);
  },
  policies(params: PageQuery) {
    return http.get<PageResult<PolicyItem>>('/admin/policies', params);
  },
  files(params: PageQuery) {
    return http.get<PageResult<FileItem>>('/admin/files', params);
  },
};
