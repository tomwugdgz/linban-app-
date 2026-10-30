// ============================================================================
// 邻伴 · support 模块：客服工单 / 回访任务（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：派单超时转人工工单查询、订单挂起裁决入口（与 verification 联动）、
//         回访任务列表/完成。
// TODO：工单完整 CRUD（support_tickets 表待 schema 增补或复用 complaints）、
//       回访计划自动生成（订单完成后 24h）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, adminAuthMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { idSchema, pageSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { refundOrder } from '../payment/payment.service';
import { assertTransition } from '../../domain/order-state-machine';

export const supportRouter = Router();

/** GET /admin/support/dispatch-timeout —— 派单超时候补工单（§6.1：30min 无人接单） */
export const supportAdminRouter = Router();
supportAdminRouter.get('/dispatch-timeout', adminAuthMiddleware, async (req, res, next) => {
  try {
    const { page, pageSize } = parseOrThrow(pageSchema, req.query);
    const list = await prisma.orders.findMany({
      where: { status: 'DISPATCHED', dispatch_deadline_at: { lt: new Date() } },
      orderBy: { dispatch_deadline_at: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    res.json({
      code: 0,
      data: list.map((o) => ({
        orderId: o.id.toString(),
        orderNo: o.order_no,
        dispatchDeadlineAt: o.dispatch_deadline_at?.toISOString() ?? null,
        overdueMin: o.dispatch_deadline_at ? Math.floor((Date.now() - o.dispatch_deadline_at.getTime()) / 60000) : 0,
        totalAmountFen: o.total_amount_fen.toString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/support/orders/:id/decide —— 客服裁决挂起订单（架构 §6.5 状态机） */
supportAdminRouter.post('/orders/:id/decide', adminAuthMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      decision: z.enum(['COMPLETE', 'PARTIAL_REFUND', 'FULL_REFUND']),
      note: z.string().min(2).max(256),
    });
    const { decision, note } = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (order.status !== 'SUSPENDED') throw new AppError(14002, '仅挂起订单可裁决');
    assertTransition('SUSPENDED', decision === 'COMPLETE' ? 'COMPLETED' : 'REFUNDED');

    if (decision === 'COMPLETE') {
      // 裁决完成 → COMPLETED（分账由 confirmCompletion 的补偿或手动执行）
      const { confirmCompletion } = await import('../order/order.service');
      await prisma.orders.update({
        where: { id: order.id },
        data: { cs_decision: decision, cs_operator_id: req.admin!.adminId },
      });
      await confirmCompletion(order.id, 'COMPANION', undefined);
      return res.json({ code: 0, data: { status: 'COMPLETED', decision }, requestId: res.locals.requestId });
    }

    // 退款裁决：部分退按比例（MVP：部分退 = 50%），全退 = 100%
    const refundFen =
      decision === 'FULL_REFUND' ? order.total_amount_fen : order.total_amount_fen / 2n;
    await prisma.orders.update({
      where: { id: order.id },
      data: {
        cs_decision: decision,
        cs_operator_id: req.admin!.adminId,
        status: 'REFUNDED',
        refund_amount_fen: { increment: refundFen },
      },
    });
    await refundOrder(order.id, refundFen, `客服裁决：${note}`, 'PLATFORM').catch((e) => {
      throw new AppError(15013, `退款执行失败：${(e as Error).message}`);
    });
    await prisma.order_timeline.create({
      data: {
        order_id: order.id,
        from_status: 'SUSPENDED',
        to_status: 'REFUNDED',
        action: 'cs-decide',
        operator_type: 'ADMIN',
        operator_id: req.admin!.adminId,
        reason: note,
        extra: { decision, refundFen: refundFen.toString() },
      },
    });
    res.json({ code: 0, data: { status: 'REFUNDED', decision, refundAmountFen: refundFen.toString() }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/support/revisits —— 回访任务列表（订单完成后关怀回访） */
supportAdminRouter.get('/revisits', adminAuthMiddleware, async (req, res, next) => {
  try {
    const { page, pageSize } = parseOrThrow(pageSchema, req.query);
    const [list, total] = await Promise.all([
      prisma.revisit_tasks.findMany({ orderBy: { created_at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.revisit_tasks.count(),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((t) => ({
          taskNo: t.task_no,
          orderId: t.order_id.toString(),
          type: t.type,
          status: t.status,
          plannedAt: t.planned_at.toISOString(),
          resultNote: t.result_note,
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /support/revisits/mine —— 陪聊员/老人视角回访（TODO：角色分流） */
supportRouter.get('/revisits/mine', authMiddleware, async (_req, res, next) => {
  try {
    res.json({ code: 0, data: [], requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

void idSchema;
