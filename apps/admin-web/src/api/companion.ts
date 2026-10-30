// 陪聊员管理 API（契约 5.2：credit / status；列表为前端补充；黑名单为契约缺口）
import { http } from './request';
import type { BlacklistItem, Companion, PageQuery, PageResult } from '@/shared/types';

export const companionApi = {
  list(params: PageQuery & { status?: string; keyword?: string; creditSort?: 'asc' | 'desc' }) {
    return http.get<PageResult<Companion>>('/admin/companions', params);
  },
  /** 契约：手动调整信用分（留痕 credit_logs） */
  adjustCredit(companionId: string, delta: number, reason: string) {
    return http.post<Companion>(`/admin/companions/${companionId}/credit`, { delta, reason });
  },
  /** 契约：陪聊员状态（限流/冻结/清退，联动阈值配置） */
  updateStatus(companionId: string, status: 'ACTIVE' | 'SUSPENDED' | 'BANNED', reason: string) {
    return http.post<Companion>(`/admin/companions/${companionId}/status`, { status, reason });
  },
};

// ---- 黑名单（契约缺口，前端补充）----
export const blacklistApi = {
  list(params: PageQuery & { targetType?: string; status?: string }) {
    return http.get<PageResult<BlacklistItem>>('/admin/blacklists', params);
  },
  create(data: {
    targetType: string;
    targetId: string;
    targetName: string;
    reason: string;
    scope: string;
    deviceFingerprint?: string;
    expiresAt?: string;
  }) {
    return http.post<BlacklistItem>('/admin/blacklists', data);
  },
  lift(id: string, reason: string) {
    return http.post<BlacklistItem>(`/admin/blacklists/${id}/lift`, { reason });
  },
};
