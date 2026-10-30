// ============================================================================
// 邻伴 · risk 模块：风控事件 / 黑名单 / 举报 / 投诉 / SOS（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：飞单举报提交（属实奖励 user_coupons）、投诉提交、
//         后台风控工作台（事件队列/处置）。
// TODO：风控规则引擎（异地登录/频繁取消/IM 敏感词命中自动建事件）、
//       黑名单命中校验中间件、SOS 工单联动通知。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError, REPORT_REWARD_FEN } from '@linban/shared';
import type { risk_event_status, risk_level } from '@linban/shared';
import { Prisma } from '@prisma/client';
import { authMiddleware, adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { pageSchema, idSchema } from '../../common/validation';
import { prisma, withTransaction } from '../../infra/prisma';
import { genBizNo } from '../../common/ids';
import { moduleLogger } from '../../common/logger';
import { sendNotification } from '../notification/notification.routes';
import { sosSuspendable } from '../../domain/safety-suspend';
import { decrypt } from '../../common/crypto';
import { getSmsAdapter } from '../../adapters/sms';

const log = moduleLogger('risk');

export const riskRouter = Router();
export const riskAdminRouter = Router();

/** POST /risk/reports —— 飞单举报（机制 5：奖励 ¥20 券） */
riskRouter.post('/reports', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: idSchema,
      type: z.enum(['FLY_ORDER', 'OFF_PLATFORM_PAY', 'OTHER']),
      description: z.string().min(10).max(1000),
      evidenceFileIds: z.array(idSchema).max(9).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({
      where: { id: BigInt(input.orderId) },
      include: { companion: { select: { user_id: true } } },
    });
    if (!order) throw new AppError(14001, '订单不存在');
    // 架构 §8.2 价格保护举报：任一端可提交；但被服务的陪聊员不能举报自己的订单
    if (order.companion?.user_id === req.user!.userId) {
      throw new AppError(20006, '不能举报自己服务的订单');
    }
    // 去重：同订单同举报人一条 PENDING
    const dup = await prisma.reports.findFirst({
      where: { order_id: order.id, reporter_id: req.user!.userId, status: 'PENDING' },
    });
    if (dup) throw new AppError(20005, '举报已受理，请耐心等待核查');

    const report = await prisma.reports.create({
      data: {
        report_no: genBizNo('report'),
        order_id: order.id,
        reporter_id: req.user!.userId,
        reporter_role: req.user!.role === 'COMPANION' ? 'COMPANION' : 'USER',
        target_type: 'COMPANION',
        target_id: order.companion_id?.toString() ?? order.id.toString(),
        type: input.type,
        description: input.description,
        evidence_file_ids: input.evidenceFileIds ?? Prisma.DbNull,
        status: 'PENDING',
        reward_status: 'NONE',
      },
    });
    // TODO(risk worker)：自动取证比对（订单时间线 vs 核销记录 vs IM 记录）
    res.json({ code: 0, data: { reportNo: report.report_no, status: report.status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /risk/complaints —— 投诉（服务纠纷，客服处理） */
riskRouter.post('/complaints', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: idSchema,
      type: z.enum(['SERVICE_QUALITY', 'ATTITUDE', 'SAFETY', 'CHARGE', 'OTHER']),
      description: z.string().min(10).max(1000),
      evidenceFileIds: z.array(idSchema).max(9).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({ where: { id: BigInt(input.orderId) } });
    if (!order) throw new AppError(14001, '订单不存在');
    const complaint = await prisma.complaints.create({
      data: {
        complaint_no: genBizNo('complaint'),
        order_id: order.id,
        complainant_id: req.user!.userId,
        complainant_role: req.user!.role === 'COMPANION' ? 'COMPANION' : 'USER',
        target_type: 'ORDER',
        target_id: order.id.toString(),
        type: input.type,
        priority: 'NORMAL',
        description: input.description,
        evidence_file_ids: input.evidenceFileIds ?? Prisma.DbNull,
        status: 'PENDING',
      },
    });
    await sendNotification({
      targetUserId: req.user!.userId,
      channel: 'IM_SYSTEM',
      title: '投诉已受理',
      content: `您的投诉 ${complaint.complaint_no} 已受理，客服将尽快联系您`,
      bizType: 'COMPLAINT',
    }).catch(() => undefined);
    res.json({ code: 0, data: { complaintNo: complaint.complaint_no, status: complaint.status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /risk/complaints/mine —— 我的投诉 */
riskRouter.get('/complaints/mine', authMiddleware, async (req, res, next) => {
  try {
    const list = await prisma.complaints.findMany({
      where: { complainant_id: req.user!.userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: list.map((c) => ({
        complaintNo: c.complaint_no,
        type: c.type,
        priority: c.priority,
        status: c.status,
        resultNote: c.result_note,
        compensationAmountFen: c.compensation_amount_fen.toString(),
        createdAt: c.created_at.toISOString(),
        handledAt: c.handled_at?.toISOString() ?? null,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /risk/sos —— 一键 SOS（裁定③：任一端 SOS 立即挂起 + 客服工单 + 紧急联系人通知） */
riskRouter.post('/sos', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: idSchema,
      lat: z.number().optional(),
      lng: z.number().optional(),
      description: z.string().max(500).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({
      where: { id: BigInt(input.orderId) },
      include: {
        companion: { select: { id: true, user_id: true } },
        elder_user: { select: { id: true, elder_profile: { select: { emergency_contact_name_cipher: true, emergency_contact_phone_cipher: true } } } },
      },
    });
    if (!order) throw new AppError(14001, '订单不存在');

    // 1) CRITICAL 风控事件（优先工单）
    const event = await prisma.risk_events.create({
      data: {
        event_no: genBizNo('riskEvent'),
        type: 'SOS',
        level: 'CRITICAL',
        subject_type: 'ORDER',
        subject_id: order.id.toString(),
        order_id: order.id,
        rule_code: 'SOS_MANUAL',
        hit_detail: { lat: input.lat ?? null, lng: input.lng ?? null, description: input.description ?? null },
        status: 'PENDING',
      },
    });

    // 2) 到岗态立即挂起（与客服手动挂起/服务超时 sweep 共用裁决出口）
    let suspended = false;
    if (sosSuspendable(order.status)) {
      const { suspendOrderForSafety } = await import('../order/order.service');
      const triggerIsCompanion = order.companion?.user_id === req.user!.userId;
      await suspendOrderForSafety(
        { id: order.id, order_no: order.order_no, status: order.status },
        `SOS 紧急挂起：${input.description ?? '一键求助'}`,
        { type: triggerIsCompanion ? 'COMPANION' : 'USER', id: req.user!.userId },
        'sos_suspend',
      );
      suspended = true;
    }

    // 3) 客服工单（复用 complaints，零 schema 变更；URGENT 优先）
    const complaint = await prisma.complaints.create({
      data: {
        complaint_no: genBizNo('complaint'),
        order_id: order.id,
        complainant_id: req.user!.userId,
        complainant_role: order.companion?.user_id === req.user!.userId ? 'COMPANION' : 'USER',
        target_type: 'ORDER',
        target_id: order.id.toString(),
        type: 'SAFETY',
        priority: 'URGENT',
        description: `SOS 求助：${input.description ?? '一键求助'}（订单 ${order.order_no}）`,
        status: 'PENDING',
      },
    });

    // 4) 紧急联系人通知：模板短信直达 + 绑定子女 IM 系统消息（失败不阻断 SOS 响应）
    const notifies: Promise<unknown>[] = [];
    const emergencyPhone = safeDecryptPhone(order.elder_user?.elder_profile?.emergency_contact_phone_cipher ?? null);
    if (emergencyPhone) {
      notifies.push(
        getSmsAdapter()
          .sendNotice(emergencyPhone, process.env.SMS_SOS_TEMPLATE_ID ?? 'SOS_ALERT', [order.order_no])
          .then(() => undefined)
          .catch(() => undefined),
      );
    }
    const bindings = await prisma.family_bindings.findMany({
      where: { elder_user_id: order.elder_user_id, status: 'ACTIVE', active_key: 'A' },
      select: { family_user_id: true },
    });
    for (const b of bindings) {
      notifies.push(
        sendNotification({
          targetUserId: b.family_user_id,
          channel: 'IM_SYSTEM',
          title: '紧急通知：老人订单触发 SOS',
          content: `老人订单 ${order.order_no} 触发紧急求助，平台值守已介入，请尽快联系老人`,
          bizType: 'SOS',
        }).catch(() => undefined),
      );
    }
    // 老人本人侧确认（IM 系统消息）
    notifies.push(
      sendNotification({
        targetUserId: order.elder_user_id,
        channel: 'IM_SYSTEM',
        title: 'SOS 已触发',
        content: '紧急求助已通知平台值守，请保持电话畅通',
        bizType: 'SOS',
      }).catch(() => undefined),
    );
    await Promise.all(notifies);

    // TODO(risk worker)：短信+电话告警值守客服（P0）
    log.error({ event: 'sos-triggered', eventNo: event.event_no, orderNo: order.order_no, suspended, complaintNo: complaint.complaint_no });
    res.json({
      code: 0,
      data: { eventNo: event.event_no, level: event.level, suspended, complaintNo: complaint.complaint_no },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** 解密紧急联系人电话（L3 密文；开发期 PLAIN_DEV 前缀直读；失败返回 null 不阻断） */
function safeDecryptPhone(cipher: string | null): string | null {
  if (!cipher) return null;
  if (cipher.startsWith('PLAIN_DEV:')) return cipher.slice('PLAIN_DEV:'.length);
  try {
    return decrypt(cipher);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 后台风控工作台
// ---------------------------------------------------------------------------

/** GET /admin/risk/events —— 风控事件队列（高等级优先） */
riskAdminRouter.get('/risk/events', adminAuthMiddleware, adminPermGuard('risk:*'), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.string().optional(), level: z.string().optional(), page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(20) });
    const { status, level, page, pageSize } = parseOrThrow(schema, req.query);
    const where: Prisma.risk_eventsWhereInput = {
      ...(status ? { status: status as risk_event_status } : {}),
      ...(level ? { level: level as risk_level } : {}),
    };
    const [list, total] = await Promise.all([
      prisma.risk_events.findMany({
        where,
        orderBy: [{ level: 'desc' }, { created_at: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.risk_events.count({ where }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((e) => ({
          eventNo: e.event_no,
          type: e.type,
          level: e.level,
          subjectType: e.subject_type,
          subjectId: e.subject_id,
          orderId: e.order_id?.toString() ?? null,
          ruleCode: e.rule_code,
          status: e.status,
          actionTaken: e.action_taken,
          createdAt: e.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/risk/events/:eventNo/handle —— 处置风控事件 */
riskAdminRouter.post('/risk/events/:eventNo/handle', adminAuthMiddleware, adminPermGuard('risk:*'), async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['PROCESSING', 'RESOLVED', 'FALSE_POSITIVE']),
      actionTaken: z.string().max(256).optional(),
    });
    const { status, actionTaken } = parseOrThrow(schema, req.body);
    const event = await prisma.risk_events.findUnique({ where: { event_no: req.params.eventNo! } });
    if (!event) throw new AppError(20003, '风控事件不存在');
    await prisma.risk_events.update({
      where: { id: event.id },
      data: { status, action_taken: actionTaken ?? null, handler_id: req.admin!.adminId, handled_at: new Date() },
    });
    res.json({ code: 0, data: { eventNo: event.event_no, status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/risk/reports/:reportNo/handle —— 举报核查（属实 → 奖励券 + 飞单罚则） */
riskAdminRouter.post('/reports/:reportNo/handle', adminAuthMiddleware, adminPermGuard('report:*'), async (req, res, next) => {
  try {
    const schema = z.object({ substantiated: z.boolean(), note: z.string().max(256).optional() });
    const { substantiated, note } = parseOrThrow(schema, req.body);
    const report = await prisma.reports.findUnique({ where: { report_no: req.params.reportNo! }, include: { order: { include: { companion: true } } } });
    if (!report) throw new AppError(20004, '举报不存在');
    if (report.status !== 'PENDING') throw new AppError(20005, '举报已处理');

    // 奖励券模板（seed 保证存在；缺失时按平台规则兜底创建，金额取 REPORT_REWARD_FEN）
    const rewardCoupon = await prisma.coupons.upsert({
      where: { coupon_no: 'COUPON_REPORT_REWARD' },
      create: {
        coupon_no: 'COUPON_REPORT_REWARD',
        name: '飞单举报奖励券',
        type: 'FULL_REDUCTION',
        value: REPORT_REWARD_FEN,
        min_spend_fen: 0n,
        valid_days: 90,
        status: 'ACTIVE',
        created_by: req.admin!.adminId,
      },
      update: {},
    });

    await withTransaction(async (tx) => {
      let rewardUserCouponId: bigint | null = null;
      if (substantiated) {
        // 1) 举报人奖励券（source=REPORT_REWARD）
        const userCoupon = await tx.user_coupons.create({
          data: {
            user_id: report.reporter_id,
            coupon_id: rewardCoupon.id,
            source: 'REPORT_REWARD',
            status: 'UNUSED',
            expired_at: new Date(Date.now() + 90 * 86400_000),
          },
        });
        rewardUserCouponId = userCoupon.id;
      }
      await tx.reports.update({
        where: { id: report.id },
        data: {
          status: substantiated ? 'SUBSTANTIATED' : 'UNFOUNDED',
          reward_status: substantiated ? 'PENDING' : 'NONE',
          reward_amount_fen: substantiated ? BigInt(REPORT_REWARD_FEN) : 0n,
          reward_user_coupon_id: rewardUserCouponId,
          handler_id: req.admin!.adminId,
          handled_at: new Date(),
          handle_note: note ?? null,
        },
      });
      if (substantiated) {
        // 2) 飞单坐实：陪聊员 −20 分并清退（companion.applyCredit，architecture §8.3）
        if (report.order?.companion_id) {
          const { applyCredit } = await import('../companion/companion.service');
          await applyCredit(report.order.companion_id, 'FLY_ORDER', {
            reason: `飞单举报属实（${report.report_no}）`,
            relatedOrderId: report.order_id ?? undefined,
          }).catch(() => undefined);
        }
      }
    });
    res.json({ code: 0, data: { reportNo: report.report_no, substantiated }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});
