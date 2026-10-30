// ============================================================================
// 健康活动感知 API（契约 §13.6 管理端 /admin/activity）
// 端点与权限严格对齐契约 §13.6：
//   GET  /admin/activity/dashboard   risk:read  活跃时段分布 / 设备在线率 / 告警处理时效
//   GET  /admin/activity/elders      risk:read  老人活动列表（分页，UNKNOWN 与过期须单独视觉分区）
//   GET  /admin/activity/funnel      risk:read  引流漏斗（7 触点）
//   GET  /admin/activity/revenue     revenue:read（独立科目，不进分账池 —— Q8）
//   GET  /admin/activity/alerts      risk:read  告警工作台
//   POST /admin/activity/alerts/:id/ack       risk:* → ACKNOWLEDGED，已处置 24002
//   POST /admin/activity/alerts/:id/resolve   risk:* → RESOLVED / DISMISSED（误报必填原因）
//   POST /admin/activity/alerts/:id/escalate  risk:* → 交叉验证不通过 24004，失败 24005
//
// 隐私红线（契约 §13.1）在页面侧的对应责任：
//   · 出参不含任何原始特征（SSID/BSSID/MAC/实时轨迹），前端也不新增此类字段；
//   · UNKNOWN 必须显式呈现原因，禁止与正常状态混排（隐私红线，运营看到 = 老人看到）。
// ============================================================================
import { http } from './request';
import type {
  ActivityDashboard,
  ActivityElderRow,
  ActivityFunnel,
  ActivityRevenue,
  HealthAlertRow,
  PageQuery,
  PageResult,
} from '@/shared/types';

/** 管理端只读端点（契约 §13.6，权限 risk:read） */
export const activityApi = {
  /** GET /admin/activity/dashboard：活跃时段分布 / 设备在线率 / 告警处理时效 */
  dashboard() {
    return http.get<ActivityDashboard>('/admin/activity/dashboard');
  },

  /**
   * GET /admin/activity/funnel：7 触点漏斗（契约 §13.6）。
   * @param dimension community=按小区 / trigger=按活动类型（§13.9 三触发器）/ date=按时间
   * @param days 统计窗口 7 / 30 / 90（契约未约束取值范围，服务端按 7/30/90 归一）
   */
  funnel(params: { dimension?: string; days?: number } = {}) {
    return http.get<ActivityFunnel>('/admin/activity/funnel', params);
  },

  /**
   * GET /admin/activity/elders（契约 §13.6，team-lead 已补登记）。
   * 契约硬约束：UNKNOWN 与信号过期必须单独视觉分区，禁止与正常状态混排——
   * 运营看到的就是老人端可见的，故页面用 row-unknown 底色 + 独立筛选器强制区分。
   *
   * 🔴 **参数名必须与服务端 zod 逐字一致**（`activity.routes.ts` 的 schema 只认下列 5 个键）。
   * zod `z.object()` 默认 strip：多传的键**不报错、不生效**，请求照样 200 返回全量——
   * 运营点筛选看到「没反应」，只会以为是自己选错了，不会怀疑后端没实现。
   * 本轮就踩过：`staleOnly` 是前端自造名，服务端收的是 `stale`，恒不命中。
   *
   * ⚠️ **未对齐的两项（等服务端补，我方无破坏性改动）**：
   *   · `community`：契约 §13.6 承诺「支持按社区筛选」，服务端 schema **尚无此键**（已报承钧）；
   *   · `keyword`：契约未承诺此筛选，但页面已有输入框、mock 也实现了 —— 两边都别留，待裁定。
   * 这两个键即便现在传出去也只是被 strip，故**先不传**，避免给「筛选生效了」的错觉。
   */
  elders(params: PageQuery & { status?: string; stale?: string; days?: number } = {}) {
    return http.get<PageResult<ActivityElderRow>>('/admin/activity/elders', params);
  },

  /**
   * GET /admin/activity/revenue：订阅营收报表（契约 §13.6，权限 `revenue:read`）。
   *
   * 🔴 **Q8 账务隔离**：这是**独立科目**，与分账报表**不相加**。
   * 本页禁止把它和佣金/分账收入合成一个「总收入」——那会让财务对账时无法解释差额。
   *
   * 摊分口径：**累计比例差分法**（服务端 domain/revenue.ts 的 prorateSubscription）。
   * 年费用户每月都有确认收入，不是首月一次性入账 —— 所以「本月入账」不会因为
   * 来了个年费单就突然跳 4900 分。前端**不做任何摊分推算**，只展示服务端给的数。
   *
   * @param start 窗口起（YYYY-MM-DD，含）；不传 = 本月月初
   * @param end   窗口止（YYYY-MM-DD，**含当日**）；不传 = 本月末
   * @param months 趋势月数（1–24，默认 6）
   */
  revenue(params: { start?: string; end?: string; months?: number } = {}) {
    return http.get<ActivityRevenue>('/admin/activity/revenue', params);
  },

  /** GET /admin/activity/alerts（契约权限 risk:read） */
  alerts(params: PageQuery & { status?: string; level?: string; type?: string; keyword?: string } = {}) {
    return http.get<PageResult<HealthAlertRow>>('/admin/activity/alerts', params);
  },

  /** POST /admin/activity/alerts/:id/ack：人工确认（→ ACKNOWLEDGED，记 ack_by） */
  ack(id: string, note?: string) {
    return http.post<HealthAlertRow>(`/admin/activity/alerts/${id}/ack`, { note });
  },

  /** POST /admin/activity/alerts/:id/resolve：落处置结论（RESOLVED / DISMISSED 误报） */
  resolve(id: string, data: { result: 'RESOLVED' | 'DISMISSED'; note?: string }) {
    return http.post<HealthAlertRow>(`/admin/activity/alerts/${id}/resolve`, data);
  },

  /**
   * POST /admin/activity/alerts/:id/escalate：升级对外追责。
   * 契约红线：交叉验证不通过一律拒绝（24004）；放行后落 complaints 工单复用 SOS 出口。
   */
  escalate(id: string, data: { note: string; crossVerifyConfirmed: boolean }) {
    return http.post<HealthAlertRow>(`/admin/activity/alerts/${id}/escalate`, data);
  },
};