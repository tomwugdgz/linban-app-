// 提现审核 API（契约 5.3：POST /admin/withdrawals/:no/review；列表为前端补充）
import { http } from './request';
import type { PageQuery, PageResult, Withdrawal } from '@/shared/types';

export const withdrawalApi = {
  list(params: PageQuery & { status?: string; keyword?: string }) {
    return http.get<PageResult<Withdrawal>>('/admin/withdrawals', params);
  },
  review(withdrawalNo: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    return http.post<Withdrawal>(`/admin/withdrawals/${withdrawalNo}/review`, { action, reason });
  },
};
