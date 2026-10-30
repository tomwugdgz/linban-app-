// 看板 API（契约 5.1：GET /admin/dashboard；trend/todos 为前端补充端点）
import { http } from './request';
import type { DashboardMetrics, DashboardTodo, TrendPoint } from '@/shared/types';

export const dashboardApi = {
  metrics() {
    return http.get<DashboardMetrics>('/admin/dashboard');
  },
  trend(days = 30) {
    return http.get<TrendPoint[]>('/admin/dashboard/trend', { days });
  },
  todos() {
    return http.get<DashboardTodo>('/admin/dashboard/todos');
  },
};
