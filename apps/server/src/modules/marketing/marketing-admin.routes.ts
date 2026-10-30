// ============================================================================
// 邻伴 · marketing 后台路由：券模板管理（契约 §5.3 后台段）
// ----------------------------------------------------------------------------
// 权限点：`marketing:*`（管理全量，ops + 超管）
//   注意区分：`marketing:read` 是只读（cs + finance 看券发��情况），
//   写操作一律要 `marketing:grant` 语义 —— 这里用 `marketing:*` 表达。
//
// 落位：独立 marketingAdminRouter，挂 /admin 前缀。
//   不放进 marketingRouter（那是 C 端前缀，且用 authMiddleware 三端鉴权），
//   混挂会导致后台端点的鉴权方式随路由顺序变化，是安全债。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { COUPON_STATUS, COUPON_STATUS_VALUES } from '@linban/shared';
import type { CouponStatus } from '@linban/shared';
import { adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { pageSchema, parseOrThrow } from '../../common/validation';
import {
  createCoupon,
  editCoupon,
  endCoupon,
  listCoupons,
  pauseCoupon,
  publishCoupon,
  resumeCoupon,
} from './coupon-admin.service';

export const marketingAdminRouter = Router();

/** 券类型的合法取值（与 schema coupon_type 一致） */
const COUPON_TYPES = ['FULL_REDUCTION', 'DURATION'] as const;
const couponTypeSchema = z.enum(COUPON_TYPES);

/** 面额/门槛等业务字段的上界（防手滑填 1e18 把库撑爆） */
const valueSchema = z.number().int().min(1).max(100_000);
const minSpendSchema = z.string().regex(/^\d{1,15}$/, '使用门槛必须是分（最多15位）');
const totalCountSchema = z.number().int().min(0).max(100_000_000);
const validDaysSchema = z.number().int().min(1).max(3650);

/** 路径参数：券 id 或券号都支持 */
const idOrNoParam = z.string().regex(/^\d{1,20}$|^[A-Za-z0-9_-]{1,32}$/, '券ID 或券号不合法');

/** ISO 时间字符串 → Date（可空） */
const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s))
  .nullable()
  .optional();

/** GET /admin/coupons —— 券模板列表（只读，`marketing:read` 即可） */
marketingAdminRouter.get('/coupons', adminAuthMiddleware, adminPermGuard('marketing:read'), async (req, res, next) => {
  try {
    const schema = z.object({
      ...pageSchema.shape,
      status: z.enum(COUPON_STATUS_VALUES as [CouponStatus, ...CouponStatus[]]).optional(),
      type: couponTypeSchema.optional(),
      keyword: z.string().max(64).optional(),
    });
    const q = parseOrThrow(schema, req.query);
    const out = await listCoupons(q);
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/coupons —— 新建券模板（落 DRAFT，不直接投放） */
marketingAdminRouter.post('/coupons', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(1).max(128),
      type: couponTypeSchema,
      value: valueSchema,
      minSpendFen: minSpendSchema,
      validDays: validDaysSchema,
      totalCount: totalCountSchema,
      scopeRules: z.unknown().optional(),
      startAt: isoDateSchema,
      endAt: isoDateSchema,
    });
    const input = parseOrThrow(schema, req.body);
    const out = await createCoupon({
      name: input.name,
      type: input.type,
      value: input.value,
      // 金额铁律：入参字符串 → 内部 BigInt（存分）
      minSpendFen: BigInt(input.minSpendFen),
      validDays: input.validDays,
      totalCount: input.totalCount,
      scopeRules: input.scopeRules,
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      adminId: req.admin!.adminId,
    });
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /admin/coupons/:id —— 编辑券模板
 * 业务校验在 domain/coupon.ts：
 *   - `claimed_count > 0` 时拒绝改 `value`（存量已领券与模板面额不一致）
 *   - `total_count` 不得小于 `claimed_count`（否则超发，库存负数）
 */
marketingAdminRouter.put('/coupons/:id', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const id = parseOrThrow(idOrNoParam, req.params.id);
    const schema = z.object({
      name: z.string().min(1).max(128).optional(),
      type: couponTypeSchema.optional(),
      value: valueSchema.optional(),
      minSpendFen: minSpendSchema.optional(),
      validDays: validDaysSchema.optional(),
      totalCount: totalCountSchema.optional(),
      scopeRules: z.unknown().optional(),
      startAt: isoDateSchema,
      endAt: isoDateSchema,
    });
    const input = parseOrThrow(schema, req.body);
    const out = await editCoupon(id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.value === undefined ? {} : { value: input.value }),
      ...(input.minSpendFen === undefined ? {} : { minSpendFen: BigInt(input.minSpendFen) }),
      ...(input.validDays === undefined ? {} : { validDays: input.validDays }),
      ...(input.totalCount === undefined ? {} : { totalCount: input.totalCount }),
      ...(input.scopeRules === undefined ? {} : { scopeRules: input.scopeRules }),
      ...(input.startAt === undefined ? {} : { startAt: input.startAt }),
      ...(input.endAt === undefined ? {} : { endAt: input.endAt }),
      adminId: req.admin!.adminId,
    });
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/coupons/:id/publish —— 草稿/已暂停 → 投放中（仅此二者可发布） */
marketingAdminRouter.post('/coupons/:id/publish', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const id = parseOrThrow(idOrNoParam, req.params.id);
    const out = await publishCoupon(id, req.admin!.adminId);
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/coupons/:id/pause —— 暂停投放（仅投放中；可恢复） */
marketingAdminRouter.post('/coupons/:id/pause', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const id = parseOrThrow(idOrNoParam, req.params.id);
    const out = await pauseCoupon(id, req.admin!.adminId);
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/coupons/:id/resume —— 恢复投放（仅已暂停；草稿请走 publish） */
marketingAdminRouter.post('/coupons/:id/resume', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const id = parseOrThrow(idOrNoParam, req.params.id);
    const out = await resumeCoupon(id, req.admin!.adminId);
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/coupons/:id/end —— 结束投放（**不可逆**，与 pause 分离；已结束幂等） */
marketingAdminRouter.post('/coupons/:id/end', adminAuthMiddleware, adminPermGuard('marketing:*'), async (req, res, next) => {
  try {
    const id = parseOrThrow(idOrNoParam, req.params.id);
    const out = await endCoupon(id, req.admin!.adminId);
    res.json({ code: 0, data: out, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

export { COUPON_STATUS };