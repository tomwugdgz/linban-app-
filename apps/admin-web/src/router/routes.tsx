// ============================================================================
// 路由表 + 菜单元数据（权限驱动菜单：meta.perm 缺省视为登录即可）
// perm 键以 API-CONTRACT §5 为准；契约未覆盖的模块见交付报告偏差清单。
// ============================================================================
import { lazy, type ComponentType } from 'react';
import {
  AimOutlined,
  AlertOutlined,
  AuditOutlined,
  BankOutlined,
  CommentOutlined,
  CreditCardOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  HeartOutlined,
  HistoryOutlined,
  LockOutlined,
  NotificationOutlined,
  PartitionOutlined,
  ProfileOutlined,
  ReconciliationOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShopOutlined,
  SlidersOutlined,
  StopOutlined,
  TagOutlined,
  TeamOutlined,
  ToolOutlined,
  UserAddOutlined,
  WalletOutlined,
} from '@ant-design/icons';

export interface RouteMeta {
  title: string;
  perm?: string;
  icon?: ComponentType;
  group?: string; // 菜单分组名；缺省为一级菜单
  desc?: string; // 页面副标题
}

export interface AppRoute {
  path: string;
  element: ComponentType;
  meta: RouteMeta;
}

// 页面组件统一懒加载：后台 25 个页面首屏只需 1 个，
// 配合 vite 分包可把 echarts（1MB raw）从首屏挪到看板页按需加载
const lazyPage = <P extends object>(loader: () => Promise<Record<string, ComponentType<P>>>) =>
  lazy(async () => ({ default: (await loader()).default }));

const DashboardPage = lazyPage(() => import('@/pages/dashboard/DashboardPage'));
const SharingsPage = lazyPage(() => import('@/pages/profit/SharingsPage'));
const FrozenSharingsPage = lazyPage(() => import('@/pages/profit/FrozenSharingsPage'));
const WithdrawalsPage = lazyPage(() => import('@/pages/profit/WithdrawalsPage'));
const ReconPage = lazyPage(() => import('@/pages/profit/ReconPage'));
const CommissionConfigPage = lazyPage(() => import('@/pages/profit/CommissionConfigPage'));
const ApplicationsPage = lazyPage(() => import('@/pages/companion/ApplicationsPage'));
const CompanionListPage = lazyPage(() => import('@/pages/companion/CompanionListPage'));
const BlacklistPage = lazyPage(() => import('@/pages/companion/BlacklistPage'));
const OrderListPage = lazyPage(() => import('@/pages/orders/OrderListPage'));
const OrderDetailPage = lazyPage(() => import('@/pages/orders/OrderDetailPage'));
const CsWorkbenchPage = lazyPage(() => import('@/pages/orders/CsWorkbenchPage'));
const GiftCardsPage = lazyPage(() => import('@/pages/marketing/GiftCardsPage'));
const DistributorsPage = lazyPage(() => import('@/pages/marketing/DistributorsPage'));
const CouponsPage = lazyPage(() => import('@/pages/marketing/CouponsPage'));
const InviteRulesPage = lazyPage(() => import('@/pages/marketing/InviteRulesPage'));
const ComplaintsPage = lazyPage(() => import('@/pages/risk/ComplaintsPage'));
const ReportsPage = lazyPage(() => import('@/pages/risk/ReportsPage'));
const SamplingPage = lazyPage(() => import('@/pages/risk/SamplingPage'));
const RiskEventsPage = lazyPage(() => import('@/pages/risk/RiskEventsPage'));
const ConfigsPage = lazyPage(() => import('@/pages/system/ConfigsPage'));
const ConfigChangelogPage = lazyPage(() => import('@/pages/system/ConfigChangelogPage'));
const RbacPage = lazyPage(() => import('@/pages/system/RbacPage'));
const AuditLogsPage = lazyPage(() => import('@/pages/system/AuditLogsPage'));
const LedgerPage = lazyPage(() => import('@/pages/ledger/LedgerPage'));
const HealthBoardPage = lazyPage(() => import('@/pages/health/HealthBoardPage'));
const FunnelPage = lazyPage(() => import('@/pages/funnel/FunnelPage'));
// 订阅营收（Q8 独立科目，与分账报表不相加）
const RevenuePage = lazyPage(() => import('@/pages/funnel/RevenuePage'));

export const routes: AppRoute[] = [
  {
    path: '/dashboard',
    element: DashboardPage,
    meta: { title: '数据看板', icon: DashboardOutlined, desc: '经营核心指标与近期待办' },
  },
  {
    path: '/profit/sharings',
    element: SharingsPage,
    meta: { title: '分账流水', group: '分账管理', perm: 'payment:*', icon: PartitionOutlined, desc: '自动分账流水，筛选导出' },
  },
  {
    path: '/profit/frozen',
    element: FrozenSharingsPage,
    meta: { title: '冻结分账', group: '分账管理', perm: 'payment:*', icon: LockOutlined, desc: '待分账/重试中，支持手动结算兜底' },
  },
  {
    path: '/profit/withdrawals',
    element: WithdrawalsPage,
    meta: { title: '提现审核', group: '分账管理', perm: 'withdrawal:*', icon: WalletOutlined, desc: 'T+1 审核流，通过/驳回须填原因' },
  },
  {
    path: '/profit/recon',
    element: ReconPage,
    meta: { title: '对账中心', group: '分账管理', perm: 'recon:*', icon: ReconciliationOutlined, desc: 'local vs 微信差异批次与处理' },
  },
  {
    path: '/profit/config',
    element: CommissionConfigPage,
    meta: { title: '抽成配置', group: '分账管理', perm: 'config:read', icon: SlidersOutlined, desc: 'commission_rate 等全量配置热更新' },
  },
  {
    path: '/companion/applications',
    element: ApplicationsPage,
    meta: { title: '四审队列', group: '陪聊员管理', perm: 'companion:*', icon: AuditOutlined, desc: '实名/人脸/无犯罪/保证金四步审核' },
  },
  {
    path: '/companion/list',
    element: CompanionListPage,
    meta: { title: '陪聊员列表', group: '陪聊员管理', perm: 'companion:*', icon: TeamOutlined, desc: '信用分/等级/保证金/封禁管理' },
  },
  {
    path: '/companion/blacklist',
    element: BlacklistPage,
    meta: { title: '黑名单', group: '陪聊员管理', perm: 'companion:*', icon: StopOutlined, desc: '用户/陪聊员/设备黑名单与解除' },
  },
  {
    path: '/orders',
    element: OrderListPage,
    meta: { title: '订单列表', group: '订单管理', icon: ProfileOutlined, desc: '多维筛选，双方信息脱敏展示' },
  },
  {
    path: '/orders/cs',
    element: CsWorkbenchPage,
    meta: { title: '客服工作台', group: '订单管理', icon: CustomerServiceOutlined, desc: '派单超时候补 / 回访任务 / 挂起裁决' },
  },
  {
    path: '/orders/:id',
    element: OrderDetailPage,
    meta: { title: '订单详情', icon: FileTextOutlined, desc: '状态机时间线/核销记录/分账记录' },
  },
  {
    path: '/marketing/gift-cards',
    element: GiftCardsPage,
    meta: { title: '孝心时长卡', group: '裂变营销', perm: 'marketing:read', icon: CreditCardOutlined, desc: '发行/绑定/核销台账' },
  },
  {
    path: '/marketing/distributors',
    element: DistributorsPage,
    meta: { title: '社区团长', group: '裂变营销', perm: 'marketing:read', icon: ShopOutlined, desc: '团长列表与佣金结算' },
  },
  {
    path: '/marketing/coupons',
    element: CouponsPage,
    meta: { title: '优惠券', group: '裂变营销', perm: 'marketing:read', icon: TagOutlined, desc: '创建/发放/暂停' },
  },
  {
    path: '/marketing/invite',
    element: InviteRulesPage,
    meta: { title: '老带新规则', group: '裂变营销', perm: 'marketing:read', icon: UserAddOutlined, desc: '邀请人与被邀请人奖励规则' },
  },
  {
    path: '/risk/complaints',
    element: ComplaintsPage,
    meta: { title: '投诉处理', group: '风控中心', icon: CommentOutlined, desc: '工单流：受理/解决/驳回 + 补偿' },
  },
  {
    path: '/risk/reports',
    element: ReportsPage,
    meta: { title: '举报管理', group: '风控中心', icon: NotificationOutlined, desc: '飞单举报核查与奖励发放' },
  },
  {
    path: '/risk/sampling',
    element: SamplingPage,
    meta: { title: '抽检任务', group: '风控中心', icon: SearchOutlined, desc: 'AI 会话/IM 内容人工抽检' },
  },
  {
    path: '/risk/events',
    element: RiskEventsPage,
    meta: { title: '风险事件', group: '风控中心', icon: AlertOutlined, desc: '风控事件队列与处置' },
  },
  {
    path: '/system/configs',
    element: ConfigsPage,
    meta: { title: '系统配置', group: '系统管理', perm: 'config:read', icon: ToolOutlined, desc: 'system_configs 可视化编辑（热更新）' },
  },
  {
    // 落位 audit_logs（module=system）的过滤视图，非新表；端点待霍承钧补登记
    path: '/system/config-changelog',
    element: ConfigChangelogPage,
    meta: { title: '配置变更历史', group: '系统管理', perm: 'config:read', icon: HistoryOutlined, desc: '谁在何时把哪个配置从什么改成了什么（before/after 对照）' },
  },
  {
    path: '/system/rbac',
    element: RbacPage,
    meta: { title: '管理员与角色', group: '系统管理', perm: '*', icon: SafetyCertificateOutlined, desc: '管理员账号与角色权限矩阵（仅超管）' },
  },
  {
    path: '/system/audit',
    element: AuditLogsPage,
    meta: { title: '审计日志', group: '系统管理', perm: 'config:read', icon: FileProtectOutlined, desc: '全操作审计查询（按 requestId 回溯）' },
  },
  {
    path: '/ledger',
    element: LedgerPage,
    meta: { title: '保单与文件台账', icon: DatabaseOutlined, desc: '保险批量投保台账 / 文件元数据台账' },
  },
  {
    // 契约 §10.5：看板/漏斗登录即可；本页告警区处置按钮另需 risk:*（PermissionButton 控制）
    path: '/health/board',
    element: HealthBoardPage,
    meta: { title: '健康活动看板', group: '健康活动感知', perm: 'risk:read', icon: HeartOutlined, desc: '老人活动状态 / 数据新鲜度 / 告警队列（参考指标非诊断）' },
  },
  {
    // 契约 §13.6 三个读端点（dashboard/elders/funnel）权限均为 risk:read，与本页保持一致
    path: '/activity/funnel',
    element: FunnelPage,
    meta: { title: '引流漏斗', group: '健康活动感知', perm: 'risk:read', icon: AimOutlined, desc: '七触点转化 / 最大流失环节 / 触发器归因' },
  },
  {
    // 🔴 Q8 账务隔离：订阅收入是**独立科目**，不进陪聊分账池。
    //    权限是 revenue:read（独立权限点，不复用 payment:* / recon:*）——
    //    财务才能只给「看订阅营收」而不给「看分账」的人。
    //    **菜单文案刻意不叫「营收」而叫「订阅营收」**：与「分账流水」在字面上就不可混淆。
    path: '/activity/revenue',
    element: RevenuePage,
    meta: { title: '订阅营收', group: '健康活动感知', perm: 'revenue:read', icon: BankOutlined, desc: '家庭订阅收入（独立科目，不进分账池）' },
  },
];

export const menuRoutes = routes.filter((r) => r.meta.group);
