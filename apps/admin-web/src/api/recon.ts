// 对账 API（契约 5.3：run + batches；差异处理为前端补充）
import { http } from './request';
import type { PageQuery, PageResult, ReconciliationRecord } from '@/shared/types';

export const reconApi = {
  batches(params: PageQuery & { status?: string; channel?: string; startDate?: string; endDate?: string }) {
    return http.get<PageResult<ReconciliationRecord>>('/admin/recon/batches', params);
  },
  /** 契约：触发每日对账 */
  run() {
    return http.post<ReconciliationRecord>('/admin/recon/run');
  },
  /** 前端补充：差异批次处理 */
  resolve(batchNo: string, note: string) {
    return http.post<ReconciliationRecord>(`/admin/recon/batches/${batchNo}/resolve`, { note });
  },
};
