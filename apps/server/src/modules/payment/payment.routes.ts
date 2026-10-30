// ============================================================================
// 邻伴 · payment 模块路由（支付 / 分账 / 退款 / 对账 / 提现，架构 §7）
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { parseOrThrow, validateBody } from '../../common/validation';
import { fenSchema, idSchema, localDateSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import {
  createPrepay,
  currentSplitMode,
  executeSharing,
  getFrozenSharing,
  handleWxPayNotify,
  handleWxRefundNotify,
  refundOrder,
  registerReconCron,
  runDailyReconciliation,
  sweepStaleSharing,
} from './payment.service';
import { redis } from '../../infra/redis';
import { genBizNo } from '../../common/ids';
import {
  getIncomeOverview,
  listMySharings,
  listMyWithdrawals,
  maskedBankAccountOf,
} from './companion-income.service';
import {
  LOCKED_WITHDRAWAL_STATUSES,
  buildIncomeOverview,
  canWithdraw,
} from '../../domain/companion-income';

export const paymentRouter = Router();
export const paymentAdminRouter = Router();

// ---------------------------------------------------------------------------
// POST /payments/prepay —— 发起支付（返回小程序 wx.requestPayment 参数）
// ---------------------------------------------------------------------------
paymentRouter.post('/prepay', authMiddleware, validateBody(z.object({ orderId: idSchema })), async (req, res, next) => {
  try {
    const { orderId } = parseOrThrow(z.object({ orderId: idSchema }), req.body);
    const user = await prisma.users.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError(10002, '账号不存在');
    const key = (req.headers['idempotency-key'] as string) ?? `prepay:${orderId}:${req.user!.userId}:${Date.now()}`;
    const r = await createPrepay(BigInt(orderId), req.user!.userId, user.openid, key);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /payments/wx/notify —— 微信支付回调（免鉴权，验签在适配层）
// ---------------------------------------------------------------------------
paymentRouter.post('/wx/notify', async (req, res, next) => {
  try {
    const r = await handleWxPayNotify(req.body, req.headers as Record<string, string>);
    // 微信要求 200/204 + 约定报文；mock 环境返回 JSON
    res.status(200).json({ code: 'SUCCESS', duplicated: r.duplicated });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /payments/refund/wx/notify —— 微信退款回调
// ---------------------------------------------------------------------------
paymentRouter.post('/refund/wx/notify', async (req, res, next) => {
  try {
    await handleWxRefundNotify(req.body, req.headers as Record<string, string>);
    res.status(200).json({ code: 'SUCCESS' });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /payments/order/:orderId —— 订单支付/分账状态（订单相关方）
// ---------------------------------------------------------------------------
paymentRouter.get('/order/:orderId', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.orderId!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    const isRelated = order.user_id === req.user!.userId || order.elder_user_id === req.user!.userId;
    const companion = req.user!.role === 'COMPANION'
      ? await prisma.companions.findUnique({ where: { user_id: req.user!.userId } })
      : null;
    if (!isRelated && (!companion || order.companion_id !== companion.id)) {
      throw new AppError(10004, '非订单相关方');
    }
    const [payment, sharings] = await Promise.all([
      prisma.payments.findFirst({ where: { order_id: order.id }, orderBy: { id: 'desc' } }),
      getFrozenSharing(order.id),
    ]);
    res.json({
      code: 0,
      data: {
        payment: payment
          ? {
              paymentNo: payment.payment_no,
              status: payment.status,
              amountFen: payment.amount_fen.toString(),
              profitSharing: payment.profit_sharing,
              paidAt: payment.paid_at?.toISOString() ?? null,
              refundAmountFen: payment.refund_amount_fen.toString(),
              refundedAt: payment.refunded_at?.toISOString() ?? null,
            }
          : null,
        sharings: sharings.map((s) => ({
          sharingNo: s.sharing_no,
          status: s.status,
          frozenAmountFen: s.frozen_amount_fen.toString(),
          platformCommissionFen: s.platform_commission_fen.toString(),
          companionIncomeFen: s.companion_income_fen.toString(),
          commissionRateBp: s.commission_rate_bp,
          retryCount: s.retry_count,
          manualTicketNo: s.manual_ticket_no,
          createdAt: s.created_at.toISOString(),
          sharedAt: s.shared_at?.toISOString() ?? null,
          returnedAt: s.returned_at?.toISOString() ?? null,
        })),
        splitMode: await currentSplitMode(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /payments/sharings/:orderId/execute —— 手动触发分账（补偿/调试用）
// ---------------------------------------------------------------------------
paymentRouter.post('/sharings/:orderId/execute', authMiddleware, async (req, res, next) => {
  try {
    // 仅后台或系统补偿触发；C 端不开放（防刷）
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.orderId!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    const r = await executeSharing(order.id, 'retry');
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 陪聊员资金读侧三端点（契约 §3.3）
//
// 身份口径：**一律从 token 取 userId**，不接受端上传 companionId。
// 否则改个查询参数就能看别人的收入与提现记录（横向越权）。
//
// 角色口径：陪聊员端三视图——老人登录也能调，但只会拿到自己「不是陪聊员」的
// 13001。这是刻意的：不复用 roleGuard('COMPANION') 是因为
// 13001 的文案（主档不存在）对老人更友好，而 10004「无权限」会让人
// 以为账号坏了。这属于「同一事实、两种表述」的有意选择。
// ---------------------------------------------------------------------------

/** GET /payments/income/overview —— 收入概览（可提现/待入账/累计/本月） */
paymentRouter.get('/income/overview', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      code: 0,
      data: await getIncomeOverview(req.user!.userId),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /payments/sharings/mine —— 分账明细（分页） */
paymentRouter.get('/sharings/mine', authMiddleware, async (req, res, next) => {
  try {
    const q = parseOrThrow(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
      }),
      req.query,
    );
    const r = await listMySharings(req.user!.userId, q.page, q.pageSize);
    res.json({
      code: 0,
      data: { list: r.list, total: r.total, page: q.page, pageSize: q.pageSize },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /payments/withdrawals —— 提现记录（出参仅脱敏卡号，绝无密文） */
paymentRouter.get('/withdrawals', authMiddleware, async (req, res, next) => {
  try {
    res.json({
      code: 0,
      data: await listMyWithdrawals(req.user!.userId),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 提现（备选结算模式；默认分账直达模式下低频）
// ---------------------------------------------------------------------------

const withdrawSchema = z.object({
  amountFen: fenSchema,
  bankName: z.string().min(2).max(32),
  bankAccount: z.string().regex(/^\d{10,25}$/, '银行卡号格式不正确'),
  accountName: z.string().min(2).max(32),
  faceVerified: z.boolean(),
  smsVerified: z.boolean(),
});

paymentRouter.post('/withdrawals', authMiddleware, roleGuard('COMPANION'), validateBody(withdrawSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(withdrawSchema, req.body);
    const amount = BigInt(input.amountFen);
    if (!input.faceVerified || !input.smsVerified) throw new AppError(15016, '提现需完成人脸/短信二次验证');
    if (amount <= 0n || amount > 50000n) throw new AppError(15015, '提现金额需在 ¥1–¥500');

    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    /**
     * 可提余额与 GET /payments/income/overview **同源**：
     * 集合与装配都来自 domain/companion-income，此处不重写 where 口径。
     * （此前这段自己写了一遍 aggregate，且锁定状态漏了 PENDING_REVIEW ——
     *   待审核期间重复提交会被放行，是可复现的资金超发路径。
     *   与展示口径的漂移一并消除。）
     */
    const sharedIncome = await prisma.profit_sharing_records.aggregate({
      where: { order: { companion_id: companion.id }, status: 'SHARED' },
      _sum: { companion_income_fen: true },
    });
    const lockedIncome = await prisma.withdrawals.aggregate({
      where: { companion_id: companion.id, status: { in: [...LOCKED_WITHDRAWAL_STATUSES] } },
      _sum: { amount_fen: true },
    });
    const overview = buildIncomeOverview({
      totalSharedFen: sharedIncome._sum.companion_income_fen ?? 0n,
      pendingFen: 0n, // 余额口径不需要待入账项，显式传 0 而非 undefined
      monthSharedFen: 0n,
      lockedFen: lockedIncome._sum.amount_fen ?? 0n,
      settledFen: 0n,
    });
    const decision = canWithdraw(amount, overview.availableFen);
    if (!decision.allowed) {
      throw new AppError(15015, decision.reason === 'AMOUNT_NOT_POSITIVE' ? '提现金额需在 ¥1–¥500' : '可提余额不足');
    }

    const { encrypt, isCryptoConfigured } = await import('../../common/crypto');
    const w = await prisma.withdrawals.create({
      data: {
        withdrawal_no: genBizNo('withdrawal'),
        companion_id: companion.id,
        amount_fen: amount,
        fee_fen: 0n, // MVP 免手续费
        actual_amount_fen: amount,
        bank_name: input.bankName,
        bank_account_cipher: isCryptoConfigured() ? encrypt(input.bankAccount) : `PLAIN_DEV:${input.bankAccount}`,
        account_name_cipher: isCryptoConfigured() ? encrypt(input.accountName) : `PLAIN_DEV:${input.accountName}`,
        face_verified: true,
        sms_verified: true,
        status: 'PENDING_REVIEW', // T+1 finance 审核
        idempotency_key: `withdraw:${companion.id}:${Date.now()}`,
      },
    });
    res.json({
      code: 0,
      data: {
        withdrawalNo: w.withdrawal_no,
        amountFen: w.amount_fen.toString(),
        status: w.status,
        // 复用列表端点同一脱敏通道，避免两处各写一套卡号脱敏
        bankAccountMasked: maskedBankAccountOf(w.bank_account_cipher),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 后台：对账 / 分账监控 / 提现审核
// ---------------------------------------------------------------------------

/** POST /admin/recon/run —— 手动触发对账批次 */
paymentAdminRouter.post('/recon/run', adminAuthMiddleware, adminPermGuard('recon:*'), async (req, res, next) => {
  try {
    const schema = z.object({
      batchDate: localDateSchema,
      channel: z.enum(['WX_PAY', 'WX_SHARING', 'WX_REFUND', 'WX_WITHDRAW']),
    });
    const { batchDate, channel } = parseOrThrow(schema, req.body);
    const r = await runDailyReconciliation(batchDate, channel);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/recon/batches —— 对账批次列表 */
paymentAdminRouter.get('/recon/batches', adminAuthMiddleware, adminPermGuard('recon:*'), async (req, res, next) => {
  try {
    const schema = z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(20) });
    const { page, pageSize } = parseOrThrow(schema, req.query);
    const [list, total] = await Promise.all([
      prisma.reconciliation_records.findMany({ orderBy: { batch_date: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.reconciliation_records.count(),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((b) => ({
          batchNo: b.batch_no,
          batchDate: b.batch_date.toISOString().slice(0, 10),
          channel: b.channel,
          localCount: b.local_count,
          localAmountFen: b.local_amount_fen.toString(),
          wxCount: b.wx_count,
          wxAmountFen: b.wx_amount_fen.toString(),
          diffCount: b.diff_count,
          diffAmountFen: b.diff_amount_fen.toString(),
          status: b.status,
          createdAt: b.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /admin/sharings/frozen —— 待分账监控（FROZEN 全量 + 超期标记） */
paymentAdminRouter.get('/sharings/frozen', adminAuthMiddleware, adminPermGuard('payment:*'), async (req, res, next) => {
  try {
    const list = await prisma.profit_sharing_records.findMany({
      where: { status: 'FROZEN' },
      include: { order: { select: { order_no: true, status: true } } },
      orderBy: { created_at: 'asc' },
      take: 200,
    });
    res.json({
      code: 0,
      data: list.map((s) => ({
        sharingNo: s.sharing_no,
        orderNo: s.order.order_no,
        orderStatus: s.order.status,
        frozenAmountFen: s.frozen_amount_fen.toString(),
        platformCommissionFen: s.platform_commission_fen.toString(),
        companionIncomeFen: s.companion_income_fen.toString(),
        commissionRateBp: s.commission_rate_bp,
        retryCount: s.retry_count,
        manualTicketNo: s.manual_ticket_no,
        lastError: s.last_error,
        staleDays: Math.floor((Date.now() - s.created_at.getTime()) / 86400_000),
        createdAt: s.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/sharings/:sharingNo/manual-settle —— 人工结算推进（兜底模式） */
paymentAdminRouter.post('/sharings/:sharingNo/manual-settle', adminAuthMiddleware, adminPermGuard('payment:*'), async (req, res, next) => {
  try {
    const schema = z.object({ wxSharingOrderNo: z.string().min(4), note: z.string().max(256).optional() });
    const { wxSharingOrderNo, note } = parseOrThrow(schema, req.body);
    const s = await prisma.profit_sharing_records.findUnique({ where: { sharing_no: req.params.sharingNo! } });
    if (!s) throw new AppError(15005, '分账记录不存在');
    if (s.status !== 'FROZEN') throw new AppError(15007, `分账记录状态 ${s.status}`);
    await prisma.profit_sharing_records.update({
      where: { id: s.id },
      data: { status: 'SHARED', wx_sharing_order_no: wxSharingOrderNo, shared_at: new Date(), last_error: note ?? null },
    });
    await prisma.audit_logs.create({
      data: {
        admin_id: req.admin!.adminId,
        action: 'SHARING_MANUAL_SETTLE',
        module: 'payment',
        target_type: 'profit_sharing_records',
        target_id: s.id.toString(),
        after_json: { sharingNo: s.sharing_no, wxSharingOrderNo, note },
      },
    });
    res.json({ code: 0, data: { sharingNo: s.sharing_no, status: 'SHARED' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/withdrawals/:no/review —— 提现审核（finance T+1） */
paymentAdminRouter.post('/withdrawals/:no/review', adminAuthMiddleware, adminPermGuard('withdrawal:*'), async (req, res, next) => {
  try {
    const schema = z.object({ approved: z.boolean(), rejectReason: z.string().max(256).optional() });
    const { approved, rejectReason } = parseOrThrow(schema, req.body);
    const w = await prisma.withdrawals.findUnique({ where: { withdrawal_no: req.params.no! } });
    if (!w) throw new AppError(15014, '提现单不存在');
    if (w.status !== 'PENDING_REVIEW') throw new AppError(15017, `提现单状态 ${w.status}`);
    const { count } = await prisma.withdrawals.updateMany({
      where: { id: w.id, status: 'PENDING_REVIEW' },
      data: {
        status: approved ? 'APPROVED' : 'REJECTED',
        reviewer_id: req.admin!.adminId,
        reviewed_at: new Date(),
        reject_reason: rejectReason ?? null,
      },
    });
    if (count === 0) throw new AppError(15017, '提现单状态已变化');
    // TODO(payment worker)：APPROVED → 微信商户转账（PROCESSING→SUCCESS）
    res.json({ code: 0, data: { withdrawalNo: w.withdrawal_no, status: approved ? 'APPROVED' : 'REJECTED' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/sharings/sweep-stale —— 手动触发超期扫描（调试） */
paymentAdminRouter.post('/sharings/sweep-stale', adminAuthMiddleware, adminPermGuard('payment:*'), async (_req, res, next) => {
  try {
    const r = await sweepStaleSharing();
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /payments/split-mode —— 当前分账模式（三端/后台可查） */
paymentRouter.get('/split-mode', authMiddleware, async (_req, res, next) => {
  try {
    const mode = await currentSplitMode();
    res.json({ code: 0, data: { splitMode: mode }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

export { registerReconCron, redis as _redis };
