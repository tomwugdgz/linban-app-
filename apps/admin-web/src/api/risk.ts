// 风控 API（契约 5.4：events / reports handle；complaints/sampling/举报列表为契约缺口）
import { http } from './request';
import type {
  Complaint,
  PageQuery,
  PageResult,
  Report,
  RiskEvent,
  SamplingTask,
} from '@/shared/types';

export const riskEventApi = {
  list(params: PageQuery & { status?: string; level?: string; type?: string }) {
    return http.get<PageResult<RiskEvent>>('/admin/risk/events', params);
  },
  /** 契约：处置（RESOLVED/FALSE_POSITIVE/PROCESSING；动作 WARN/INTERCEPT/LIMIT/PENALTY/BAN） */
  handle(eventNo: string, data: { action: string; actionTaken?: string; note?: string }) {
    return http.post<RiskEvent>(`/admin/risk/events/${eventNo}/handle`, data);
  },
};

export const reportApi = {
  list(params: PageQuery & { status?: string; keyword?: string }) {
    return http.get<PageResult<Report>>('/admin/reports', params);
  },
  /** 契约：举报核查（属实→奖励券 + 飞单 −20 分清退） */
  handle(reportNo: string, action: string, note: string) {
    return http.post<Report>(`/admin/reports/${reportNo}/handle`, { action, note });
  },
  /** 前端补充：举报属实奖励发放（金额取 system_configs.report_reward） */
  grantReward(reportNo: string) {
    return http.post<Report>(`/admin/reports/${reportNo}/reward`);
  },
};

export const complaintApi = {
  list(params: PageQuery & { status?: string; priority?: string; keyword?: string }) {
    return http.get<PageResult<Complaint>>('/admin/complaints', params);
  },
  handle(complaintNo: string, data: { action: string; resultNote?: string; compensationAmountFen?: number }) {
    return http.post<Complaint>(`/admin/complaints/${complaintNo}/handle`, data);
  },
};

export const samplingApi = {
  list(params: PageQuery & { status?: string }) {
    return http.get<PageResult<SamplingTask>>('/admin/sampling-tasks', params);
  },
  review(taskNo: string, result: string) {
    return http.post<SamplingTask>(`/admin/sampling-tasks/${taskNo}/review`, { result });
  },
};
