// 分账 API（契约 5.3：frozen 列表 / manual-settle / sweep-stale；全量流水与导出为前端补充）
import { http } from './request';
import type {
  ConfigChangeLog,
  PageQuery,
  PageResult,
  ProfitSharingRecord,
  SystemConfig,
  TruncatedPageResult,
} from '@/shared/types';

export interface SharingQuery extends PageQuery {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

export const profitApi = {
  /** 分账流水全量（前端补充端点） */
  list(params: SharingQuery) {
    return http.get<PageResult<ProfitSharingRecord>>('/admin/sharings', params);
  },
  /** 契约：冻结分账单（待分账/重试中） */
  frozenList(params: PageQuery & { keyword?: string }) {
    return http.get<PageResult<ProfitSharingRecord>>('/admin/sharings/frozen', params);
  },
  export(params: SharingQuery) {
    return http.exportCsv('/admin/sharings/export', params);
  },
  /** 契约：手动结算（兜底模式），操作必须留审计 */
  manualSettle(sharingNo: string) {
    return http.post<ProfitSharingRecord>(`/admin/sharings/${sharingNo}/manual-settle`);
  },
  /** 契约：清理僵死分账（>7 天） */
  sweepStale() {
    return http.post<{ sweptCount: number; sweptAmountFen: string }>('/admin/sharings/sweep-stale');
  },
  /** 契约：当前分账模式（wechat_profit_sharing | manual_settlement_fallback） */
  splitMode() {
    return http.get<string>('/payments/split-mode');
  },
};

// ---- 系统配置（契约 5.1：GET/PUT /admin/configs）----
export interface ConfigLogQuery extends PageQuery {
  /** 配置域（对齐 shared/config-meta.ts 的 CONFIG_GROUPS 键） */
  group?: string;
  /** 配置项 key 精确筛选 */
  configKey?: string;
  /** 操作人筛选 */
  operator?: string;
  /** 模糊搜索：配置项 / 操作人 / 配置值 */
  keyword?: string;
}

export const configApi = {
  list() {
    return http.get<SystemConfig[]>('/admin/configs');
  },
  update(configKey: string, configValue: string) {
    return http.put<SystemConfig>(`/admin/configs/${configKey}`, { configValue });
  },
  /**
   * 配置变更历史（契约 §5.7.7 已登记，权限 `config:read`）。
   *
   * 落位口径：schema **没有** `config_change_logs` 表，配置变更统一落 `audit_logs`
   * （module=system / action=update，靠 before_json + after_json 还原改动前后），
   * 故这是 audit_logs 的过滤视图，不是新表。
   *
   * 路径单数 `changelog`（契约 §5.7 开篇已统一命名，与 `/admin/audit-logs` 同风格）。
   *
   * 🔴 出参用 `TruncatedPageResult` 而非 `PageResult`：契约 §5.7.7 要求
   * `truncated === true` 时提示「请收紧筛选条件」，且**不得把候选集条数当 `total` 展示**
   * （`operator`/`keyword` 只能应用层筛，服务端有候选集上限 500）。
   */
  changeLogs(params: ConfigLogQuery) {
    return http.get<TruncatedPageResult<ConfigChangeLog>>('/admin/configs/changelog', params);
  },
};
