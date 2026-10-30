// ============================================================================
// 邻伴 · order 模块路由（架构 §6.1/§6.2 链路）
// 完整契约见 docs/API-CONTRACT.md §5。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { parseOrThrow, validateBody } from '../../common/validation';
import { fenSchema, hmSchema, idSchema, localDateSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import {
  cancelOrder,
  closeOrder,
  confirmCompletion,
  createOrder,
  dispatchOrder,
  finishService,
  getOrderDetail,
  grabOrder,
  markOrderPaid,
  orderAccessible,
  startService,
  sweepDispatchTimeout,
  sweepNightConfirmTimeout,
  sweepPayTimeout,
  sweepServiceOvertimeSuspend,
} from './order.service';
import { recordArrivalVerification } from '../verification/verification.service';

export const orderRouter = Router();

// ---------------------------------------------------------------------------
// POST /orders —— 创建订单（老人本人 / 子女代下）
// ---------------------------------------------------------------------------
orderRouter.post('/', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      elderUserId: idSchema,
      companionId: idSchema.optional(),
      durationMinutes: z.number().int().min(60).max(480),
      serviceDate: localDateSchema,
      startTime: hmSchema,
      address: z.string().min(5).max(200),
      addressLat: z.number(),
      addressLng: z.number(),
      couponUserCouponId: idSchema.optional(),
      giftCardId: idSchema.optional(),
      remark: z.string().max(512).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const order = await createOrder({
      userId: req.user!.userId,
      elderUserId: BigInt(input.elderUserId),
      companionId: input.companionId ? BigInt(input.companionId) : null,
      durationMinutes: input.durationMinutes,
      serviceDate: input.serviceDate,
      startTime: input.startTime,
      address: input.address,
      addressLat: input.addressLat,
      addressLng: input.addressLng,
      couponUserCouponId: input.couponUserCouponId ? BigInt(input.couponUserCouponId) : null,
      giftCardId: input.giftCardId ? BigInt(input.giftCardId) : null,
      remark: input.remark,
      createdVia: req.user!.role === 'FAMILY' ? 'FAMILY_APP' : 'ELDER_APP',
    });
    res.json({
      code: 0,
      data: {
        orderId: order.id.toString(),
        orderNo: order.order_no,
        status: order.status,
        totalAmountFen: order.total_amount_fen.toString(),
        hourlyRateFen: order.hourly_rate_fen.toString(),
        payTimeoutMin: 15,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /orders —— 我的订单列表（老人视角/子女视角/陪聊员视角）
// ---------------------------------------------------------------------------
orderRouter.get('/', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    });
    const { status, page, pageSize } = parseOrThrow(schema, req.query);

    // 视角分流：陪聊员看接单；老人/子女看下单
    let where: Record<string, unknown>;
    if (req.user!.role === 'COMPANION') {
      const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
      if (!companion) throw new AppError(13001, '陪聊员主档不存在');
      where = { companion_id: companion.id, ...(status ? { status } : {}) };
    } else {
      // 子女可看其绑定老人的单
      const boundElderIds = await prisma.family_bindings
        .findMany({ where: { family_user_id: req.user!.userId, status: 'ACTIVE' }, select: { elder_user_id: true } })
        .then((rows) => rows.map((r) => r.elder_user_id));
      where = {
        OR: [{ user_id: req.user!.userId }, { elder_user_id: { in: [req.user!.userId, ...boundElderIds] } }],
        ...(status ? { status } : {}),
      };
    }

    const [list, total] = await Promise.all([
      prisma.orders.findMany({
        where,
        include: {
          companion: { include: { user: { select: { id: true, nickname: true, avatar_url: true } } } },
          elder_user: { select: { id: true, nickname: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.orders.count({ where }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((o) => ({
          id: o.id.toString(),
          orderNo: o.order_no,
          status: o.status,
          serviceType: o.service_type,
          durationMinutes: o.duration_minutes,
          serviceDate: o.service_date.toISOString().slice(0, 10),
          slotStart: o.slot_start.toISOString(),
          slotEnd: o.slot_end.toISOString(),
          totalAmountFen: o.total_amount_fen.toString(),
          hourlyRateFen: o.hourly_rate_fen.toString(),
          couponDeductFen: o.coupon_deduct_fen.toString(),
          giftCardDeductFen: o.gift_card_deduct_fen.toString(),
          companion: o.companion
            ? { id: o.companion.id.toString(), nickname: o.companion.user.nickname, avatarUrl: o.companion.user.avatar_url }
            : null,
          elderNickname: o.elder_user.nickname,
          nightOrder: o.night_order,
          createdAt: o.created_at.toISOString(),
        })),
        total,
        page,
        pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /orders/dispatch/pool —— 陪聊员抢单池（DISPATCHED 附近未派指定）
// ---------------------------------------------------------------------------
orderRouter.get('/dispatch/pool', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    const schema = z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().max(50).default(20) });
    const { page, pageSize } = parseOrThrow(schema, req.query);
    const list = await prisma.orders.findMany({
      where: {
        status: 'DISPATCHED',
        companion_id: null, // 广播池（指定单不进池）
        geo_hash: { startsWith: companion.geo_hash.slice(0, 4) },
        service_date: { gte: new Date() },
      },
      orderBy: { slot_start: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    res.json({
      code: 0,
      data: list.map((o) => ({
        id: o.id.toString(),
        orderNo: o.order_no,
        serviceDate: o.service_date.toISOString().slice(0, 10),
        slotStart: o.slot_start.toISOString(),
        slotEnd: o.slot_end.toISOString(),
        durationMinutes: o.duration_minutes,
        totalAmountFen: o.total_amount_fen.toString(),
        distanceM: o.distance_m,
        nightOrder: o.night_order,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /orders/:id —— 订单详情
// ---------------------------------------------------------------------------
orderRouter.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const order = await getOrderDetail(BigInt(req.params.id!));
    if (!orderAccessible(order, req.user!.userId, req.user!.role)) {
      // 后台角色放行（admin 中间件单独路由）
      throw new AppError(10004, '非订单相关方');
    }
    res.json({
      code: 0,
      data: serializeOrder(order),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/cancel —— 取消订单
// ---------------------------------------------------------------------------
orderRouter.post('/:id/cancel', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ reason: z.string().min(2).max(256) });
    const { reason } = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (!orderAccessible(order, req.user!.userId, req.user!.role)) throw new AppError(10004, '非订单相关方');

    let initiator: 'USER' | 'COMPANION' | 'PLATFORM' = 'USER';
    if (req.user!.role === 'COMPANION') initiator = 'COMPANION';
    const r = await cancelOrder(order.id, initiator, reason, req.user!.userId);
    res.json({
      code: 0,
      data: {
        status: 'CANCELLED',
        cancelFeeFen: r.cancelFeeFen.toString(),
        refundAmountFen: r.refundAmountFen.toString(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/grab —— 抢单（陪聊员）
// ---------------------------------------------------------------------------
orderRouter.post('/:id/grab', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const r = await grabOrder(BigInt(req.params.id!), req.user!.userId);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/arrive —— 到岗核销（动态码 + 人脸 + GPS，架构 §6.2 2）
// ---------------------------------------------------------------------------
orderRouter.post('/:id/arrive', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({
      dynamicCode: z.string().regex(/^\d{6}$/),
      codeMode: z.enum(['ELDER_SHOW', 'COMPANION_SCAN']),
      faceScore: z.number().int().min(0).max(100),
      livenessScore: z.number().int().min(0).max(100),
      faceVerifyId: z.string().min(1),
      gpsLat: z.number(),
      gpsLng: z.number(),
    });
    const input = parseOrThrow(schema, req.body);
    const r = await recordArrivalVerification({
      orderId: BigInt(req.params.id!),
      companionUserId: req.user!.userId,
      ...input,
    });
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/start —— 开始服务
// ---------------------------------------------------------------------------
orderRouter.post('/:id/start', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    await startService(BigInt(req.params.id!));
    res.json({ code: 0, data: { status: 'IN_SERVICE' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/finish —— 结束服务（进入待确认）
// ---------------------------------------------------------------------------
orderRouter.post('/:id/finish', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    await finishService(BigInt(req.params.id!));
    res.json({ code: 0, data: { status: 'PENDING_CONFIRM' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/confirm —— 完成确认（双方；老人可语音「满意」）
// ---------------------------------------------------------------------------
orderRouter.post('/:id/confirm', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ elderVoiceAsr: z.string().max(100).optional() });
    const { elderVoiceAsr } = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (!orderAccessible(order, req.user!.userId, req.user!.role)) throw new AppError(10004, '非订单相关方');
    const role = req.user!.role === 'COMPANION' ? 'COMPANION' : 'USER';
    const r = await confirmCompletion(order.id, role, elderVoiceAsr);
    res.json({
      code: 0,
      data: r.completed ? { status: 'COMPLETED' } : { status: 'PENDING_CONFIRM', waiting: r.waiting },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /orders/:id/night-confirm —— 夜间单子女确认（night_order=true）
// ---------------------------------------------------------------------------
orderRouter.post('/:id/night-confirm', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (!order.night_order) throw new AppError(10001, '非夜间订单');
    // 确认人资格（裁定④）：须为该老人生效绑定中的子女账号
    const binding = await prisma.family_bindings.findFirst({
      where: { elder_user_id: order.elder_user_id, family_user_id: req.user!.userId, status: 'ACTIVE', active_key: 'A' },
    });
    if (!binding) throw new AppError(12004, '仅老人绑定的子女账号可确认夜间单');
    const { count } = await prisma.orders.updateMany({
      where: { id: order.id, night_order: true, family_confirmed_at: null },
      data: { family_confirmer_id: req.user!.userId, family_confirmed_at: new Date() },
    });
    if (count === 0) throw new AppError(10008, '已确认或状态变化');
    res.json({ code: 0, data: { familyConfirmed: true }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 内部：支付超时/派单超时扫描入口（供 worker 或管理后台手动触发）
// ---------------------------------------------------------------------------
export async function runOrderSweeps(): Promise<{ payTimeout: number; dispatchTimeout: number; serviceOvertime: number; nightConfirm: number }> {
  const payTimeout = await sweepPayTimeout();
  const dispatchTimeout = await sweepDispatchTimeout();
  const serviceOvertime = await sweepServiceOvertimeSuspend();
  const nightConfirm = await sweepNightConfirmTimeout();
  return { payTimeout, dispatchTimeout, serviceOvertime, nightConfirm };
}

export { markOrderPaid, dispatchOrder, closeOrder };

// ---------------------------------------------------------------------------
// 序列化（BigInt → string，schema 实现注意 a）
// ---------------------------------------------------------------------------

function serializeOrder(order: Awaited<ReturnType<typeof getOrderDetail>>) {
  return {
    id: order.id.toString(),
    orderNo: order.order_no,
    status: order.status,
    serviceType: order.service_type,
    durationMinutes: order.duration_minutes,
    serviceDate: order.service_date.toISOString().slice(0, 10),
    slotStart: order.slot_start.toISOString(),
    slotEnd: order.slot_end.toISOString(),
    hourlyRateFen: order.hourly_rate_fen.toString(),
    originalAmountFen: order.original_amount_fen.toString(),
    couponDeductFen: order.coupon_deduct_fen.toString(),
    giftCardDeductFen: order.gift_card_deduct_fen.toString(),
    totalAmountFen: order.total_amount_fen.toString(),
    nightOrder: order.night_order,
    familyConfirmed: Boolean(order.family_confirmed_at),
    cancelInitiator: order.cancel_initiator,
    cancelReason: order.cancel_reason,
    cancelFeeFen: order.cancel_fee_fen.toString(),
    refundAmountFen: order.refund_amount_fen.toString(),
    dispatchedAt: order.dispatched_at?.toISOString() ?? null,
    dispatchDeadlineAt: order.dispatch_deadline_at?.toISOString() ?? null,
    // 挂起原因必须透出：陪聊员服务页不知道单子为什么停了，是差评与投诉的主要来源
    suspendReason: order.suspend_reason ?? null,
    acceptedAt: order.accepted_at?.toISOString() ?? null,
    arrivedAt: order.arrived_at?.toISOString() ?? null,
    serviceStartedAt: order.service_started_at?.toISOString() ?? null,
    serviceEndedAt: order.service_ended_at?.toISOString() ?? null,
    completedAt: order.completed_at?.toISOString() ?? null,
    closedAt: order.closed_at?.toISOString() ?? null,
    user: brief(order.user),
    elderUser: brief(order.elder_user),
    companion: order.companion
      ? {
          id: order.companion.id.toString(),
          nickname: order.companion.user.nickname,
          avatarUrl: order.companion.user.avatar_url,
          hourlyRateFen: order.companion.hourly_rate_fen.toString(),
        }
      : null,
    timeline: order.timeline.map((t) => ({
      id: t.id.toString(),
      fromStatus: t.from_status,
      toStatus: t.to_status,
      action: t.action,
      operatorType: t.operator_type,
      operatorId: t.operator_id?.toString() ?? null,
      reason: t.reason,
      createdAt: t.created_at.toISOString(),
    })),
    verification: order.verifications[0]
      ? {
          id: order.verifications[0].id.toString(),
          type: order.verifications[0].type,
          status: order.verifications[0].status,
          faceScore: order.verifications[0].face_score,
          facePassed: order.verifications[0].face_passed,
          gpsDeviationM: order.verifications[0].gps_deviation_m,
          companionConfirmedAt: order.verifications[0].companion_confirmed_at?.toISOString() ?? null,
          elderConfirmedAt: order.verifications[0].elder_confirmed_at?.toISOString() ?? null,
        }
      : null,
    payment: order.payments[0]
      ? {
          paymentNo: order.payments[0].payment_no,
          status: order.payments[0].status,
          amountFen: order.payments[0].amount_fen.toString(),
          paidAt: order.payments[0].paid_at?.toISOString() ?? null,
          refundAmountFen: order.payments[0].refund_amount_fen.toString(),
          refundedAt: order.payments[0].refunded_at?.toISOString() ?? null,
        }
      : null,
    sharing: order.profit_sharing_records[0]
      ? {
          sharingNo: order.profit_sharing_records[0].sharing_no,
          status: order.profit_sharing_records[0].status,
          frozenAmountFen: order.profit_sharing_records[0].frozen_amount_fen.toString(),
          companionIncomeFen: order.profit_sharing_records[0].companion_income_fen.toString(),
          retryCount: order.profit_sharing_records[0].retry_count,
          createdAt: order.profit_sharing_records[0].created_at.toISOString(),
          sharedAt: order.profit_sharing_records[0].shared_at?.toISOString() ?? null,
        }
      : null,
  };
}

function brief(u: { id: bigint; nickname: string; avatar_url: string | null; role: string; status: string }) {
  return { id: u.id.toString(), nickname: u.nickname, avatarUrl: u.avatar_url, role: u.role, status: u.status };
}
