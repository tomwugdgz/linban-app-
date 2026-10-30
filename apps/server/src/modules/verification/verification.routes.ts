// ============================================================================
// 邻伴 · verification 模块路由（到岗核销 / 完成确认，架构 §6.2 2/5）
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { adminAuthMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { idSchema } from '../../common/validation';
import { csRecordCompletion, getVerificationByOrder, issueArrivalCode } from './verification.service';
import { prisma } from '../../infra/prisma';

export const verificationRouter = Router();

/** POST /verifications/arrival-code —— 老人出示到岗动态码 */
verificationRouter.post('/arrival-code', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ orderId: idSchema });
    const { orderId } = parseOrThrow(schema, req.body);
    const r = await issueArrivalCode(BigInt(orderId), req.user!.userId);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /verifications/order/:orderId —— 订单核销记录（订单相关方/后台） */
verificationRouter.get('/order/:orderId', authMiddleware, async (req, res, next) => {
  try {
    const list = await getVerificationByOrder(BigInt(req.params.orderId!));
    res.json({
      code: 0,
      data: list.map((v) => ({
        id: v.id.toString(),
        type: v.type,
        status: v.status,
        attemptNo: v.attempt_no,
        faceScore: v.face_score,
        facePassed: v.face_passed,
        gpsDeviationM: v.gps_deviation_m,
        arrivedAt: v.arrived_at?.toISOString() ?? null,
        companionConfirmedAt: v.companion_confirmed_at?.toISOString() ?? null,
        elderConfirmedAt: v.elder_confirmed_at?.toISOString() ?? null,
        elderVoiceAsr: v.elder_voice_asr,
        failReason: v.fail_reason,
        createdAt: v.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /verifications/cs-completion —— 客服人工补录完成确认（电话确认争议单） */
verificationRouter.post('/cs-completion', adminAuthMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ orderId: idSchema, note: z.string().min(2).max(256) });
    const { orderId, note } = parseOrThrow(schema, req.body);
    const r = await csRecordCompletion(BigInt(orderId), req.admin!.adminId, note);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /verifications/suspend —— 异常挂起（客服：PENDING_CONFIRM → SUSPENDED，架构 §6.5；
 *  与 SOS/服务超时共用 suspendOrderForSafety 裁决出口，team-lead 裁定③） */
verificationRouter.post('/suspend', adminAuthMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ orderId: idSchema, reason: z.string().min(2).max(256) });
    const { orderId, reason } = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({ where: { id: BigInt(orderId) } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (order.status !== 'PENDING_CONFIRM') throw new AppError(14002, '仅待确认订单可挂起');
    const { suspendOrderForSafety } = await import('../order/order.service');
    await suspendOrderForSafety(
      { id: order.id, order_no: order.order_no, status: order.status },
      reason,
      { type: 'ADMIN', id: req.admin!.adminId },
    );
    res.json({ code: 0, data: { status: 'SUSPENDED' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});
