// 订单 API（列表/详情为前端补充；decide 为契约 5.5 客服裁决）
import { http } from './request';
import type { Order, OrderDetail, PageQuery, PageResult } from '@/shared/types';

export interface OrderQuery extends PageQuery {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  nightOrder?: boolean;
}

export const orderApi = {
  list(params: OrderQuery) {
    return http.get<PageResult<Order>>('/admin/orders', params as Record<string, unknown>);
  },
  detail(id: string) {
    return http.get<OrderDetail>(`/admin/orders/${id}`);
  },
  /** 契约：挂起订单裁决 */
  decide(id: string, decision: string, note: string) {
    return http.post<Order>(`/admin/orders/${id}/decide`, { decision, note });
  },
};
