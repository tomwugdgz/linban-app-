// ============================================================================
// 邻伴 · insurance 模块：保单登记 / 查询 / 理赔（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 策略（架构 §9）：MVP 半自动——支付成功后自动登记保单（适配器 mock），
// 出险理赔材料人工收单。TODO：渠道真实投保 API、到期提醒 cron、
// 理赔进度同步。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, adminAuthMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { idSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { getInsuranceAdapter } from '../../adapters/insurance';
import { genBizNo } from '../../common/ids';

export const insuranceRouter = Router();

/** POST /insurance/orders/:orderId/bind —— 支付成功后投保（幂等） */
insuranceRouter.post('/orders/:orderId/bind', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({
      where: { id: BigInt(req.params.orderId!) },
      include: { companion: true },
    });
    if (!order) throw new AppError(14001, '订单不存在');
    if (!order.companion) throw new AppError(14013, '订单未接单，不可投保');
    const existing = await prisma.insurance_policies.findFirst({ where: { order_id: order.id } });
    if (existing) {
      return res.json({ code: 0, data: { policyNo: existing.policy_no, status: existing.status }, requestId: res.locals.requestId });
    }
    const adapter = getInsuranceAdapter();
    const startAt = order.slot_start;
    const endAt = order.slot_end;
    const r = await adapter.createPolicy({
      orderId: order.id.toString(),
      orderNo: order.order_no,
      insuredNameCipher: order.companion.real_name_cipher,
      coverageAmountFen: 500000n, // 保额 ¥5000（MVP 固定档）
      startAt,
      endAt,
    });
    const policy = await prisma.insurance_policies.create({
      data: {
        // 🔴 我方单号：统一走 genBizNo，不再由 adapter 硬编码。
        //   【为什么收敛入口而不是统一历史格式】存量单号格式已固化且对外暴露
        //   （契约 §4 登记 POST /insurance/policies/:policyNo/claim），
        //   改格式 = 破坏性变更。故：**新单号走统一入口，存量读回分支不动**。
        //   入口统一后格式会自然收敛，但历史数据不需要迁移。
        //   【存量两种格式】旧 `POL{时间戳}{order后6}` / 新 `POL{yyyyMMdd}{随机}`，
        //   **解析不得依赖格式**，只能精确匹配查库。
        policy_no: genBizNo('policy'),
        // 🔴 渠道单号单独落库（字段语义单一），见 schema 注释。
        channel_policy_no: r.channelPolicyNo,
        order_id: order.id,
        insured_user_id: order.elder_user_id,
        insured_companion_id: order.companion_id,
        insurer: '待定渠道（mock）',
        product_name: '陪聊员意外险（MVP）',
        coverage_amount_fen: 500000n,
        premium_fen: r.premiumFen,
        start_at: startAt,
        end_at: endAt,
        status: 'ACTIVE',
      },
    });
    res.json({
      code: 0,
      data: {
        policyNo: policy.policy_no,
        premiumFen: policy.premium_fen.toString(),
        status: policy.status,
        // 渠道单号仅当渠道已接入且有值时透出（契约未登记，前端先不依赖）
        ...(policy.channel_policy_no ? { channelPolicyNo: policy.channel_policy_no } : {}),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /insurance/orders/:orderId —— 订单保单 */
insuranceRouter.get('/orders/:orderId', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.orderId!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    const policy = await prisma.insurance_policies.findFirst({ where: { order_id: order.id } });
    if (!policy) throw new AppError(19101, '保单不存在');
    res.json({
      code: 0,
      data: {
        policyNo: policy.policy_no,
        insurer: policy.insurer,
        productName: policy.product_name,
        coverageAmountFen: policy.coverage_amount_fen.toString(),
        premiumFen: policy.premium_fen.toString(),
        startAt: policy.start_at.toISOString(),
        endAt: policy.end_at.toISOString(),
        status: policy.status,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /insurance/policies/:policyNo/claim —— 理赔登记 */
insuranceRouter.post('/policies/:policyNo/claim', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ reason: z.string().min(5).max(500), evidenceFileIds: z.array(idSchema).max(10) });
    const { reason, evidenceFileIds } = parseOrThrow(schema, req.body);
    const policy = await prisma.insurance_policies.findUnique({ where: { policy_no: req.params.policyNo! } });
    if (!policy) throw new AppError(19101, '保单不存在');
    if (policy.status !== 'ACTIVE' && policy.status !== 'EXPIRED') throw new AppError(19104, '当前保单不可理赔');
    const adapter = getInsuranceAdapter();
    const claim = await adapter.createClaim({
      policyNo: policy.policy_no,
      orderId: policy.order_id?.toString() ?? '',
      reason,
      evidenceObjectKeys: evidenceFileIds,
    });
    await prisma.insurance_policies.update({ where: { id: policy.id }, data: { status: 'CLAIMING' } });
    res.json({ code: 0, data: { claimNo: claim.claimNo, status: claim.status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/insurance/policies —— 后台保单列表（TODO：到期提醒 cron） */
export const insuranceAdminRouter = Router();
insuranceAdminRouter.get('/policies', adminAuthMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(20) });
    const { page, pageSize } = parseOrThrow(schema, req.query);
    const [list, total] = await Promise.all([
      prisma.insurance_policies.findMany({ orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.insurance_policies.count(),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((p) => ({
          policyNo: p.policy_no,
          orderId: p.order_id?.toString() ?? null,
          coverageAmountFen: p.coverage_amount_fen.toString(),
          premiumFen: p.premium_fen.toString(),
          status: p.status,
          startAt: p.start_at.toISOString(),
          endAt: p.end_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});
