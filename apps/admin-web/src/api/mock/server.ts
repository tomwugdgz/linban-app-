// ============================================================================
// Mock 适配层：路径与 docs/API-CONTRACT.md §5（管理后台/客服）逐条对齐。
// 标记 [前端补充] 的端点为契约缺口（schema 有表但契约未登记），
// 已列入交付报告的偏差清单，待霍承钧确认补登记。
// 行为模拟：分页/筛选/写操作状态变更/脱敏出参/导出 CSV。
// ============================================================================
import type {
  ActivityDashboard,
  ActivityFunnel,
  OfflineTouchpointAttribution,
  OrderTimelineItem,
  PageResult,
} from '@/shared/types';
// ⚠️ 值导入必须与上面的 `import type` 分开写：写在 type 块里会被 TS 编译期剥离，
// 运行时拿到 undefined（症状是 slice(0, undefined) 返回空数组，不报错）。
import { REVENUE_DETAIL_LIMIT } from '@/shared/types';
import { maskAddress, maskBankCard, maskName, maskPhone } from '@/shared/mask';
import { ROLE_DEFAULT_PERMISSIONS } from '@/shared/permissions';
import { configGroupOf, configLabel as configLabelOf } from '@/shared/config-meta';
import { SPLIT_MODE } from '@linban/shared';
import * as db from './db';
import * as act from './db-activity';

export interface MockCtx {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
}

type Handler = (ctx: MockCtx) => unknown;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}
const routes: Route[] = [];

function on(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path
        // 先转义正则元字符（':' 不在元字符集内，保留给下一步）
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // 再把 :param 转成捕获组并记录参数名
        .replace(/:(\w+)/g, (_, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
      '$',
  );
  routes.push({ method, pattern, keys, handler });
}

const LATENCY = 120; // 模拟网络延迟（ms），便于观察 loading 态

/**
 * 按契约 §2 抛出业务错误：{ code, message }。
 * request 层 normalizeError 会包装为 ApiError，与真实后端走同一条错误处理路径。
 */
function fail(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

export function dispatch(method: string, url: string, body?: unknown): Promise<unknown> {
  const [pathRaw, queryRaw = ''] = url.split('?');
  const query: Record<string, string> = {};
  new URLSearchParams(queryRaw).forEach((v, k) => (query[k] = v));
  const route = routes.find((r) => r.method === method && r.pattern.test(pathRaw));
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!route) {
        reject(fail(10007, `接口未登记：${method} ${pathRaw}`));
        return;
      }
      const m = pathRaw.match(route.pattern)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        resolve(route.handler({ method, path: pathRaw, params, query, body: (body ?? {}) as Record<string, unknown> }));
      } catch (e) {
        reject(e);
      }
    }, LATENCY);
  });
}

// ---- 通用分页 / 筛选 ----
function paginate<T>(list: T[], query: Record<string, string>): PageResult<T> {
  const page = Math.max(Number(query.page ?? 1), 1);
  const pageSize = Math.max(Number(query.pageSize ?? 20), 1);
  const start = (page - 1) * pageSize;
  return { list: list.slice(start, start + pageSize), total: list.length, page, pageSize };
}
const q = (query: Record<string, string>, key: string) => (query[key] ?? '').trim();
const contains = (src: string | undefined, kw: string) => (src ?? '').toLowerCase().includes(kw.toLowerCase());
const inDateRange = (iso: string, start?: string, end?: string) =>
  (!start || iso.slice(0, 10) >= start) && (!end || iso.slice(0, 10) <= end);
const nowIso = () => new Date().toISOString();

let currentOperator = '岑执衡';
export const setMockOperator = (name: string) => (currentOperator = name);

/** 角色权限覆写（mock）：RBAC 保存后即时生效；admin 角色不可改 */
const rolePermOverrides: Record<string, string[]> = {};
const getRolePerms = (roleId: string): string[] => {
  const role = db.roles.find((r) => r.id === roleId);
  if (!role) return [];
  return rolePermOverrides[role.roleKey] ?? ROLE_DEFAULT_PERMISSIONS[role.roleKey] ?? [];
};

// ============================================================================
// 认证（契约：POST /auth/admin-login 签发 adminToken；GET /admin/me）
// ============================================================================
on('POST', '/auth/admin-login', ({ body }) => {
  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const account = db.mockLoginAccounts[username];
  if (!account || account.password !== password) {
    throw fail(11006, '账号或密码错误');
  }
  const admin = db.mockAdminByUsername(username)!;
  const role = db.roles.find((r) => r.id === admin.roleId)!;
  setMockOperator(admin.realName);
  return {
    adminToken: `mock-admin-token-${username}-${Date.now()}`,
    admin: {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phoneMasked: maskPhone(admin.phone),
      roleId: role.id,
      roleKey: role.roleKey,
      roleName: role.name,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
    },
    permissions: getRolePerms(admin.roleId),
  };
});

on('GET', '/admin/me', () => {
  const admin = db.adminAccounts[0];
  const role = db.roles.find((r) => r.id === admin.roleId)!;
  return {
    admin: {
      id: admin.id,
      username: admin.username,
      realName: admin.realName,
      phoneMasked: maskPhone(admin.phone),
      roleId: role.id,
      roleKey: role.roleKey,
      roleName: role.name,
      status: admin.status,
      lastLoginAt: admin.lastLoginAt,
    },
    permissions: getRolePerms(admin.roleId),
  };
});

// ============================================================================
// 看板（契约：GET /admin/dashboard；trend/todos 为 [前端补充]）
// ============================================================================
on('GET', '/admin/dashboard', () => {
  const paidOrders = db.orders.filter((o) => !['CREATED', 'CANCELLED'].includes(o.status));
  const gmv = paidOrders.reduce((s, o) => s + Number(o.totalAmountFen), 0);
  const frozen = db.sharings.filter((s) => s.status === 'FROZEN').reduce((s, r) => s + Number(r.frozenAmountFen), 0);
  return {
    gmvFen: String(gmv),
    orderCount: db.orders.length,
    frozenSharingFen: String(frozen),
    profitIncomeFen: String(db.sharings.reduce((s, r) => s + Number(r.platformCommissionFen), 0)),
    activeCompanions: db.companions.filter((c) => c.status === 'ACTIVE').length,
    verificationPassRate: 93,
    riskEventCount: db.riskEvents.filter((r) => r.status === 'PENDING').length,
  };
});

on('GET', '/admin/dashboard/trend', ({ query }) => {
  const days = Number(query.days ?? 30);
  return Array.from({ length: days }, (_, i) => {
    const d = db.mockIso(days - 1 - i).slice(0, 10);
    const dayOrders = db.orders.filter((o) => o.serviceDate === d && !['CREATED', 'CANCELLED'].includes(o.status));
    const gmv = dayOrders.reduce((s, o) => s + Number(o.totalAmountFen), 0);
    const profit = db.sharings
      .filter((r) => r.createdAt.slice(0, 10) === d)
      .reduce((s, r) => s + Number(r.platformCommissionFen), 0);
    return { date: d, gmvFen: String(gmv), orderCount: dayOrders.length, profitFen: String(profit) };
  });
});

on('GET', '/admin/dashboard/todos', () => ({
  pendingApplications: db.applications.filter((a) => !['ACTIVE', 'BANNED'].includes(a.stage)).length,
  pendingWithdrawals: db.withdrawals.filter((w) => w.status === 'PENDING_REVIEW').length,
  pendingComplaints: db.complaints.filter((c) => ['PENDING', 'PROCESSING'].includes(c.status)).length,
  pendingRiskEvents: db.riskEvents.filter((r) => r.status === 'PENDING').length,
  pendingReports: db.reports.filter((r) => r.status === 'PENDING').length,
}));

// ============================================================================
// 系统配置与审计（契约 5.1）
// ============================================================================
on('GET', '/admin/configs', () => db.systemConfigs.map((c) => ({ ...c })));

on('PUT', '/admin/configs/:key', ({ params, body }) => {
  const cfg = db.systemConfigs.find((c) => c.configKey === params.key);
  if (!cfg) throw fail(21003, '配置项不存在');
  const beforeValue = cfg.configValue;
  cfg.configValue = String(body.configValue);
  cfg.updatedBy = currentOperator;
  cfg.updatedAt = nowIso();
  db.configChangeLogs.unshift({
    id: String(db.configChangeLogs.length + 1),
    configKey: cfg.configKey,
    configLabel: configLabelOf(cfg.configKey),
    beforeValue,
    afterValue: cfg.configValue,
    operator: currentOperator,
    // requestId 与 IP 随 audit_logs 一起落（合规审计要能回溯到服务端日志）
    requestId: `req_${Math.floor(100000 + Math.random() * 899999)}`,
    ip: '47.253.159.24',
    changedAt: nowIso(),
  });
  return { ...cfg };
});

/**
 * 配置变更历史（契约 §5.7.7 已登记；落audit_logs 过滤视图，**不新建表**）。
 *
 * schema 没有 config_change_logs 表，配置变更与其它后台操作统一落 audit_logs
 * （module=system / action=update，变更前快照在 before_json、变更后在 after_json）。
 *
 * 出参字段名以契约 §5.7.7 为准：`configKey / beforeValue / afterValue / operator /
 * changedAt / requestId`。**before/after 双值是硬要求**——财务要查
 * 「谁把佣金从 5% 改成 8%」必须有双值对照，单值查不出来。
 */
on('GET', '/admin/configs/changelog', ({ query }) => {
  let list = db.configChangeLogs.map((c) => ({ ...c }));
  const configKey = q(query, 'configKey');
  const operator = q(query, 'operator');
  const group = q(query, 'group');
  const kw = q(query, 'keyword');
  if (configKey) list = list.filter((c) => c.configKey === configKey);
  if (operator) list = list.filter((c) => c.operator === operator);
  if (group) list = list.filter((c) => configGroupOf(c.configKey) === group);
  if (kw) list = list.filter((c) => contains(c.configKey, kw) || contains(c.operator, kw) || contains(c.requestId, kw));
  list.sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
  // 🔴 必须回 truncated（契约 §5.7.7）：operator/keyword 只能应用层筛，
  // 候选集上限 500。前端据此提示「请收紧筛选条件」并禁止把 total 当全库条数展示。
  // 服务端实现见 `admin.routes.ts:210`（`truncated: filtered.length >= 500`），
  // 两端口径必须一致 —— 前端那套提示逻辑就是靠这个字段触发的，
  // mock 不回它= 前端这段代码在 mock 下永远走不到，等于没写。
  const res = paginate(list, query);
  return { ...res, truncated: list.length >= 500 };
});

on('GET', '/admin/audit-logs', ({ query }) => {
  let list = db.auditLogs.map((l) => ({ ...l }));
  const module = q(query, 'module');
  const action = q(query, 'action');
  const kw = q(query, 'keyword');
  if (module) list = list.filter((l) => l.module === module);
  if (action) list = list.filter((l) => l.action === action);
  if (kw) list = list.filter((l) => contains(l.adminName, kw) || contains(l.targetId, kw) || contains(l.requestId, kw));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

// ============================================================================
// 四审工作台（契约 5.2；:no = applicationNo。realname/face 人工复核为 [前端补充]）
// ============================================================================
const appDetail = (a: (typeof db.applications)[number]) => {
  const comp = db.companions.find((c) => c.id === a.companionId)!;
  return { ...a, companionName: maskName(comp.name), phoneMasked: maskPhone(comp.phone) };
};

on('GET', '/admin/companion-applications', ({ query }) => {
  let list = db.applications.map((a) => ({ ...a }));
  const stage = q(query, 'stage');
  const kw = q(query, 'keyword');
  if (stage) list = list.filter((a) => a.stage === stage);
  if (kw) {
    list = list.filter((a) => {
      const comp = db.companions.find((c) => c.id === a.companionId);
      return contains(a.applicationNo, kw) || (comp && contains(comp.name, kw));
    });
  }
  list.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return paginate(list, query);
});

on('GET', '/admin/companion-applications/:no', ({ params }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  return appDetail(a);
});

on('POST', '/admin/companion-applications/:no/realname', ({ params, body }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.realnameStatus !== 'PENDING') throw fail(13004, '该步骤已审核');
  a.realnameStatus = body.action === 'PASS' ? 'PASSED' : 'REJECTED';
  a.realnameComment = String(body.comment ?? '');
  a.realnameReviewedAt = nowIso();
  if (a.realnameStatus === 'PASSED') a.stage = 'REALNAME_OK';
  else {
    a.decidedAt = nowIso();
    a.rejectReason = a.realnameComment || '实名审核驳回';
  }
  return appDetail(a);
});

on('POST', '/admin/companion-applications/:no/face', ({ params, body }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.faceStatus !== 'PENDING') throw fail(13004, '该步骤已审核');
  a.faceStatus = body.action === 'PASS' ? 'PASSED' : 'REJECTED';
  a.faceComment = String(body.comment ?? '');
  if (a.faceStatus === 'PASSED') a.stage = 'FACE_OK';
  else {
    a.decidedAt = nowIso();
    a.rejectReason = a.faceComment || '人脸审核驳回';
  }
  return appDetail(a);
});

on('POST', '/admin/companion-applications/:no/criminal', ({ params, body }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.criminalStatus !== 'PENDING') throw fail(13004, '该步骤已审核');
  a.criminalStatus = body.action === 'PASS' ? 'PASSED' : 'REJECTED';
  a.criminalComment = String(body.comment ?? '');
  if (a.criminalStatus === 'PASSED') a.stage = 'CRIMINAL_OK';
  else {
    a.decidedAt = nowIso();
    a.rejectReason = a.criminalComment || '无犯罪记录审核驳回';
  }
  return appDetail(a);
});

// [前端补充] 保证金到账确认的 UI 前置动作：考试通过（运营代录）
on('POST', '/admin/companion-applications/:no/exam-pass', ({ params, body }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.stage !== 'CRIMINAL_OK' && a.stage !== 'TRAINING') throw fail(13004, '当前阶段不可录入考试');
  a.stage = 'EXAM_OK';
  a.trainingCompletedAt = nowIso();
  a.examScore = Number(body.examScore ?? 85);
  a.examAttemptNo += 1;
  return appDetail(a);
});

on('POST', '/admin/companion-applications/:no/deposit-confirm', ({ params }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.stage !== 'EXAM_OK') throw fail(13004, '当前阶段不可确认保证金');
  const amount = db.systemConfigs.find((c) => c.configKey === 'deposit_amount')?.configValue ?? '50000';
  a.stage = 'DEPOSIT_OK';
  a.depositAmountFen = amount;
  a.depositPaidAt = nowIso();
  return appDetail(a);
});

// [前端补充] 四审终审上架（激活接单资格）
on('POST', '/admin/companion-applications/:no/activate', ({ params }) => {
  const a = db.applications.find((x) => x.applicationNo === params.no);
  if (!a) throw fail(13002, '申请单不存在');
  if (a.stage !== 'DEPOSIT_OK') throw fail(13004, '仅保证金已缴申请可上架');
  a.stage = 'ACTIVE';
  a.decidedAt = nowIso();
  const comp = db.companions.find((c) => c.id === a.companionId);
  if (comp) comp.status = 'ACTIVE';
  return appDetail(a);
});

// ============================================================================
// 陪聊员列表（契约 5.2 的 credit/status；列表为 [前端补充]）
// ============================================================================
on('GET', '/admin/companions', ({ query }) => {
  let list = db.companions.map((c) => ({ ...c, nameMasked: maskName(c.name), phoneMasked: maskPhone(c.phone) }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  const creditSort = q(query, 'creditSort');
  if (status) list = list.filter((c) => c.status === status);
  if (kw) list = list.filter((c) => contains(c.nameMasked, kw) || contains(c.id, kw));
  if (creditSort === 'asc') list.sort((a, b) => a.creditScore - b.creditScore);
  else if (creditSort === 'desc') list.sort((a, b) => b.creditScore - a.creditScore);
  return paginate(list, query);
});

on('POST', '/admin/companions/:id/credit', ({ params, body }) => {
  const c = db.companions.find((x) => x.id === params.id);
  if (!c) throw fail(13001, '陪聊员不存在');
  const delta = Number(body.delta ?? 0);
  if (!Number.isInteger(delta) || delta === 0) throw fail(10001, '调整值必须为非零整数');
  c.creditScore = Math.max(0, Math.min(100, c.creditScore + delta));
  return { ...c };
});

on('POST', '/admin/companions/:id/status', ({ params, body }) => {
  const c = db.companions.find((x) => x.id === params.id);
  if (!c) throw fail(13001, '陪聊员不存在');
  const status = String(body.status ?? '');
  if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) throw fail(10001, '非法状态');
  if (!body.reason) throw fail(10001, '必须填写操作原因');
  c.status = status;
  if (status === 'BANNED') c.creditScore = Math.min(c.creditScore, 40);
  if (status === 'ACTIVE') c.creditScore = Math.max(c.creditScore, 60);
  return { ...c };
});

// ============================================================================
// 黑名单（契约缺口，[前端补充]）
// ============================================================================
on('GET', '/admin/blacklists', ({ query }) => {
  let list = db.blacklists.map((b) => ({ ...b, targetNameMasked: maskName(b.targetName) }));
  const targetType = q(query, 'targetType');
  const status = q(query, 'status');
  if (targetType) list = list.filter((b) => b.targetType === targetType);
  if (status) list = list.filter((b) => b.status === status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/blacklists', ({ body }) => {
  if (!body.targetId || !body.reason) throw fail(10001, '目标与原因必填');
  const item = {
    id: String(db.blacklists.length + 1),
    targetType: String(body.targetType ?? 'USER'),
    targetId: String(body.targetId),
    // 出口统一脱敏展示（原始 targetName 仅内存保留供搜索）
    targetNameMasked: maskName(String(body.targetName ?? '未知')),
    targetName: maskName(String(body.targetName ?? '未知')),
    deviceFingerprint: body.deviceFingerprint ? String(body.deviceFingerprint) : undefined,
    reason: String(body.reason),
    scope: String(body.scope ?? 'PLATFORM'),
    status: 'ACTIVE',
    expiresAt: body.expiresAt ? String(body.expiresAt) : undefined,
    createdAt: nowIso(),
  };
  db.blacklists.unshift(item);
  return { ...item };
});

on('POST', '/admin/blacklists/:id/lift', ({ params, body }) => {
  const b = db.blacklists.find((x) => x.id === params.id);
  if (!b) throw fail(10007, '记录不存在');
  if (b.status !== 'ACTIVE') throw fail(10008, '仅生效中记录可解除');
  b.status = 'LIFTED';
  b.liftReason = String(body.reason ?? '申诉成立');
  b.liftedAt = nowIso();
  return { ...b };
});

// ============================================================================
// 订单（列表/详情 [前端补充]；decide 为契约 5.5）
// ============================================================================
on('GET', '/admin/orders', ({ query }) => {
  let list = db.orders.map((o) => ({ ...o }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  const start = q(query, 'startDate');
  const end = q(query, 'endDate');
  const night = q(query, 'nightOrder');
  if (status) list = list.filter((o) => o.status === status);
  if (kw) list = list.filter((o) => contains(o.orderNo, kw) || contains(o.elderName, kw) || contains(o.elderPhone, kw));
  if (start || end) list = list.filter((o) => inDateRange(o.createdAt, start, end));
  if (night === 'true') list = list.filter((o) => o.nightOrder);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('GET', '/admin/orders/:id', ({ params }) => {
  const o = db.orders.find((x) => x.id === params.id);
  if (!o) throw fail(14001, '订单不存在');
  const comp = db.companions.find((c) => c.id === o.companionId);
  const flow = ['CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'COMPLETED', 'CLOSED'];
  const upto = flow.indexOf(o.status);
  // 时间线元素显式标注可选字段类型（reason/operatorName 可能缺省）
  const timeline: OrderTimelineItem[] = flow.slice(0, upto + 1).map((s, i) => ({
    id: `tl-${o.id}-${i}`,
    fromStatus: i === 0 ? undefined : flow[i - 1],
    toStatus: s,
    action: s.toLowerCase(),
    operatorType: i === 0 ? 'USER' : i < 3 ? 'SYSTEM' : i < 6 ? 'COMPANION' : 'ADMIN',
    operatorName: undefined,
    reason: undefined,
    createdAt: db.mockIso(Math.max(0, 30 - i * 4), 9 + i, 0),
  }));
  if (['CANCELLED', 'REFUNDED', 'SUSPENDED'].includes(o.status)) {
    timeline.push({
      id: `tl-${o.id}-x`,
      fromStatus: 'PENDING_CONFIRM',
      toStatus: o.status,
      action: o.status === 'SUSPENDED' ? 'suspend' : 'refund',
      operatorType: 'ADMIN',
      operatorName: '霍承钧',
      reason: o.cancelReason ?? (o.status === 'SUSPENDED' ? '投诉挂起' : '客服裁决退款'),
      createdAt: db.mockIso(1, 16),
    });
  }
  const verifications = ['ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'COMPLETED', 'CLOSED', 'SUSPENDED', 'REFUNDED'].includes(o.status)
    ? [{
        id: `vf-${o.id}`,
        type: 'ARRIVAL',
        status: 'PASSED',
        attemptNo: 1,
        dynamicCode: String(100000 + Math.floor(Math.random() * 900000)),
        codeMode: 'ELDER_SHOW',
        faceScore: 91,
        facePassed: true,
        livenessScore: 96,
        gpsDeviationM: 86,
        arrivedAt: db.mockIso(2, 10, 5),
        createdAt: db.mockIso(2, 10, 0),
      }]
    : [];
  const sharings = db.sharings
    .filter((s) => s.orderId === o.id)
    .map((s) => ({
      id: s.id,
      sharingNo: s.sharingNo,
      status: s.status,
      frozenAmountFen: s.frozenAmountFen,
      platformCommissionFen: s.platformCommissionFen,
      companionIncomeFen: s.companionIncomeFen,
      commissionRateBp: s.commissionRateBp,
      createdAt: s.createdAt,
    }));
  return {
    ...o,
    elderNameMasked: maskName(o.elderName),
    elderPhoneMasked: maskPhone(o.elderPhone),
    companionNameMasked: comp ? maskName(comp.name) : undefined,
    addressMasked: maskAddress(o.address),
    timeline,
    verifications,
    sharings,
  };
});

on('POST', '/admin/orders/:id/decide', ({ params, body }) => {
  const o = db.orders.find((x) => x.id === params.id);
  if (!o) throw fail(14001, '订单不存在');
  if (o.status !== 'SUSPENDED') throw fail(14002, '仅挂起订单可裁决');
  const decision = String(body.decision);
  if (!['COMPLETE', 'PARTIAL_REFUND', 'FULL_REFUND'].includes(decision)) throw fail(10001, '非法裁决结果');
  if (!body.note) throw fail(10001, '裁决必须填写说明');
  if (decision === 'COMPLETE') {
    o.status = 'COMPLETED';
    o.completedAt = nowIso();
    const s = db.sharings.find((x) => x.orderId === o.id);
    if (s) {
      s.status = 'SHARED';
      s.sharedAt = nowIso();
    }
  } else {
    o.status = 'REFUNDED';
    o.refundAmountFen = decision === 'FULL_REFUND' ? o.totalAmountFen : String(Math.round(Number(o.totalAmountFen) / 2));
    const s = db.sharings.find((x) => x.orderId === o.id);
    if (s) {
      s.status = 'RETURNED';
      s.returnAmountFen = o.refundAmountFen;
      s.returnedAt = nowIso();
    }
  }
  o.remark = `客服裁决：${decision}（${String(body.note)}）`;
  return { ...o };
});

// ============================================================================
// 分账（契约 5.3；全量流水/导出为 [前端补充]）
// ============================================================================
on('GET', '/admin/sharings/frozen', ({ query }) => {
  let list = db.sharings.filter((s) => s.status === 'FROZEN').map((s) => ({ ...s }));
  const kw = q(query, 'keyword');
  if (kw) list = list.filter((r) => contains(r.orderNo, kw) || contains(r.sharingNo, kw) || contains(r.companionName, kw));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('GET', '/admin/sharings', ({ query }) => {
  let list = db.sharings.map((s) => ({ ...s }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  const start = q(query, 'startDate');
  const end = q(query, 'endDate');
  if (status) list = list.filter((r) => r.status === status);
  if (kw) list = list.filter((r) => contains(r.orderNo, kw) || contains(r.sharingNo, kw) || contains(r.companionName, kw));
  if (start || end) list = list.filter((r) => inDateRange(r.createdAt, start, end));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('GET', '/admin/sharings/export', ({ query }) => {
  let list = db.sharings.map((s) => ({ ...s }));
  const status = q(query, 'status');
  if (status) list = list.filter((r) => r.status === status);
  const header = '分账单号,订单号,陪聊员,状态,冻结金额(元),平台抽成(元),陪聊员应收(元),抽成比例(bp),微信交易单号,创建时间';
  const rows = list.map((r) =>
    [r.sharingNo, r.orderNo, maskName(r.companionName), r.status,
      (Number(r.frozenAmountFen) / 100).toFixed(2), (Number(r.platformCommissionFen) / 100).toFixed(2),
      (Number(r.companionIncomeFen) / 100).toFixed(2), r.commissionRateBp, r.wxTransactionId,
      r.createdAt.slice(0, 19).replace('T', ' ')].join(','),
  );
  return { fileName: `分账流水_${Date.now()}.csv`, csv: '\uFEFF' + [header, ...rows].join('\n') };
});

on('POST', '/admin/sharings/:sharingNo/manual-settle', ({ params }) => {
  const s = db.sharings.find((x) => x.sharingNo === params.sharingNo);
  if (!s) throw fail(15005, '分账单不存在');
  if (s.status !== 'FROZEN') throw fail(15007, '仅冻结分账单可手动结算');
  if (s.retryCount >= 3) throw fail(15008, '重试已超限（≥3），须人工工单处理');
  s.status = 'SHARED';
  s.sharedAt = nowIso();
  s.manualTicketNo = `MT${Date.now().toString().slice(-8)}`;
  return { ...s };
});

on('POST', '/admin/sharings/sweep-stale', () => {
  // 模拟清理 >7 天僵死分账（契约：SHARING_STALE_ALERT_DAYS）
  const threshold = Date.now() - 7 * 86400000;
  const stale = db.sharings.filter((s) => s.status === 'FROZEN' && new Date(s.createdAt).getTime() < threshold);
  return { sweptCount: stale.length, sweptAmountFen: String(stale.reduce((sum, s) => sum + Number(s.frozenAmountFen), 0)) };
});

on('GET', '/payments/split-mode', () => SPLIT_MODE.WECHAT_PROFIT_SHARING);

// ============================================================================
// 提现审核（契约 5.3；列表为 [前端补充]）
// ============================================================================
on('GET', '/admin/withdrawals', ({ query }) => {
  let list = db.withdrawals.map((w) => {
    const comp = db.companions.find((c) => c.id === w.companionId);
    return {
      ...w,
      companionName: maskName(comp?.name ?? '未知'),
      bankAccountMasked: maskBankCard(w.bankAccount),
      accountNameMasked: maskName(w.accountName),
    };
  });
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((w) => w.status === status);
  if (kw) list = list.filter((w) => contains(w.withdrawalNo, kw) || contains(w.companionName, kw));
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/withdrawals/:no/review', ({ params, body }) => {
  const w = db.withdrawals.find((x) => x.withdrawalNo === params.no);
  if (!w) throw fail(15014, '提现单不存在');
  if (w.status !== 'PENDING_REVIEW') throw fail(15017, '仅待审核状态可操作');
  const action = String(body.action ?? '');
  if (action === 'APPROVE') {
    w.status = 'APPROVED';
  } else if (action === 'REJECT') {
    if (!body.reason) throw fail(10001, '驳回必须填写原因');
    w.status = 'REJECTED';
    w.rejectReason = String(body.reason);
  } else {
    throw fail(10001, '非法审核动作');
  }
  w.reviewedAt = nowIso();
  return { ...w };
});

// ============================================================================
// 对账中心（契约 5.3；差异处理为 [前端补充]）
// ============================================================================
on('GET', '/admin/recon/batches', ({ query }) => {
  let list = db.reconciliations.map((r) => ({ ...r }));
  const status = q(query, 'status');
  const channel = q(query, 'channel');
  const start = q(query, 'startDate');
  const end = q(query, 'endDate');
  if (status) list = list.filter((r) => r.status === status);
  if (channel) list = list.filter((r) => r.channel === channel);
  if (start || end) list = list.filter((r) => inDateRange(r.batchDate, start, end));
  list.sort((a, b) => (a.batchDate < b.batchDate ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/recon/run', () => {
  const item = {
    id: String(db.reconciliations.length + 1),
    batchNo: `RC${nowIso().slice(0, 10).replace(/-/g, '')}MAN`,
    batchDate: nowIso().slice(0, 10),
    channel: 'WX_PAY',
    localCount: 128,
    localAmountFen: '1886000',
    wxCount: 128,
    wxAmountFen: '1886000',
    matchCount: 128,
    diffCount: 0,
    diffAmountFen: '0',
    status: 'MATCHED',
    createdAt: nowIso(),
  };
  db.reconciliations.unshift(item);
  return { ...item };
});

on('POST', '/admin/recon/batches/:batchNo/resolve', ({ params, body }) => {
  const r = db.reconciliations.find((x) => x.batchNo === params.batchNo);
  if (!r) throw fail(10007, '对账批次不存在');
  if (r.status !== 'DIFF') throw fail(15019, '仅有差异批次可处理');
  if (!body.note) throw fail(10001, '处理必须填写说明');
  r.status = 'RESOLVED';
  r.resolveNote = String(body.note);
  r.resolvedAt = nowIso();
  return { ...r };
});

// ============================================================================
// 裂变营销（契约缺口，全部 [前端补充]）
// ============================================================================
on('GET', '/admin/gift-cards', ({ query }) => {
  let list = db.giftCards.map((g) => ({
    ...g,
    buyerNameMasked: maskName(g.buyerName),
    recipientNameMasked: maskName(g.recipientName),
    boundUserNameMasked: g.boundUserName ? maskName(g.boundUserName) : undefined,
  }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((g) => g.status === status);
  if (kw) list = list.filter((g) => contains(g.cardNo, kw) || contains(g.buyerNameMasked, kw) || contains(g.recipientNameMasked, kw));
  list.sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/gift-cards/issue', ({ body }) => {
  const face = Number(body.faceAmountFen ?? 50000);
  const dur = Number(body.durationMinutes ?? 300);
  if (!Number.isInteger(face) || face <= 0) throw fail(10001, '面值金额必须为正整数（分）');
  const buyer = maskName(String(body.buyerName ?? '后台发行'));
  const recipient = maskName(String(body.recipientName ?? '-'));
  const item = {
    id: String(db.giftCards.length + 1),
    cardNo: `GC${Date.now().toString().slice(-10)}`,
    buyerNameMasked: buyer,
    recipientNameMasked: recipient,
    buyerName: buyer,
    recipientName: recipient,
    faceAmountFen: String(face),
    durationMinutes: dur,
    balanceAmountFen: String(face),
    balanceDurationMinutes: dur,
    status: 'ACTIVE',
    message: body.message ? String(body.message) : undefined,
    purchasedAt: nowIso(),
    expiresAt: body.expiresAt ? String(body.expiresAt) : undefined,
  };
  db.giftCards.unshift(item);
  return { ...item };
});

on('GET', '/admin/distributors', ({ query }) => {
  let list = db.distributors.map((d) => ({ ...d, phoneMasked: maskPhone(d.phone) }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((d) => d.status === status);
  if (kw) list = list.filter((d) => contains(d.name, kw) || contains(d.communityName, kw) || contains(d.inviteCode, kw));
  return paginate(list, query);
});

on('GET', '/admin/commissions', ({ query }) => {
  let list = db.commissions.map((c) => ({
    ...c,
    distributorName: db.distributors.find((d) => d.id === c.distributorId)?.name ?? '',
    relatedUserNameMasked: maskName(c.relatedUserName),
  }));
  const status = q(query, 'status');
  const distributorId = q(query, 'distributorId');
  if (status) list = list.filter((c) => c.status === status);
  if (distributorId) list = list.filter((c) => c.distributorId === distributorId);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/commissions/:id/settle', ({ params }) => {
  const c = db.commissions.find((x) => x.id === params.id);
  if (!c) throw fail(10007, '佣金流水不存在');
  if (c.status !== 'PENDING') throw fail(10008, '仅待结算流水可结算');
  c.status = 'PAID';
  c.settledAt = nowIso();
  c.paidAt = nowIso();
  const d = db.distributors.find((x) => x.id === c.distributorId);
  if (d) {
    d.pendingCommissionFen = String(Math.max(0, Number(d.pendingCommissionFen) - Number(c.amountFen)));
    d.settledCommissionFen = String(Number(d.settledCommissionFen) + Number(c.amountFen));
  }
  return { ...c };
});

on('POST', '/admin/distributors/:id/settle-all', ({ params }) => {
  const d = db.distributors.find((x) => x.id === params.id);
  if (!d) throw fail(10007, '团长不存在');
  const pending = db.commissions.filter((c) => c.distributorId === d.id && c.status === 'PENDING');
  const total = pending.reduce((s, c) => s + Number(c.amountFen), 0);
  pending.forEach((c) => {
    c.status = 'PAID';
    c.settledAt = nowIso();
    c.paidAt = nowIso();
  });
  d.pendingCommissionFen = '0';
  d.settledCommissionFen = String(Number(d.settledCommissionFen) + total);
  return { settledCount: pending.length, settledAmountFen: String(total) };
});

on('GET', '/admin/coupons', ({ query }) => {
  let list = db.coupons.map((c) => ({ ...c }));
  const status = q(query, 'status');
  if (status) list = list.filter((c) => c.status === status);
  const keyword = q(query, 'keyword');
  if (keyword) {
    const kw = keyword.toLowerCase();
    list = list.filter(
      (c) => c.name.toLowerCase().includes(kw) || c.couponNo.toLowerCase().includes(kw),
    );
  }
  // 草稿与已结束沉底：运营日常看的是在投放的
  const rank: Record<string, number> = { ACTIVE: 0, PAUSED: 1, DRAFT: 2, ENDED: 3 };
  list.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  return paginate(list, query);
});

on('POST', '/admin/coupons', ({ body }) => {
  const name = String(body.name ?? '').trim();
  if (!name) throw fail(10001, '券名称必填');
  const type = String(body.type ?? 'FULL_REDUCTION');
  // 面值单位随类型变（分 / 分钟），这里只做正整数校验，不做单位换算
  const value = Number(body.value ?? 0);
  if (!Number.isInteger(value) || value <= 0) throw fail(10001, '面值必须为正整数');
  const minSpendFen = String(body.minSpendFen ?? '0');
  if (!/^\d+$/.test(minSpendFen)) throw fail(10001, '使用门槛必须为非负整数（分）');
  const item = {
    id: String(db.coupons.length + 1),
    couponNo: `CP${String(db.coupons.length + 1).padStart(4, '0')}`,
    name,
    type,
    value,
    minSpendFen,
    validDays: Number(body.validDays ?? 30),
    totalCount: Number(body.totalCount ?? 0),
    claimedCount: 0,
    usedCount: 0,
    // 新建落 DRAFT 而非 ACTIVE：券面额是资金口径，不该建完就直接对外发
    status: 'DRAFT',
    scopeRules: body.scopeRules ? String(body.scopeRules) : undefined,
    startAt: body.startAt ? String(body.startAt) : undefined,
    endAt: body.endAt ? String(body.endAt) : undefined,
    createdAt: nowIso(),
  };
  db.coupons.unshift(item);
  return { ...item };
});

on('PUT', '/admin/coupons/:id', ({ params, body }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  // 已发放的券**禁止改面值**——不是「口径不一致」这种可协商的理由，是技术性资损：
  // `user_coupons`（schema:1446）只有 coupon_id，**没有面值快照字段**；
  // 核销时 order.routes.ts:141 / order.service.ts:227 走 coupon_deduct_fen，
  // 需要实时 JOIN `coupons` 模板读 value。
  // 所以改模板面值 = 用户已领取的券面额跟着一起变（运营把 ¥50 改成 ¥100，
  // 所有存量券瞬间变¥100，直接资损且用户无感知）。
  // 要降面值请新建模板。根治需加 user_coupons.value_snapshot（schema 改动，待主理人放行）。
  if (c.claimedCount > 0 && body.value !== undefined && Number(body.value) !== c.value) {
    throw fail(10001, '该券已发放，禁止修改面额：用户已领取的券按模板实时计值，改面值会让存量券面额同步变化。请新建券模板。');
  }
  if (body.name !== undefined) c.name = String(body.name).trim() || c.name;
  if (body.type !== undefined) c.type = String(body.type);
  if (body.value !== undefined) c.value = Number(body.value);
  if (body.minSpendFen !== undefined) c.minSpendFen = String(body.minSpendFen);
  if (body.validDays !== undefined) c.validDays = Number(body.validDays);
  if (body.totalCount !== undefined) {
    const next = Number(body.totalCount);
    // 总量不可小于已领取数，否则会出现「超发」（库存负数）
    if (next !== 0 && next < c.claimedCount) throw fail(10001, `发放总量不能小于已领取数（${c.claimedCount}）`);
    c.totalCount = next;
  }
  // 投放期不可倒挂
  if (body.startAt && body.endAt && String(body.startAt) >= String(body.endAt)) {
    throw fail(10001, '投放结束时间必须晚于开始时间');
  }
  if (body.scopeRules !== undefined) c.scopeRules = String(body.scopeRules);
  if (body.startAt !== undefined) c.startAt = body.startAt ? String(body.startAt) : undefined;
  if (body.endAt !== undefined) c.endAt = body.endAt ? String(body.endAt) : undefined;
  c.updatedAt = nowIso();
  return { ...c };
});

/** 草稿 → 投放中 */
on('POST', '/admin/coupons/:id/publish', ({ params }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  if (c.status !== 'DRAFT') throw fail(10008, '仅草稿态券可投放');
  c.status = 'ACTIVE';
  c.updatedAt = nowIso();
  return { ...c };
});

/** 结束投放：不可逆，与暂停分离 */
on('POST', '/admin/coupons/:id/end', ({ params }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  if (c.status === 'ENDED') throw fail(10008, '该券已结束');
  c.status = 'ENDED';
  c.updatedAt = nowIso();
  return { ...c };
});

on('POST', '/admin/coupons/:id/pause', ({ params }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  if (c.status !== 'ACTIVE') throw fail(10008, '仅投放中的券可暂停');
  c.status = 'PAUSED';
  c.updatedAt = nowIso();
  return { ...c };
});

on('POST', '/admin/coupons/:id/resume', ({ params }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  if (c.status !== 'PAUSED') throw fail(10008, '仅暂停中的券可恢复');
  c.status = 'ACTIVE';
  c.updatedAt = nowIso();
  return { ...c };
});

on('POST', '/admin/coupons/:id/grant', ({ params, body }) => {
  const c = db.coupons.find((x) => x.id === params.id);
  if (!c) throw fail(19204, '券模板不存在');
  const count = Number(body.count ?? 0);
  if (count <= 0) throw fail(10001, '发放数量必须大于 0');
  const now = nowIso();
  for (let i = 0; i < count; i++) {
    db.userCoupons.unshift({
      id: String(db.userCoupons.length + 1 + i),
      couponId: c.id,
      couponName: c.name,
      userName: maskName(db.companions[i % db.companions.length].name),
      status: 'UNUSED',
      source: 'MANUAL',
      receivedAt: now,
      expiredAt: undefined,
    });
  }
  c.claimedCount += count;
  return { granted: count };
});

on('GET', '/admin/coupons/:id/user-coupons', ({ params, query }) => {
  const list = db.userCoupons
    .filter((u) => u.couponId === params.id)
    .map((u) => ({ ...u, userNameMasked: maskName(u.userName) }));
  return paginate(list, query);
});

on('GET', '/admin/invite-rules', () => db.inviteRules.map((r) => ({ ...r })));

on('PUT', '/admin/invite-rules/:id', ({ params, body }) => {
  const r = db.inviteRules.find((x) => x.id === params.id);
  if (!r) throw fail(10007, '规则不存在');
  if (body.rewardValue !== undefined) r.rewardValue = String(body.rewardValue);
  if (body.inviteeCondition !== undefined) r.inviteeCondition = String(body.inviteeCondition);
  if (body.enabled !== undefined) r.enabled = Boolean(body.enabled);
  r.updatedAt = nowIso();
  return { ...r };
});

// ============================================================================
// 风控（契约 5.4；complaints/sampling/举报列表为缺口 [前端补充]）
// ============================================================================
on('GET', '/admin/risk/events', ({ query }) => {
  let list = db.riskEvents.map((r) => ({ ...r, subjectNameMasked: maskName(r.subjectName) }));
  const status = q(query, 'status');
  const level = q(query, 'level');
  const type = q(query, 'type');
  if (status) list = list.filter((r) => r.status === status);
  if (level) list = list.filter((r) => r.level === level);
  if (type) list = list.filter((r) => r.type === type);
  const lv = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  list.sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
    return lv.indexOf(a.level) - lv.indexOf(b.level);
  });
  return paginate(list, query);
});

on('POST', '/admin/risk/events/:eventNo/handle', ({ params, body }) => {
  const r = db.riskEvents.find((x) => x.eventNo === params.eventNo);
  if (!r) throw fail(20003, '风控事件不存在');
  if (r.status !== 'PENDING' && r.status !== 'PROCESSING') throw fail(10008, '该事件已终态');
  const action = String(body.action);
  if (!['RESOLVED', 'FALSE_POSITIVE', 'PROCESSING'].includes(action)) throw fail(10001, '非法处置动作');
  const taken = String(body.actionTaken ?? '');
  if (action === 'RESOLVED' && !['WARN', 'INTERCEPT', 'LIMIT', 'PENALTY', 'BAN'].includes(taken)) {
    throw fail(10001, '处置动作必须为 WARN/INTERCEPT/LIMIT/PENALTY/BAN');
  }
  r.status = action;
  r.actionTaken = taken || undefined;
  r.handleNote = body.note ? String(body.note) : undefined;
  r.handlerName = currentOperator;
  if (action !== 'PROCESSING') r.handledAt = nowIso();
  return { ...r };
});

on('GET', '/admin/reports', ({ query }) => {
  let list = db.reports.map((r) => ({
    ...r,
    reporterNameMasked: maskName(r.reporterName),
    targetNameMasked: maskName(r.targetName),
  }));
  const status = q(query, 'status');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((r) => r.status === status);
  if (kw) list = list.filter((r) => contains(r.reportNo, kw) || contains(r.description, kw));
  return paginate(list, query);
});

on('POST', '/admin/reports/:reportNo/handle', ({ params, body }) => {
  const r = db.reports.find((x) => x.reportNo === params.reportNo);
  if (!r) throw fail(20004, '举报单不存在');
  if (r.status !== 'PENDING') throw fail(20005, '举报已处理');
  const action = String(body.action);
  if (!['SUBSTANTIATED', 'UNFOUNDED'].includes(action)) throw fail(10001, '非法核查结论');
  if (!body.note) throw fail(10001, '必须填写核查说明');
  r.status = action;
  r.handleNote = String(body.note);
  r.handlerName = currentOperator;
  r.handledAt = nowIso();
  if (action === 'SUBSTANTIATED') {
    r.rewardStatus = 'PENDING';
    r.rewardAmountFen = db.systemConfigs.find((c) => c.configKey === 'report_reward')?.configValue ?? '2000';
  }
  return { ...r };
});

// [前端补充] 举报奖励发放（契约红线：金额取 system_configs.report_reward，不写死）
on('POST', '/admin/reports/:reportNo/reward', ({ params }) => {
  const r = db.reports.find((x) => x.reportNo === params.reportNo);
  if (!r) throw fail(20004, '举报单不存在');
  if (r.status !== 'SUBSTANTIATED') throw fail(10008, '仅属实举报可发放奖励');
  if (r.rewardStatus === 'PAID') throw fail(10008, '奖励已发放');
  r.rewardStatus = 'PAID';
  return { ...r };
});

on('GET', '/admin/complaints', ({ query }) => {
  let list = db.complaints.map((c) => ({ ...c, complainantNameMasked: maskName(c.complainantName) }));
  const status = q(query, 'status');
  const priority = q(query, 'priority');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((c) => c.status === status);
  if (priority) list = list.filter((c) => c.priority === priority);
  if (kw) list = list.filter((c) => contains(c.complaintNo, kw) || contains(c.description, kw) || contains(c.orderNo, kw));
  const p = ['URGENT', 'HIGH', 'NORMAL', 'LOW'];
  list.sort((a, b) => {
    if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
    if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
    return p.indexOf(a.priority) - p.indexOf(b.priority);
  });
  return paginate(list, query);
});

on('POST', '/admin/complaints/:complaintNo/handle', ({ params, body }) => {
  const c = db.complaints.find((x) => x.complaintNo === params.complaintNo);
  if (!c) throw fail(20007, '投诉单不存在');
  const action = String(body.action);
  if (!['PROCESS', 'RESOLVE', 'REJECT'].includes(action)) throw fail(10001, '非法处理动作');
  if (action !== 'PROCESS' && !body.resultNote) throw fail(10001, '必须填写处理结果说明');
  c.status = action === 'PROCESS' ? 'PROCESSING' : action === 'RESOLVE' ? 'RESOLVED' : 'REJECTED';
  c.resultNote = body.resultNote ? String(body.resultNote) : c.resultNote;
  c.handlerName = currentOperator;
  c.compensationAmountFen = String(body.compensationAmountFen ?? c.compensationAmountFen);
  if (action !== 'PROCESS') c.handledAt = nowIso();
  return { ...c };
});

on('GET', '/admin/sampling-tasks', ({ query }) => {
  let list = db.samplingTasks.map((t) => ({ ...t, subjectNameMasked: maskName(t.subjectName) }));
  const status = q(query, 'status');
  if (status) list = list.filter((t) => t.status === status);
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return paginate(list, query);
});

on('POST', '/admin/sampling-tasks/:taskNo/review', ({ params, body }) => {
  const t = db.samplingTasks.find((x) => x.taskNo === params.taskNo);
  if (!t) throw fail(10007, '抽检任务不存在');
  if (t.status !== 'PENDING') throw fail(10008, '该任务已处理');
  const result = String(body.result);
  if (!['PASS', 'REJECT'].includes(result)) throw fail(10001, '非法抽检结果');
  t.status = 'REVIEWED';
  t.reviewResult = result;
  t.reviewerName = currentOperator;
  t.reviewedAt = nowIso();
  return { ...t };
});

// ============================================================================
// 客服（契约 5.5：dispatch-timeout / revisits 登录即可）
// ============================================================================
on('GET', '/admin/dispatch-timeout', ({ query }) => {
  const list = db.orders
    .filter((o) => o.status === 'DISPATCHED')
    .map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      elderNameMasked: maskName(o.elderName),
      serviceDate: o.serviceDate,
      slotStart: o.slotStart,
      createdAt: o.createdAt,
      waitMinutes: Math.max(30, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000)),
    }));
  return paginate(list, query);
});

on('GET', '/admin/revisits', ({ query }) => {
  const list = db.orders
    .filter((o) => ['COMPLETED', 'CLOSED'].includes(o.status))
    .slice(0, 12)
    .map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      elderNameMasked: maskName(o.elderName),
      completedAt: o.completedAt ?? o.createdAt,
      revisitStatus: o.id.charCodeAt(0) % 3 === 0 ? 'DONE' : 'PENDING',
    }));
  return paginate(list, query);
});

// ============================================================================
// 保单/文件台账（契约 5.6，登录即可）
// ============================================================================
on('GET', '/admin/policies', ({ query }) => {
  const list = db.orders
    .filter((o) => ['PAID', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'CLOSED'].includes(o.status))
    .slice(0, 20)
    .map((o, i) => ({
      id: String(i + 1),
      policyNo: `PL${o.orderNo.slice(-8)}`,
      orderNo: o.orderNo,
      elderNameMasked: maskName(o.elderName),
      companionNameMasked: maskName(db.companions.find((c) => c.id === o.companionId)?.name ?? ''),
      amountFen: '199',
      status: i % 4 === 0 ? 'CLAIMED' : 'ACTIVE',
      createdAt: o.createdAt,
    }));
  return paginate(list, query);
});

on('GET', '/admin/files', ({ query }) => {
  const list = db.applications.slice(0, 20).map((a, i) => ({
    id: String(i + 1),
    fileType: i % 2 === 0 ? 'ID_CARD_FRONT' : i % 3 === 0 ? 'CRIMINAL_CERT' : 'FACE_PHOTO',
    bizType: 'COMPANION_APPLICATION',
    bizId: a.applicationNo,
    status: 'READY',
    sizeBytes: 120000 + i * 4321,
    createdAt: a.submittedAt,
  }));
  return paginate(list, query);
});

// ============================================================================
// 管理员与 RBAC（契约缺口，[前端补充]）
// ============================================================================
on('GET', '/admin/system/admins', ({ query }) => {
  let list = db.adminAccounts.map((a) => ({
    ...a,
    phoneMasked: maskPhone(a.phone),
    roleName: db.roles.find((r) => r.id === a.roleId)?.name ?? '',
  }));
  const kw = q(query, 'keyword');
  if (kw) list = list.filter((a) => contains(a.username, kw) || contains(a.realName, kw));
  return paginate(list, query);
});

on('POST', '/admin/system/admins', ({ body }) => {
  const username = String(body.username ?? '').trim();
  if (!username) throw fail(10001, '用户名必填');
  if (db.adminAccounts.some((a) => a.username === username)) throw fail(10008, '用户名已存在');
  const item = {
    id: String(db.adminAccounts.length + 1),
    username,
    realName: String(body.realName ?? ''),
    phone: String(body.phone ?? ''),
    roleId: String(body.roleId ?? '4'),
    status: 'ACTIVE',
    createdAt: nowIso(),
  };
  db.adminAccounts.push(item);
  return { ...item };
});

on('POST', '/admin/system/admins/:id/freeze', ({ params }) => {
  const a = db.adminAccounts.find((x) => x.id === params.id);
  if (!a) throw fail(21001, '管理员不存在');
  if (a.username === 'admin') throw fail(10008, '超级管理员不可冻结');
  a.status = 'FROZEN';
  return { ...a };
});

on('POST', '/admin/system/admins/:id/unfreeze', ({ params }) => {
  const a = db.adminAccounts.find((x) => x.id === params.id);
  if (!a) throw fail(21001, '管理员不存在');
  a.status = 'ACTIVE';
  return { ...a };
});

on('GET', '/admin/system/roles', () =>
  db.roles.map((r) => ({
    ...r,
    adminCount: db.adminAccounts.filter((a) => a.roleId === r.id).length,
    permissions: getRolePerms(r.id),
  })),
);

on('PUT', '/admin/system/roles/:id/permissions', ({ params, body }) => {
  const role = db.roles.find((r) => r.id === params.id);
  if (!role) throw fail(10007, '角色不存在');
  if (role.roleKey === 'admin') throw fail(10008, '超级管理员角色权限不可修改');
  const keys = body.permKeys;
  if (!Array.isArray(keys)) throw fail(10001, '权限列表格式错误');
  rolePermOverrides[role.roleKey] = keys as string[];
  return { ...role, permissions: keys as string[] };
});

// ============================================================================
// 健康活动感知（契约 §13.6 管理端 /admin/activity；PRD MODULE-ACTIVITY-SENSE.md）
// ----------------------------------------------------------------------------
// 权限：dashboard/funnel/elders/alerts 列表均 risk:read；告警处置类（ack/resolve/escalate）risk:**
//       （契约明确 W-MVP 复用风控权限点，不新增 activity:* —— 避免 RBAC 双写面扩大）
// 隐私：出参只含聚合值；探针凭据（deviceToken 等）为 X 态不出参；
//       SSID/BSSID/MAC 原文永不入库不出参（契约 §13.1 红线②③）。
// ============================================================================

/** 运营看板：活跃时段分布 / 设备在线率 / 告警处理时效 */
on('GET', '/admin/activity/dashboard', () => {
  const elders = act.activityElders;
  const alerts = act.healthAlerts;
  // 「今日」按东八区自然日切（契约 §1：库内 UTC，展示层 +8）。
  // 直接用 UTC 日期切会把凌晨的告警算到昨天，运营看板会出现「今日 0 条」的假象。
  const now = new Date();
  const todayCn = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const todayAlerts = alerts.filter((a) => {
    const d = new Date(new Date(a.triggeredAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
    return d === todayCn;
  });
  const handled = alerts.filter((a) => a.ackAt);
  // 平均首次响应时长（分钟）：ackAt - triggeredAt，负值/异常值剔除
  const mins = handled
    .map((a) => (new Date(a.ackAt!).getTime() - new Date(a.triggeredAt).getTime()) / 60000)
    .filter((m) => m >= 0 && m < 60 * 72);
  const avg = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : 0;
  return {
    managedElderCount: elders.length,
    probeOnlineCount: elders.filter((e) => e.deviceStatus === 'ONLINE').length,
    probeOfflineCount: elders.filter((e) => e.deviceStatus === 'OFFLINE').length,
    probePendingCount: elders.filter((e) => e.deviceStatus === 'PENDING').length,
    deviceOnlineRate: Number(((elders.filter((e) => e.deviceStatus === 'ONLINE').length / elders.length) * 100).toFixed(1)),
    todayAlertUnhandled: todayAlerts.filter((a) => a.status === 'OPEN').length,
    todayAlertHandled: todayAlerts.filter((a) => a.ackAt).length,
    todayAlertDismissed: todayAlerts.filter((a) => a.status === 'DISMISSED').length,
    avgHandleMinutes: avg,
    urgentUnhandledCount: alerts.filter((a) => a.level === 'URGENT' && ['OPEN', 'ACKNOWLEDGED', 'PROCESSING'].includes(a.status)).length,
    trend: act.activityTrend,
    activeSlots: act.activityActiveSlots,
  } satisfies ActivityDashboard;
});

/** 老人活动列表（契约 §13.6，team-lead 已补登记）：UNKNOWN 与过期须单独视觉分区 */
on('GET', '/admin/activity/elders', ({ query }) => {
  let list = act.activityElders.map((e) => ({
    ...e,
    elderNameMasked: `${e.nameMasked}·${e.age} 岁`,
    lastSignalAt: e.lastSignalAt,
  }));
  const status = q(query, 'status');
  const community = q(query, 'community');
  // 🔴 参数名必须与服务端 zod 逐字一致：`activity.routes.ts` elders schema 收的是 `stale`。
  // 曾写成 `staleOnly`（前端自造名），结果是「数据新鲜度」筛选在真服务端恒不命中。
  const stale = q(query, 'stale');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((e) => e.status === status);
  // community / keyword：契约承诺了社区筛选但服务端未实现（已报承钧），
  // 前端控件已禁用挂 tooltip。此处保留实现是为端点补齐后能直接联通，
  // **但它现在不会生效** —— 真服务端会把这两个键 strip 掉。
  if (community) list = list.filter((e) => e.community === community);
  // 语义对齐服务端 `admin.service.ts:168`：严格相等，**不把 UNKNOWN 混进 stale**。
  // mock 曾写成 `e.stale || e.status === 'UNKNOWN'` —— 与服务端分叉，
  // 表现为「同一筛选在 mock 下多出一批人、在真服务端少一批」，极难定位。
  if (stale === 'true') list = list.filter((e) => e.stale === true);
  if (stale === 'false') list = list.filter((e) => e.stale === false);
  if (kw) list = list.filter((e) => contains(e.nameMasked, kw) || contains(e.community ?? '', kw));
  // 默认排序：运营视角先看需要介入的（STILL > UNKNOWN/过期 > LOW > ACTIVE > AWAY）
  const rank: Record<string, number> = { STILL: 0, UNKNOWN: 1, LOW: 2, ACTIVE: 3, AWAY: 4 };
  list.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || Number(b.stale) - Number(a.stale));
  return paginate(list, query);
});

/** 告警工作台（契约权限 risk:read） */
on('GET', '/admin/activity/alerts', ({ query }) => {
  let list = [...act.healthAlerts];
  const status = q(query, 'status');
  const level = q(query, 'level');
  const type = q(query, 'type');
  const kw = q(query, 'keyword');
  if (status) list = list.filter((a) => a.status === status);
  if (level) list = list.filter((a) => a.level === level);
  if (type) list = list.filter((a) => a.type === type);
  if (kw) list = list.filter((a) => contains(a.elderNameMasked, kw) || contains(a.alertNo, kw) || contains(a.community ?? '', kw));
  const stOrd = ['OPEN', 'ACKNOWLEDGED', 'PROCESSING', 'ESCALATED', 'RESOLVED', 'DISMISSED'];
  const lvOrd = ['URGENT', 'WARN', 'REMIND'];
  list.sort((a, b) => stOrd.indexOf(a.status) - stOrd.indexOf(b.status) || lvOrd.indexOf(a.level) - lvOrd.indexOf(b.level));
  return paginate(list, query);
});

/** 人工确认（→ ACKNOWLEDGED，记 ack_by）；非 OPEN 态 24002 */
on('POST', '/admin/activity/alerts/:id/ack', ({ params, body }) => {
  const a = act.healthAlerts.find((x) => x.id === params.id);
  if (!a) throw fail(24001, '健康告警不存在');
  if (a.status !== 'OPEN') throw fail(24002, '该告警已处置，无法重复确认');
  a.status = 'ACKNOWLEDGED';
  a.ackBy = currentOperator;
  a.ackAt = nowIso();
  if (body.note) a.resolveNote = String(body.note);
  return { ...a };
});

/** 落处置结论（RESOLVED / DISMISSED 误报） */
on('POST', '/admin/activity/alerts/:id/resolve', ({ params, body }) => {
  const a = act.healthAlerts.find((x) => x.id === params.id);
  if (!a) throw fail(24001, '健康告警不存在');
  if (['RESOLVED', 'DISMISSED', 'ESCALATED'].includes(a.status)) throw fail(24002, '该告警已处置');
  const result = String(body.result ?? '');
  if (!['RESOLVED', 'DISMISSED'].includes(result)) throw fail(10001, '处置结论必须为 RESOLVED / DISMISSED');
  const note = String(body.note ?? '').trim();
  // 误报必须写原因：阈值调优依赖误报归因（架构 §13「误报可统计、可优化阈值」）
  if (result === 'DISMISSED' && !note) throw fail(10001, '标记误报必须填写原因');
  a.status = result;
  a.resolvedBy = currentOperator;
  a.resolvedAt = nowIso();
  a.resolveNote = note || undefined;
  if (!a.ackAt) {
    a.ackBy = currentOperator;
    a.ackAt = nowIso();
  }
  return { ...a };
});

/**
 * 升级对外追责：落 complaints 工单复用 SOS 出口。
 * 契约红线：交叉验证不通过一律拒绝（24004）；未勾选人工确认同样拒绝。
 */
on('POST', '/admin/activity/alerts/:id/escalate', ({ params, body }) => {
  const a = act.healthAlerts.find((x) => x.id === params.id);
  if (!a) throw fail(24001, '健康告警不存在');
  if (['RESOLVED', 'DISMISSED', 'ESCALATED'].includes(a.status)) throw fail(24002, '该告警已处置');
  // PRD 红线① + 契约 §10.1：单通道不得直接对外追责
  if (!a.crossVerifySatisfied) throw fail(24004, '交叉验证不足（单通道不得下结论），需人工确认或等待第二通道');
  if (body.crossVerifyConfirmed !== true) throw fail(10001, '升级对外追责须勾选「已完成人工交叉核实」');
  const note = String(body.note ?? '').trim();
  if (!note) throw fail(10001, '升级必须填写核实结论');
  a.status = 'ESCALATED';
  a.resolvedBy = currentOperator;
  a.resolvedAt = nowIso();
  a.resolveNote = note;
  a.complaintNo = `CMP${String(88000 + Number(a.id))}`;
  if (!a.ackAt) {
    a.ackBy = currentOperator;
    a.ackAt = nowIso();
  }
  return { ...a };
});

/** 漏斗最小样本阈值：低于此数不给出百分比结论，只标「数据不足」 */
const FUNNEL_MIN_SAMPLE = 30;

/** 每层对应的可落地运营动作（PRD §4 引流引擎；让运营知道这一层该做什么，而不是只看到数字） */
const FUNNEL_ACTION: Record<string, string> = {
  INSTALL: '社区门禁触点（广告门/单元门）扫码装机；团长地推补量',
  ACTIVATION: '落地页首屏直给「子女代看父母」演示，降低理解成本',
  CONSENT_GRANTED: '子女授权页 + 老人本人二次确认；团长当面讲解「不采摄像头/麦克风、不出户」',
  DATA_AVAILABLE: '3 步绑定引导 + 首次回连激励，把探针连上家里 Wi-Fi',
  ALERT_RAISED: '活动下降/久静告警推送到子女，配推荐位与派单加成',
  FIRST_ORDER: '告警触达时直接给「上门探访型」陪聊推荐位，用孝心时长卡承接',
  REORDER: '首单后 7 天关怀回访，时长卡引导第二次下单',
};

/** 流失最大环节的针对性建议（把「卡在哪」和「怎么改」说清，不只标红） */
const FUNNEL_ADVICE: Record<string, string> = {
  INSTALL: '装机量不足：线下触点密度不够。建议在【门禁广告屏 + 单元门贴纸 + 团长地推】三处同时加密投放密度，先跑 1 个小区做单点突破再复制。',
  ACTIVATION: '装机未激活：落地页首屏没讲清价值。建议首屏直给「子女代看父母」的 15 秒演示视频，把「爸妈活动变少了，有人陪着更安心」放到第一屏。',
  CONSENT_GRANTED: '【合规高危】双层同意是隐私合规核心指标，掉了就是合规风险，不只是转化问题。建议：① 授权页用大白话讲清「不采摄像头/麦克风、不出户、随时一键关」；② 由社区团长当面讲解再让子女点确认；③ 撤回入口必须显眼——刻意做高门槛反而会掩盖真实意愿。',
  DATA_AVAILABLE: '授权后未积累出数据：多为装机后没连 Wi-Fi 或探针没绑定。建议落地页加 3 步绑定引导，完成首次回连即给 ¥10 级小额激励（发 activity_lead_incentive_newinstall 券）。',
  ALERT_RAISED: '数据可用但没产生告警触达：这批老人活跃度普遍正常，不是坏事。可把引流重心切到【新装体验触发】（注册即发券），先把陪聊主业转化做起来。',
  FIRST_ORDER: '告警触达后不下单：子女看到了但没行动。建议子女端文案在活动下降时直接给出「上门探访型」陪聊推荐位，并用孝心时长卡承接（可先用时长卡体验券降低首次决策成本）。',
  REORDER: '首单未复购：体验后没形成习惯。建议首单后 7 天做一次关怀回访（问老人是否满意），并用时长卡发放第二次下单激励。',
};

/**
 * 定位当前维度下流失最严重的**渠道**（用于把建议落到具体小区/触点）。
 * 返回渠道标签与其在瓶颈层的流失量；无数据时返回 null（页面不给建议，不硬编）。
 */
function worstChannelFor(
  dimension: string,
  tps: readonly string[],
  churnIdx: number,
  scale: number,
): { label: string; churned: number } | null {
  const churnOf = (weight: number, stepLift?: number[]) => {
    const counts = act.funnelCountsFromStepLift(
      tps,
      Math.round(act.funnelBase.INSTALL * weight * scale),
      stepLift ?? [1, 1, 1, 1, 1, 1],
    );
    return Math.max(counts[churnIdx - 1]! - counts[churnIdx]!, 0);
  };
  if (dimension === 'community') {
    let best: { label: string; churned: number } | null = null;
    act.funnelChannels.forEach((c) => {
      const churned = churnOf(c.weight);
      if (!best || churned > best.churned) best = { label: c.channelLabel, churned };
    });
    return best;
  }
  if (dimension === 'touchpoint') {
    let best: { label: string; churned: number } | null = null;
    act.OFFLINE_TOUCHPOINTS.forEach((t) => {
      const churned = churnOf(t.weight, t.stepLift);
      if (!best || churned > best.churned) best = { label: t.label, churned };
    });
    return best;
  }
  return null; // trigger / date 维度不定位渠道（本身已是归因维度）
}

on('GET', '/admin/activity/funnel', ({ query }) => {
  const dimension = q(query, 'dimension') || 'community';
  const daysRaw = Number(q(query, 'days') || 30);
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;
  const tps = act.FUNNEL_TOUCHPOINTS;
  // 窗口缩放：基准为 30 日累计，7 日 ≈ 1/4.3，90 日 ≈ 3 倍（留存累积并非线性，取经验系数）
  const scale = days === 7 ? 0.24 : days === 90 ? 2.85 : 1;

  let channels: { channelKey: string; channelLabel: string; counts: number[]; firstOrderCount: number; dataSufficient: boolean }[] = [];
  if (dimension === 'date') {
    // 时间维度：按近 7 日逐日（无论统计窗口多长，日粒度最能看出趋势拐点）
    channels = act.last7Days().map((d, i) => {
      const decay = 1 - i * 0.06;
      const counts = tps.map((tp) => Math.round(act.funnelBase[tp] * decay * (0.9 + ((i * 37) % 11) / 60)));
      return { channelKey: d, channelLabel: d.slice(5), counts, firstOrderCount: counts[5], dataSufficient: counts[0] >= FUNNEL_MIN_SAMPLE };
    });
  } else if (dimension === 'trigger') {
    // 活动类型维度：按契约 §13.9 三触发器拆分。
    // 关键：每个触发器是一条**独立的完整漏斗**（各自触达人群各自跑一遍），
    // 不是从总装机量按 conv^idx 暴力衰减——那样第 5 层会衰减到 0，
    // 让运营误以为「触发器渠道从没带来过首单」，与业务事实完全相反。
    // 层间倍率建模保证天然单调，且单步封顶 97% 不会出现 100% 同意。
    const triggers = [
      { key: 'ACTIVITY_DROP', label: '活跃下降触发', reach: 0.34, stepLift: [1.02, 1.0, 1.12, 1.18, 0.88, 0.9] },
      { key: 'LOW_TREND', label: '低活跃趋势触发', reach: 0.29, stepLift: [1.0, 1.04, 1.16, 1.06, 0.94, 1.1] },
      { key: 'NEWINSTALL_EXPERIENCE', label: '新装体验触发', reach: 0.37, stepLift: [1.12, 0.96, 0.86, 0.78, 1.24, 0.94] },
    ];
    channels = triggers.map((t) => {
      const counts = act.funnelCountsFromStepLift(tps, Math.round(act.funnelBase.INSTALL * t.reach * scale), t.stepLift);
      return { channelKey: t.key, channelLabel: t.label, counts, firstOrderCount: counts[5]!, dataSufficient: counts[0]! >= FUNNEL_MIN_SAMPLE };
    });
  } else if (dimension === 'community') {
    // 小区维度：按渠道权重铺开，尾部小区样本偏小（真实试点就是这样）
    channels = act.funnelChannels.map((c) => {
      const counts = tps.map((tp, idx) => Math.round(act.funnelBase[tp] * c.weight * (0.94 - idx * 0.015) * scale));
      return { channelKey: c.channelKey, channelLabel: c.channelLabel, counts, firstOrderCount: counts[5], dataSufficient: counts[0] >= FUNNEL_MIN_SAMPLE };
    });
  } else {
    // 线下触点维度（PRD §护城河 / 架构 §98）：渠道归因，不是漏斗层级
    channels = act.OFFLINE_TOUCHPOINTS.map((t) => {
      const counts = act.funnelCountsFromStepLift(tps, Math.round(act.funnelBase.INSTALL * t.weight * scale), t.stepLift);
      return {
        channelKey: t.key,
        channelLabel: t.label,
        counts,
        firstOrderCount: counts[5]!,
        dataSufficient: counts[0]! >= FUNNEL_MIN_SAMPLE,
      };
    });
  }

  const totals = tps.map((_, i) => channels.reduce((sum, c) => sum + (c.counts[i] ?? 0), 0));

  // 最大流失环节：按流失**绝对量**判定（运营优化优先级看能救回多少人，不是看相对率）
  let churnIdx = -1;
  let churnMax = -1;
  for (let i = 1; i < tps.length; i++) {
    const churn = Math.max(totals[i - 1]! - totals[i]!, 0);
    if (churn > churnMax) {
      churnMax = churn;
      churnIdx = i;
    }
  }

  const stages = tps.map((tp, i) => {
    const prev = i === 0 ? totals[0]! : totals[i - 1]!;
    const cur = totals[i]!;
    const churned = Math.max(prev - cur, 0);
    const biggest = i === churnIdx;
    // 建议要落到具体渠道（team-lead 要求），而不只给通用文案
    const worst = biggest ? worstChannelFor(dimension, tps, i, scale) : null;
    const onsite = worst ? act.OFFLINE_TOUCHPOINTS.find((t) => t.label === worst.label) : undefined;
    return {
      touchpoint: tp,
      converted: cur,
      stepRate: i === 0 ? 100 : prev > 0 ? Number(((cur / prev) * 100).toFixed(1)) : 0,
      overallRate: totals[0]! > 0 ? Number(((cur / totals[0]!) * 100).toFixed(1)) : 0,
      churned,
      // 样本不足 → 页面显示「数据不足」而非百分比（0% 与没数据是两件事）
      dataSufficient: cur >= FUNNEL_MIN_SAMPLE,
      biggestChurn: biggest,
      action: FUNNEL_ACTION[tp] ?? '',
      advice: biggest
        ? `${FUNNEL_ADVICE[tp]}${
            worst
              ? `\n\n【本维度最集中】${worst.label} 该层流失 ${worst.churned} 人，是全渠道里最严重的：${
                  onsite?.onsiteAdvice ?? `建议在 ${worst.label} 直接加派现场引导，把该层的动作前置到触点当场完成。`
                }`
              : ''
          }`
        : undefined,
    };
  });

  const triggerBreakdown = [
    { trigger: 'ACTIVITY_DROP', count: Math.round(186 * scale), label: '活跃下降触发' },
    { trigger: 'LOW_TREND', count: Math.round(254 * scale), label: '低活跃趋势触发' },
    { trigger: 'NEWINSTALL_EXPERIENCE', count: Math.round(412 * scale), label: '新装体验触发' },
  ];

  const firstOrders = totals[5] ?? 0;
  // 单均带新成本：新装体验券额度（activity_lead_incentive_newinstall = 2000 分）× 发放量 / 首单数
  const cacFen = firstOrders > 0 ? String(Math.round((triggerBreakdown[2]!.count * 2000) / firstOrders)) : undefined;

  return {
    stages,
    triggerBreakdown,
    dimension,
    days,
    channels,
    offlineTouchpoints: offlineAttribution(scale),
    totals: {
      reach: totals[0] ?? 0,
      consentGranted: totals[2] ?? 0,
      firstOrder: firstOrders,
      reorder: totals[6] ?? 0,
    },
    cacPerOrderFen: cacFen,
    // 🔴 归因截断标记（对齐服务端 admin.service.ts:418 的 take: 5000）。
    //
    // **默认 false**（模拟未截断的真实情况）。
    // `?__truncate=1` 调试开关用来验前端真分支 —— 否则那段警示 UI 在联调时
    // 永远走不到，等于没写；而反过来若恒 true，联调时又总是显示误报。
    // 两态都必须能造，故留这个开关。
    //
    // 门禁 `mock funnel 提供了可控的归因截断开关` 依赖此参数存在，
    // 删掉它那条会红。
    attributionTruncated: q(query, '__truncate') === '1',
    disclaimer: '参考指标，非医疗诊断；漏斗为聚合口径，不含实时轨迹。',
  } satisfies ActivityFunnel;
});

// ============================================================================
// GET /admin/activity/revenue —— 订阅营收报表（契约 §13.6，权限 revenue:read）
// ----------------------------------------------------------------------------
// 🔴 **Q8 账务隔离**：订阅收入是**独立科目**，不进陪聊分账池。
// 本路由返回的数字**不可**与分账报表（profit_sharings）相加。
//
// **摊分口径复刻服务端 domain/revenue.ts 的 prorateSubscription**（累计比例差分）。
// 为什么要复刻而不是造个假数：mock 与服务端口径一旦分叉，
// 前端在 mock 下「对得上」的数字切真机就变了 —— 而这种差异**没有任何测试会发现**。
//
// **窗口口径复刻服务端 resolveWindow**：默认本自然月 [月初, 次月初)；
// 传 end 时按「含当日」语义处理（内部区间终点排他 → +1 天），否则漏掉当天订阅。
// ============================================================================
on('GET', '/admin/activity/revenue', ({ query }) => {
  const startParam = q(query, 'start');
  const endParam = q(query, 'end');
  const monthsRaw = Number(q(query, 'months') || 6);
  const months = Number.isInteger(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 24 ? monthsRaw : 6;

  // ---- 窗口解析（与服务端 resolveWindow 同口径）----
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  let windowStart: Date;
  let windowEnd: Date;
  if (startParam && endParam) {
    windowStart = new Date(`${startParam}T00:00:00.000Z`);
    // end 入参是「含当日」→ 内部终点排他 → +1 天，否则漏掉 end 当天的订阅
    windowEnd = new Date(new Date(`${endParam}T00:00:00.000Z`).getTime() + 86_400_000);
  } else if (startParam) {
    const s = new Date(`${startParam}T00:00:00.000Z`);
    windowStart = s;
    windowEnd = nextMonthStart.getTime() > s.getTime() ? nextMonthStart : s;
  } else if (endParam) {
    const e = new Date(`${endParam}T00:00:00.000Z`);
    windowStart = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 1));
    windowEnd = new Date(e.getTime() + 86_400_000);
  } else {
    windowStart = monthStart;
    windowEnd = nextMonthStart;
  }
  if (windowEnd.getTime() <= windowStart.getTime()) {
    throw fail(10001, '统计窗口无效：结束日期须晚于开始日期');
  }
  const wsIso = windowStart.toISOString();
  const weIso = windowEnd.toISOString();
  const windowDays = Math.round((windowEnd.getTime() - windowStart.getTime()) / 86_400_000);

  // ---- 取数：与服务端 where 同口径（跨界订阅也要取到）----
  // start_at < windowEnd AND end_at > windowStart
  const rows = act.mockSubscriptions.filter(
    (s) => s.startAt < weIso && s.endAt > wsIso,
  );

  // ---- 摊分 ----
  const details = rows.map((s) => {
    const p = act.prorateSubscriptionMock(s, wsIso, weIso);
    return {
      subscriptionNo: s.subscriptionNo,
      tier: s.tier,
      status: s.status,
      priceFen: s.priceFen,
      proratedFen: String(p.proratedFen),
      counted: p.counted,
      reason: p.reason,
      totalDays: p.totalDays,
      overlapDays: p.overlapDays,
    };
  });

  // ---- 分档（固定行序 FREE/PRO/INSTITUTIONAL，**不排序**）----
  const byTier = act.REVENUE_TIER_ORDER.map((tier) => {
    const inTier = details.filter((d) => d.tier === tier);
    return {
      tier,
      amountFen: String(inTier.reduce((sum, d) => sum + (d.counted ? Number(d.proratedFen) : 0), 0)),
      countedCount: inTier.filter((d) => d.counted).length,
      totalCount: inTier.length,
    };
  });

  // ---- 汇总 ----
  const totalAmountFen = byTier.reduce((sum, t) => sum + Number(t.amountFen), 0);
  const paidCount = byTier
    .filter((t) => t.tier !== 'FREE')
    .reduce((sum, t) => sum + t.countedCount, 0);
  const freeCount = byTier.find((t) => t.tier === 'FREE')?.totalCount ?? 0;
  const excludedCount = details.filter((d) => !d.counted).length;

  // ---- 排除原因分布（报表数与在册数差额可解释）----
  const reasonCounts = new Map<string, number>();
  for (const d of details) {
    if (d.counted) continue;
    reasonCounts.set(d.reason, (reasonCounts.get(d.reason) ?? 0) + 1);
  }
  const excludedReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason: reason as never, count }))
    .sort((a, b) => b.count - a.count);

  // ---- 月度趋势（逐月切窗口摊分；Σ 各月 ≡ 汇总，差分可加）----
  const trend: { month: string; amountFen: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const mStart = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() - i, 1));
    const mEnd = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() - i + 1, 1));
    const msIso = mStart.toISOString();
    const meIso = mEnd.toISOString();
    let sum = 0;
    for (const s of act.mockSubscriptions) {
      if (s.startAt >= meIso || s.endAt <= msIso) continue;
      const p = act.prorateSubscriptionMock(s, msIso, meIso);
      if (p.counted) sum += p.proratedFen;
    }
    trend.push({
      month: `${mStart.getUTCFullYear()}-${String(mStart.getUTCMonth() + 1).padStart(2, '0')}`,
      amountFen: String(sum),
    });
  }

  return {
    windowStart: wsIso,
    windowEnd: weIso,
    windowDays,
    byTier,
    summary: {
      totalAmountFen: String(totalAmountFen),
      paidCount,
      freeCount,
      // 付费笔数 0 时是 **null 而非 0**（两种运营含义不同，前端禁止渲染成 ¥0）
      avgPriceFen: paidCount > 0 ? String(Math.floor(totalAmountFen / paidCount)) : null,
      excludedCount,
    },
    trend,
    excludedReasons,
    details: details.slice(0, REVENUE_DETAIL_LIMIT),
    // 🔴 Q8：科目隔离声明，**前端必须原样展示，不得改写**
    accountingNote:
      '订阅收入为独立科目，不进陪聊分账池（PRD §5 / Q8）；与分账报表分别对账。',
  };
});

/**
 * 线下触点归因（PRD §护城河：亲邻社区媒体 = 门禁/单元门/开门 App）。
 * 与漏斗层级**正交**——漏斗答「同一个人从安装到复购的转化路径」，
 * 触点答「他从哪个线下入口来」，故单独出数组，不占漏斗层级。
 *
 * 落位：activity_touchpoints.metadata.channel（schema 已留 Json 字段），非共享枚举。
 */
function offlineAttribution(scale: number): OfflineTouchpointAttribution[] {
  const tps = act.FUNNEL_TOUCHPOINTS;
  return act.OFFLINE_TOUCHPOINTS.map((t) => {
    const counts = act.funnelCountsFromStepLift(
      tps,
      Math.round(act.funnelBase.INSTALL * t.weight * scale),
      t.stepLift,
    );
    // 该触点内的最大流失环节（绝对量口径），并把现场引导建议挂上去
    let bi = -1;
    let bc = -1;
    for (let i = 1; i < tps.length; i++) {
      const c = Math.max(counts[i - 1]! - counts[i]!, 0);
      if (c > bc) {
        bc = c;
        bi = i;
      }
    }
    return {
      key: t.key,
      label: t.label,
      desc: t.desc,
      reach: counts[0]!,
      consent: counts[2]!,
      firstOrder: counts[5]!,
      reorder: counts[6]!,
      reachToOrderRate: counts[0]! > 0 ? Number(((counts[5]! / counts[0]!) * 100).toFixed(1)) : 0,
      dataSufficient: counts[0]! >= FUNNEL_MIN_SAMPLE,
      bottleneck: {
        touchpoint: tps[bi === -1 ? 0 : bi]!,
        churned: bc,
        onsiteAdvice: t.onsiteAdvice,
      },
    };
  });
}
