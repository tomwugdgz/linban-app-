// ============================================================================
// RBAC 权限点定义 —— 以霍承钧 API-CONTRACT §5 为单一事实源
// （服务端 middlewares/auth.ts 静态映射，prisma/seed.ts 双写落库）。
// 命名沿用契约：<域>:read 或 <域>:*；「登录即可」端点不在此表。
// ============================================================================

export interface PermDef {
  permKey: string;
  name: string;
  scope: string; // 覆盖的端/操作范围说明
}

export const PERMISSION_GROUPS: { module: string; moduleName: string; items: PermDef[] }[] = [
  {
    module: 'companion',
    moduleName: '陪聊员管理',
    items: [
      { permKey: 'companion:*', name: '陪聊员审核与管理', scope: '四审工作台、无犯罪裁定、保证金确认、信用分调整、状态（限流/冻结/清退）' },
    ],
  },
  {
    module: 'payment',
    moduleName: '分账与支付',
    items: [
      { permKey: 'payment:*', name: '分账执行', scope: '冻结分账单、手动结算（兜底）、僵死分账清理、分账模式查询' },
    ],
  },
  {
    module: 'withdrawal',
    moduleName: '提现审核',
    items: [
      { permKey: 'withdrawal:*', name: '提现审核', scope: '提现单审核（通过/驳回）' },
    ],
  },
  {
    module: 'recon',
    moduleName: '对账中心',
    items: [
      { permKey: 'recon:*', name: '对账执行', scope: '触发每日对账、查看批次与差异明细' },
    ],
  },
  {
    module: 'risk',
    moduleName: '风控事件',
    items: [
      { permKey: 'risk:*', name: '风控事件处置', scope: '事件队列、处置（WARN/INTERCEPT/LIMIT/PENALTY/BAN）' },
      // 契约 §10.5：健康告警工作台列表为 risk:read，处置类（ack/resolve/escalate）为 risk:*
      { permKey: 'risk:read', name: '风控与健康告警只读', scope: '风控/举报/投诉/健康告警列表查看（W-MVP 告警处置复用风控权限点，不新增 activity:*）' },
    ],
  },
  {
    module: 'complaint',
    moduleName: '投诉处理',
    items: [
      { permKey: 'complaint:*', name: '投诉裁决与补偿', scope: '投诉补偿、赔付裁决（动钱）' },
      // 与 complaint:* 分开：handle 只允许工单受理与结论填写，不含补偿裁决。
      // 客服能处置工单不等于能批钱——权限粒度失真比缺权限更危险。
      { permKey: 'complaint:handle', name: '投诉工单处置', scope: '工单受理、结论填写（不含补偿/赔付裁决）' },
    ],
  },
  {
    module: 'revenue',
    moduleName: '订阅营收（独立科目）',
    items: [
      // Q8 账务隔离：订阅收入不进 profit_sharing_records、不参与抽成，
      // 故权限也独立——不复用 payment:* / config:read / risk:*
      { permKey: 'revenue:read', name: '订阅营收查看', scope: '感知订阅营收只读报表（财务科目，不进分账池）' },
    ],
  },
  {
    module: 'marketing',
    moduleName: '营销后台',
    items: [
      { permKey: 'marketing:read', name: '营销查看', scope: '时长卡/团长/优惠券/老带新只读' },
      { permKey: 'marketing:*', name: '营销管理', scope: '券创建发放暂停恢复/时长卡发放/团长佣金结算/老带新规则' },
    ],
  },
  {
    module: 'report',
    moduleName: '举报核查',
    items: [
      { permKey: 'report:*', name: '举报核查', scope: '举报核查（属实→奖励券+飞单处罚）' },
    ],
  },
  {
    module: 'order',
    moduleName: '订单客服',
    items: [
      { permKey: 'order:*', name: '订单客服裁决', scope: '挂起订单裁决（COMPLETE/PARTIAL_REFUND 50%/FULL_REFUND）' },
    ],
  },
  {
    module: 'config',
    moduleName: '系统配置与审计',
    items: [
      { permKey: 'config:read', name: '配置与审计查看/热更新', scope: '系统配置列表、热更新（Redis 失效+audit_logs）、审计日志' },
    ],
  },
];

export const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.permKey));

/**
 * 四角色默认权限面（与契约 §5 RBAC 说明、prisma/seed.ts 对齐；admin 含 '*' 全量）。
 *
 * W-MVP 裁定（team-lead）：漏斗/健康看板三个读端点复用 `risk:read`，不新增 `activity:*`
 * （新增权限点要同步 seed.ts + auth.ts + admin-web 三处，W-MVP 扩三处不值）。
 * 但**数据要给对的人看**——财务要看投放 CAC 与单均带新成本，故 finance 补 `risk:read`。
 * W+1 随营收页拆 `activity:read` / `activity:funnel:read` / `activity:alert:handle`，
 * `revenue:read` 保持独立（Q8 账务隔离）。
 *
 * ops 已有 `risk:*`（按 hasPerm 的域通配规则已覆盖 risk:read），故不必重复登记。
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  admin: ['*', ...ALL_PERMISSION_KEYS],
  // 与 prisma/seed.ts 的 ROLES + middlewares/auth.ts 的 ROLE_PERMISSIONS **逐值一致**
  //（RBAC 三处双写面：seed 落库 / auth 中间件判定 / 本表前端按钮级渲染）
  ops: [
    'order:*', 'companion:*', 'verification:*', 'risk:*', 'risk:read',
    'report:*', 'complaint:*', 'complaint:handle', 'review:*',
    'marketing:*', 'marketing:read',
  ],
  finance: [
    'payment:*', 'withdrawal:*', 'recon:*', 'commission:*', 'config:read',
    'risk:read', 'marketing:read',
    // 订阅营收独立科目（Q8）：不用 payment:* 复用，否则能与分账合并看到
    'revenue:read',
  ],
  cs: [
    'order:read', 'complaint:*', 'complaint:handle', 'support:*',
    'user:read', 'risk:read', 'marketing:read',
  ],
};

/** 权限判断：命中具体键或域通配（如 companion:*）即放行；超级管理员令牌带 '*' */
export function hasPerm(perms: string[], need?: string): boolean {
  if (!need) return true;
  if (perms.includes('*')) return true;
  if (perms.includes(need)) return true;
  const domain = need.split(':')[0];
  return perms.includes(`${domain}:*`);
}
