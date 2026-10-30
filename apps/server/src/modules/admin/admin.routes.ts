// ============================================================================
// 邻伴 · admin 模块：后台管理（配置中心 / 审计 / 工作台总览，骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：系统配置读写（热缓存失效 + audit_logs）、审计日志查询、
//         工作台总览（订单/分账/风控计数）。
// TODO：RBAC 动态角色管理（roles/permissions CRUD）、后台账号管理、
//       敏感操作 TOTP 二次验证（finance/超管）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { SYSTEM_CONFIG_DEFAULTS, SPLIT_MODE, CONFIG_DOMAIN_GROUPS } from '@linban/shared';
import type { ConfigValueType, SplitMode, ConfigDomainGroup } from '@linban/shared';
import { adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { pageSchema } from '../../common/validation';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/prisma';
import { invalidateConfigCache, setConfigCache } from '../../infra/redis';

export const adminRouter = Router();

/**
 * 配置变更历史 / 审计日志的**候选集上限**。
 *
 * 之所以能在应用层做筛选（operator / keyword 依赖 JOIN 后的 admin.real_name，
 * SQL 层不好筛），代价是「先取一批候选、再在内存里筛」——
 * 候选集外的行**根本不会被看到**。故必须出参告知调用方`total` 可能偏大。
 */
const CANDIDATE_LIMIT = 500;

/** GET /admin/configs —— 配置列表（含默认值兜底展示） */
adminRouter.get('/configs', adminAuthMiddleware, adminPermGuard('config:read'), async (req, res, next) => {
  try {
    const rows = await prisma.system_configs.findMany({ orderBy: { config_key: 'asc' } });
    res.json({
      code: 0,
      data: rows.map((r) => ({
        configKey: r.config_key,
        configValue: r.config_value,
        valueType: r.value_type,
        description: r.description,
        updatedAt: r.updated_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** PUT /admin/configs/:key —— 修改配置（热缓存失效 + 审计） */
adminRouter.put('/configs/:key', adminAuthMiddleware, adminPermGuard('config:read'), async (req, res, next) => {
  try {
    const schema = z.object({ configValue: z.string().min(1).max(256), description: z.string().max(256).optional() });
    const { configValue, description } = parseOrThrow(schema, req.body);
    const key = req.params.key!;

    // 类型校验（按种子默认值声明的 value_type）
    const seed = SYSTEM_CONFIG_DEFAULTS[key];
    const valueType: ConfigValueType = seed?.valueType ?? 'STRING';
    if (valueType === 'INT' && !/^-?\d+$/.test(configValue)) throw new AppError(21003, '配置值须为整数');
    if (valueType === 'BOOL' && !['true', 'false'].includes(configValue)) throw new AppError(21003, '配置值须为 true/false');
    if (valueType === 'DECIMAL' && !/^\d+(\.\d+)?$/.test(configValue)) throw new AppError(21003, '配置值须为十进制数');
    // 枚举白名单（STRING 型但取值封闭的键）
    if (key === 'split_mode' && ![SPLIT_MODE.WECHAT_PROFIT_SHARING, SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK].includes(configValue as SplitMode)) {
      throw new AppError(21003, 'split_mode 仅允许 wechat_profit_sharing / manual_settlement_fallback');
    }

    // 白名单：仅允许改种子表中已声明的键（防止随手加配置绕过架构评审）
    if (!seed) throw new AppError(21003, '配置项不存在（新增配置须先回改架构附录 C）');

    const before = await prisma.system_configs.findUnique({ where: { config_key: key } });
    await prisma.system_configs.upsert({
      where: { config_key: key },
      create: { config_key: key, config_value: configValue, value_type: valueType, description: description ?? seed.description },
      update: { config_value: configValue, ...(description ? { description } : {}) },
    });
    // 热缓存主动失效（架构 §5.2：后台修改即失效）
    await invalidateConfigCache();
    await setConfigCache(await loadAllConfigs());
    // 审计（变更前后快照，可回放）
    await prisma.audit_logs.create({
      data: {
        admin_id: req.admin!.adminId,
        action: 'CONFIG_UPDATE',
        module: 'admin',
        target_type: 'system_configs',
        target_id: key,
        before_json: before ? { config_value: before.config_value } : Prisma.JsonNull,
        after_json: { config_value: configValue, value_type: valueType },
      },
    });
    res.json({ code: 0, data: { configKey: key, configValue }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /admin/configs/changelog —— 配置变更历史（audit_logs 的过滤视图）
 * ----------------------------------------------------------------------------
 * 落位核实：**不建新表**。配置变更与其它后台动作统一落 audit_logs：
 *   module='system' / action='update' / before_json+after_json 存前后快照。
 * 工作量因此从「建表 + 双写」降到「一个查询视图」。
 *
 * 为什么值得单独开一个端点而不是让前端自己筛 /audit-logs：
 *   /audit-logs 出参是**原始审计结构**（before/after 是 Json、targetId 是配置键），
 *   前端要自己解析 Json 才知道「哪个键、从什么改成什么」。
 *   这里做一次服务端整形：拍平 before/after、补 configLabel、接上操作人姓名。
 *
 * 权限：`config:read`（读配置变更不需要改配置的权限，与 PUT /configs 同点）。
 */
adminRouter.get(
  '/configs/changelog',
  adminAuthMiddleware,
  adminPermGuard('config:read'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        ...pageSchema.shape,
        configKey: z.string().max(64).optional(),
        // 运营在页面上看到的是中文分组名，前端直接透传。
        // **取值域从 @linban/shared 的 CONFIG_DOMAIN_GROUPS 派生**（宋砚秋 2026-10 上收）：
        // 原先这里硬编码 4 个值，而前端下拉有 6 个组 → 运营点「核销与到岗」等4 组
        // 会被parseOrThrow 判为非法 → **400，且前端只显示通用错误**，等于该筛选项完全不可用。
        // 派生后加新组自动生效，永不再漂。
        group: z
          .enum(Object.keys(CONFIG_DOMAIN_GROUPS) as [ConfigDomainGroup, ...ConfigDomainGroup[]])
          .optional(),
        operator: z.string().max(64).optional(),
        keyword: z.string().max(64).optional(),
      });
      const { page, pageSize, configKey, group, operator, keyword } = parseOrThrow(schema, req.query);

      // 配置域 → 键白名单。**必须是白名单而非前缀通配**：
      // `activity_` 前缀若将来被别的模块占用（如 activity_log 模块的清理开关），
      // 通配会把无关配置混进「健康活动感知」分组，运营会看到不属于该域的变更。
      //
      // 白名单同样从 shared 取（CONFIG_DOMAIN_GROUPS），**不再本地维护一份**：
      // 原先本地只有 2 组 16 键，缺 12 键 —— 运营筛「核销与到岗」等组会查出空列表，
      // 页面显示「暂无记录」，运营会以为没人改过配置，而**没有任何报错**。
      // 键集不变式（=== SYSTEM_CONFIG_DEFAULTS 的 28 键）由 doc:check:configs 段 6 断言。
      const GROUP_KEYS = CONFIG_DOMAIN_GROUPS;

      // audit_logs 里配置变更的固定口径（写侧 admin.routes PUT /configs/:key 已对齐）
      const baseWhere = {
        module: 'system',
        action: 'update',
        target_type: 'system_configs',
      };

      // configKey 精确筛选 OR group 白名单筛选
      // group 已是中文组名（CONFIG_DOMAIN_GROUPS 的键），直接取白名单，无需别名层。
      const where = {
        ...baseWhere,
        ...(configKey
          ? { target_id: configKey }
          : group
            ? { target_id: { in: [...GROUP_KEYS[group]] } }
            : {}),
      };

      // operator / keyword 需先在应用层筛（涉及 admin 姓名与 Json 内容，SQL 侧做不了）
      const [rows, totalAll] = await Promise.all([
        prisma.audit_logs.findMany({
          where,
          include: { admin: { select: { id: true, username: true, real_name: true } } },
          orderBy: { created_at: 'desc' },
          take: CANDIDATE_LIMIT, // 上限：应用层筛选需要足够宽的候选集
        }),
        prisma.audit_logs.count({ where }),
      ]);

      const filtered = rows.filter((r) => {
        const name = r.admin?.real_name || r.admin?.username || '';
        if (operator && !name.includes(operator)) return false;
        if (keyword) {
          const hay = `${r.target_id ?? ''} ${name} ${r.request_id ?? ''}`.toLowerCase();
          if (!hay.includes(keyword.toLowerCase())) return false;
        }
        return true;
      });

      // 应用层分页（候选集上限 500，超出请收紧筛选条件）
      const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        code: 0,
        data: {
          list: paged.map((a) => {
            const key = a.target_id ?? '';
            // configLabel 直接取种子表的中文 description：前端不必再维护一份映射表，
            // 少一处会漂移的地方。未知键（历史遗留/已下线）回落为键名本身。
            const label = SYSTEM_CONFIG_DEFAULTS[key]?.description ?? key;
            const before = (a.before_json ?? {}) as Record<string, unknown>;
            const after = (a.after_json ?? {}) as Record<string, unknown>;
            return {
              id: a.id.toString(),
              configKey: key,
              configLabel: label,
              beforeValue: before.config_value === undefined ? '' : String(before.config_value),
              afterValue: after.config_value === undefined ? '' : String(after.config_value),
              operator: a.admin?.real_name || a.admin?.username || '未知',
              // 出参名是 changedAt，落库列名才是 audit_logs.created_at。
              // 二者语义不同：列名答「这条审计记录何时写入」，
              // 出参名答「配置何时被改」（运营看的是后者）。按列名直出会让页面该列空白。
              changedAt: a.created_at.toISOString(),
              requestId: a.request_id ?? '',
              ip: a.ip ?? '',
            };
          }),
          // total 用应用层筛选后的真实条数（≠ totalAll，那是未筛选的总数）
          total: filtered.length,
          page,
          pageSize,
          /**
           * 🔴 候选集被截断（`take: CANDIDATE_LIMIT`）。
           *
           * 【危害：数字偏大】与另两处方向相反，务必分清：
           *   candidateTruncated    ← 本处：**候选集被截** → `total` 可能**偏大**
           *     （真实有 800 条符合，但候选集只取了 500，运营以为只有 500）
           *   detailTruncated       → 明细行被截 → 少显示几行
           *   attributionTruncated  → 归因聚合被截 → **聚合数字偏小**
           *
           * 【判据用 rows 而非 filtered】
           *   `filtered ⊆ rows`，两者都能到 500，但**含义不同**：
           *   - `rows.length === 500` →候选集取满了 → 可能有更多未纳入 → **total 偏大**
           *   - `filtered.length === 500` → 若 filtered 也满，rows 必然也满（同一前提），
           *     故两者在「是否截断」上等价；但用 rows 表达的是**截断的直接原因**
           *     （取数上限），而 filtered 表达的是「恰好结果数」，容易被误读为「结果就是 500 条」。
           *   统一用 rows，避免读者以为在描述结果集。
           *
           * 【保守判据】取满即视为可能截断 —— 可能误报（真的只有 500 条），绝不漏报。
           */
          candidateTruncated: rows.length >= CANDIDATE_LIMIT,
        },
        requestId: res.locals.requestId,
      });
    } catch (e) {
      next(e);
    }
  },
);

/** GET /admin/audit-logs —— 审计日志查询 */
adminRouter.get('/audit-logs', adminAuthMiddleware, adminPermGuard('config:read'), async (req, res, next) => {
  try {
    const schema = z.object({
      ...pageSchema.shape,
      adminId: z.string().regex(/^\d+$/).optional(),
      action: z.string().optional(),
      targetType: z.string().optional(),
    });
    const { page, pageSize, adminId, action, targetType } = parseOrThrow(schema, req.query);
    const where = {
      ...(adminId ? { admin_id: BigInt(adminId) } : {}),
      ...(action ? { action } : {}),
      ...(targetType ? { target_type: targetType } : {}),
    };
    const [list, total] = await Promise.all([
      prisma.audit_logs.findMany({ where, orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.audit_logs.count({ where }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((a) => ({
          id: a.id.toString(),
          adminId: a.admin_id?.toString() ?? null,
          action: a.action,
          module: a.module,
          targetType: a.target_type,
          targetId: a.target_id,
          before: a.before_json,
          after: a.after_json,
          requestId: a.request_id,
          ip: a.ip,
          createdAt: a.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/dashboard —— 工作台总览 */
adminRouter.get('/dashboard', adminAuthMiddleware, async (req, res, next) => {
  try {
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const [
      ordersToday, ordersActive, sharingsFrozen, riskPending, complaintsPending, reportsPending, applicationsInReview,
    ] = await Promise.all([
      prisma.orders.count({ where: { created_at: { gte: today } } }),
      prisma.orders.count({ where: { status: { in: ['PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM'] } } }),
      prisma.profit_sharing_records.count({ where: { status: 'FROZEN' } }),
      prisma.risk_events.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.complaints.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.reports.count({ where: { status: 'PENDING' } }),
      prisma.companion_applications.count({ where: { active_key: 'A' } }),
    ]);
    res.json({
      code: 0,
      data: { ordersToday, ordersActive, sharingsFrozen, riskPending, complaintsPending, reportsPending, applicationsInReview },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/me —— 当前后台账号 + 权限 */
adminRouter.get('/me', adminAuthMiddleware, async (req, res, next) => {
  try {
    const admin = await prisma.admins.findUnique({
      where: { id: req.admin!.adminId },
      include: { role: true },
    });
    if (!admin) throw new AppError(21001, '后台账号不存在');
    res.json({
      code: 0,
      data: {
        id: admin.id.toString(),
        username: admin.username,
        realName: admin.real_name,
        roleKey: admin.role?.role_key ?? 'cs',
        roleName: admin.role?.name ?? '客服',
        status: admin.status,
        lastLoginAt: admin.last_login_at?.toISOString() ?? null,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** 全量配置快照（缓存刷新用） */
export async function loadAllConfigs(): Promise<Record<string, string>> {
  const rows = await prisma.system_configs.findMany();
  return Object.fromEntries(rows.map((r) => [r.config_key, r.config_value]));
}
