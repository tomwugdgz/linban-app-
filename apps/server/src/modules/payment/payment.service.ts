// ============================================================================
// 邻伴 · payment 模块 service：支付 / 待分账冻结 / 分账执行 / 回退 / 对账
// ----------------------------------------------------------------------------
// 资金链路（架构 §7，铁律：一切资金动作可审计）：
//   1. createPrepay       JSAPI 下单（款项进平台担保户，profit_sharing=true）；
//   2. handleWxNotify     回调验签 → 幂等推进 → orders=PAID → 冻结分账记录；
//   3. executeSharing     门闩（domain）→ 执行器（SPLIT_MODE）→ SHARED；
//      失败 retry_count 累加，≥3 升级人工工单（manual_ticket_no）；
//   4. refundOrder        取消/退款 → 已分账回退 / 未分账解冻 + 原路退；
//   5. runReconciliation  每日对账（03:00）：本地流水 vs 微信账单。
//
// 状态推进只用 updateMany 条件更新（乐观并发）；流水表只插不更新。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  QUEUE_NAMES,
  RECON_CRON_EXPR,
  SHARING_RETRY_MAX,
  SHARING_STALE_ALERT_DAYS,
  SHARING_WX_DEADLINE_DAYS,
  SYSTEM_CONFIG_DEFAULTS,
  defaultConfigInt,
} from '@linban/shared';
import type { profit_sharing_status, recon_channel, recon_status } from '@linban/shared';
import { prisma, withTransaction } from '../../infra/prisma';
import { getWxPayAdapter } from '../../adapters/wechat/pay';
import {
  getProfitSharingExecutor,
  defaultSplitMode,
} from '../../adapters/split-executor';
import type { SplitMode } from '@linban/shared';
import { assertSharingGate, computeCommission, resolveCommissionRateBp } from '../../domain';
import { assertTransition, triggersUnfreezeOrReturn } from '../../domain/order-state-machine';
import { genBizNo } from '../../common/ids';
import { enqueue } from '../../infra/queue';
import { moduleLogger } from '../../common/logger';
import { markOrderPaid } from '../order/order.service';

const log = moduleLogger('payment');

async function getConfigStr(key: string): Promise<string> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  return row?.config_value ?? SYSTEM_CONFIG_DEFAULTS[key]?.value ?? '';
}

/** system_configs 整型热值读取（DB 优先，种子默认值回落） */
async function getConfigInt(key: string): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  return row ? Number(row.config_value) : defaultConfigInt(key as keyof typeof SYSTEM_CONFIG_DEFAULTS);
}

/** 当前分账模式（system_configs.split_mode → 环境默认） */
export async function currentSplitMode(): Promise<SplitMode> {
  const v = await getConfigStr('split_mode');
  if (v === 'manual_settlement_fallback' || v === 'wechat_profit_sharing') return v;
  return defaultSplitMode();
}

// ---------------------------------------------------------------------------
// 1. 创建支付（JSAPI 下单）
// ---------------------------------------------------------------------------

export async function createPrepay(orderId: bigint, userId: bigint, openid: string, idempotencyKey: string) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.user_id !== userId && order.elder_user_id !== userId) throw new AppError(10004, '非订单相关方');
  if (order.status !== 'CREATED') throw new AppError(14012, `订单状态 ${order.status}，不可支付`);

  // 幂等：同 idempotency_key 返回原支付单
  const existing = await prisma.payments.findUnique({ where: { idempotency_key: idempotencyKey } });
  if (existing) {
    return { paymentNo: existing.payment_no, status: existing.status, outTradeNo: existing.wx_out_trade_no };
  }

  const wxPay = getWxPayAdapter();
  const outTradeNo = genBizNo('payment');
  const payment = await prisma.payments.create({
    data: {
      payment_no: genBizNo('payment'),
      order_id: orderId,
      user_id: userId,
      channel: 'WX_JSAPI',
      amount_fen: order.total_amount_fen,
      status: 'PENDING',
      profit_sharing: true, // 服务商分账标记（架构 §7.1）
      wx_out_trade_no: outTradeNo,
      idempotency_key: idempotencyKey,
    },
  });

  const prepay = await wxPay.jsapiPrepay({
    outTradeNo,
    amountFen: order.total_amount_fen,
    openid,
    description: `邻伴陪聊服务（${order.duration_minutes}分钟）`,
    notifyUrl: process.env.WXPAY_NOTIFY_URL ?? 'https://api.example.com/api/v1/payments/wx/notify',
    profitSharing: true,
  });
  await prisma.payments.update({
    where: { id: payment.id },
    data: { wx_prepay_id: prepay.prepayId },
  });
  return {
    paymentNo: payment.payment_no,
    status: 'PENDING',
    outTradeNo,
    prepayId: prepay.prepayId,
    timeStamp: prepay.timeStamp,
    nonceStr: prepay.nonceStr,
    package: prepay.package,
    signType: prepay.signType,
    paySign: prepay.paySign,
  };
}

// ---------------------------------------------------------------------------
// 2. 微信回调（支付成功）：验签 → 幂等推进 → PAID → 冻结分账记录
// ---------------------------------------------------------------------------

export async function handleWxPayNotify(rawBody: unknown, headers: Record<string, string>) {
  const wxPay = getWxPayAdapter();
  const notify = await wxPay.parseNotify(rawBody, headers);
  if (notify.type !== 'PAYMENT') throw new AppError(15004, '非支付回调');

  const payment = await prisma.payments.findUnique({ where: { wx_out_trade_no: notify.outTradeNo } });
  if (!payment) throw new AppError(15001, `支付单不存在: ${notify.outTradeNo}`);
  // 幂等：已 SUCCESS 直接 ack（架构 §5.2 回调幂等）
  if (payment.status === 'SUCCESS') return { duplicated: true };

  const order = await prisma.orders.findUnique({ where: { id: payment.order_id } });
  if (!order) throw new AppError(14001, '订单不存在');
  // 金额一致性校验（防篡改回调）
  if (payment.amount_fen !== notify.amountFen) {
    throw new AppError(14015, `回调金额 ${notify.amountFen} 与支付单 ${payment.amount_fen} 不一致`);
  }

  const result = await withTransaction(async (tx) => {
    // 1) 支付单 → SUCCESS
    const { count } = await tx.payments.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        wx_transaction_id: notify.transactionId,
        paid_at: notify.paidAt ?? new Date(),
      },
    });
    if (count === 0) return { duplicated: true };

    // 2) 订单 → PAID
    await tx.orders.updateMany({
      where: { id: order.id, status: 'CREATED' },
      data: { status: 'PAID' },
    });
    await tx.order_timeline.create({
      data: {
        order_id: order.id,
        from_status: 'CREATED',
        to_status: 'PAID',
        action: 'pay',
        operator_type: 'SYSTEM',
        reason: `微信支付回调 ${notify.transactionId}`,
      },
    });

    // 3) 冻结分账记录（FROZEN = 订单实收；抽成 bp 快照）
    const commissionRateBp = resolveCommissionRateBp(await getConfigStr('commission_rate'), order.total_amount_fen);
    const commission = computeCommission(order.total_amount_fen, commissionRateBp);
    await tx.profit_sharing_records.create({
      data: {
        sharing_no: genBizNo('sharing'),
        order_id: order.id,
        payment_id: payment.id,
        status: 'FROZEN',
        frozen_amount_fen: commission.orderAmountFen,
        platform_commission_fen: commission.platformCommissionFen,
        companion_income_fen: commission.companionIncomeFen,
        commission_rate_bp: commission.commissionRateBp,
        wx_transaction_id: notify.transactionId,
        idempotency_key: `sharing:${payment.id}`,
      },
    });
    return { duplicated: false };
  });

  // 4) 订单状态机侧同步（markOrderPaid 内部幂等）
  if (!result.duplicated) {
    await markOrderPaid(order.id, payment.payment_no);
    log.info({ event: 'pay-notify-processed', orderNo: order.order_no, transactionId: notify.transactionId });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. 分账执行（门闩 → 执行器 → SHARED；失败重试/升级工单）
// ---------------------------------------------------------------------------

/**
 * 执行分账（订单 COMPLETED 后由 profit-sharing 队列调用）。
 * 双保险：domain 门闩 + service 侧前置校验。
 */
export async function executeSharing(orderId: bigint, trigger: 'complete' | 'retry' | 'sweep' = 'complete') {
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: { companion: { include: { user: true } }, verifications: true },
  });
  if (!order) throw new AppError(14001, '订单不存在');

  const sharing = await prisma.profit_sharing_records.findFirst({
    where: { order_id: orderId, status: 'FROZEN' },
    orderBy: { id: 'asc' },
  });
  if (!sharing) throw new AppError(15005, '无 FROZEN 状态的分账记录');

  // 组装门闩输入（核销事实取 ARRIVAL 通过记录）
  const arrival = order.verifications.find((v) => v.type === 'ARRIVAL' && v.status === 'PASSED');
  const hasPendingRisk = await prisma.risk_events.count({
    where: { order_id: orderId, status: { in: ['PENDING', 'PROCESSING'] } },
  });

  // ---- domain 门闩（架构 §8.1）----
  assertSharingGate({
    orderStatus: order.status,
    verification: arrival
      ? { status: arrival.status, faceScore: arrival.face_score, gpsDeviationM: arrival.gps_deviation_m }
      : null,
    faceMatchThreshold: await getConfigInt('face_match_threshold'),
    gpsMaxDeviation: await getConfigInt('gps_max_deviation'),
    hasPendingRiskEvent: hasPendingRisk > 0,
    sharingStatus: sharing.status,
    retryCount: sharing.retry_count,
    maxRetry: SHARING_RETRY_MAX,
  });

  // ---- 执行器（SPLIT_MODE 开关）----
  const mode = await currentSplitMode();
  const executor = getProfitSharingExecutor(mode);
  const companionOpenid = order.companion?.user.openid ?? '';
  if (!companionOpenid) throw new AppError(13001, '陪聊员账号异常（缺 openid）');

  const result = await executor.execute({
    orderId,
    orderNo: order.order_no,
    sharingNo: sharing.sharing_no,
    wxTransactionId: sharing.wx_transaction_id,
    platformCommissionFen: sharing.platform_commission_fen,
    companionIncomeFen: sharing.companion_income_fen,
    companionOpenid,
    commissionRateBp: sharing.commission_rate_bp,
    spMchid: process.env.WXPAY_SP_MCHID,
  });

  // 兜底人工模式：登记工单，保持 FROZEN 等人工
  if (result.pendingHumanSettlement && result.manualTicketNo) {
    await prisma.profit_sharing_records.update({
      where: { id: sharing.id },
      data: { manual_ticket_no: result.manualTicketNo, last_error: result.errorMessage },
    });
    // TODO(notification)：告警 finance 群（待人工结算）
    log.warn({ event: 'sharing-pending-human', sharingNo: sharing.sharing_no, ticket: result.manualTicketNo });
    return { status: 'FROZEN' as profit_sharing_status, manualTicketNo: result.manualTicketNo };
  }

  if (!result.success) {
    // 失败：retry_count 累加；≥3 升级人工工单（记录保持 FROZEN）
    const retryCount = sharing.retry_count + 1;
    await prisma.profit_sharing_records.update({
      where: { id: sharing.id },
      data: {
        retry_count: retryCount,
        last_error: `${result.errorCode ?? ''} ${result.errorMessage ?? ''}`.slice(0, 512),
        ...(retryCount >= SHARING_RETRY_MAX
          ? { manual_ticket_no: genBizNo('sharing') }
          : {}),
      },
    });
    if (retryCount >= SHARING_RETRY_MAX) {
      // 升级人工工单 + 告警（BullMQ 不再静默重试）
      // TODO(notification)：P0 告警 finance + support 工单
      log.error({ event: 'sharing-retry-exhausted', sharingNo: sharing.sharing_no, orderNo: order.order_no });
      throw new AppError(15008, `分账重试已达上限（${retryCount}），已升级人工工单`);
    }
    // 指数退避重试
    await enqueue(QUEUE_NAMES.profitSharing, 'execute', {
      orderId: orderId.toString(),
      attempt: retryCount,
      trigger: 'retry',
    }, { delay: Math.min(2 ** retryCount * 60_000, 30 * 60_000) });
    throw new AppError(15009, result.errorMessage ?? '分账执行失败');
  }

  // 成功 → SHARED
  await prisma.profit_sharing_records.update({
    where: { id: sharing.id },
    data: {
      status: 'SHARED',
      wx_sharing_order_no: result.wxSharingOrderNo,
      shared_at: new Date(),
    },
  });
  log.info({ event: 'sharing-executed', sharingNo: sharing.sharing_no, wxSharingOrderNo: result.wxSharingOrderNo, trigger });
  return { status: 'SHARED' as profit_sharing_status, wxSharingOrderNo: result.wxSharingOrderNo };
}

// ---------------------------------------------------------------------------
// 4. 退款 / 分账回退（架构 §7.4 三场景）
// ---------------------------------------------------------------------------

/**
 * 订单退款（取消/售后退款）：
 *   未分账 → 微信「解除剩余待分账」+ 原路退；
 *   已分账 → 微信「分账回退」（回用户）+ 原路退差额部分；
 *   兜底模式 → 仅原路退（无微信侧待分账资金）。
 * 每次回退追加一条 RETURNED 记录（profit_sharing_records 1:N，可回放）。
 */
export async function refundOrder(orderId: bigint, refundAmountFen: bigint, reason: string, initiator?: string) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (refundAmountFen <= 0n || refundAmountFen > order.total_amount_fen - order.refund_amount_fen) {
    throw new AppError(15012, '退款金额超出可退额度');
  }

  const payment = await prisma.payments.findFirst({
    where: { order_id: orderId, status: 'SUCCESS' },
  });
  if (!payment) throw new AppError(15001, '无成功支付单，无可退款项');

  const wxPay = getWxPayAdapter();
  const mode = await currentSplitMode();
  const executor = getProfitSharingExecutor(mode);

  return withTransaction(async (tx) => {
    // 1) 分账侧处置：未分账 → 解冻；已分账 → 回退（追加 RETURNED 记录）
    const frozen = await tx.profit_sharing_records.findFirst({
      where: { order_id: orderId, status: 'FROZEN' },
    });
    let returnAmount = 0n;
    if (frozen) {
      if (mode === 'wechat_profit_sharing') {
        const unfreeze = await executor.unfreezeRemaining({
          orderId,
          sharingNo: frozen.sharing_no,
          wxTransactionId: frozen.wx_transaction_id,
        });
        if (!unfreeze.success) throw new AppError(15010, unfreeze.errorMessage ?? '解除待分账失败');
      }
      returnAmount = refundAmountFen;
      await tx.profit_sharing_records.update({
        where: { id: frozen.id },
        data: {
          status: 'RETURNED',
          return_amount_fen: refundAmountFen,
          returned_at: new Date(),
          return_reason: reason,
        },
      });
    } else {
      // 已 SHARED：回退需单独处理（MVP 少见：分账后退款）
      const shared = await tx.profit_sharing_records.findFirst({
        where: { order_id: orderId, status: 'SHARED' },
      });
      if (shared) {
        const r = await executor.returnSharing({
          orderId,
          orderNo: order.order_no,
          sharingNo: shared.sharing_no,
          outReturnNo: genBizNo('sharing'),
          returnAmountFen: refundAmountFen,
          reason,
        });
        if (!r.success) throw new AppError(15013, r.errorMessage ?? '分账回退失败');
        returnAmount = refundAmountFen;
        await tx.profit_sharing_records.create({
          data: {
            sharing_no: genBizNo('sharing'),
            order_id: orderId,
            payment_id: payment.id,
            status: 'RETURNED',
            frozen_amount_fen: refundAmountFen,
            platform_commission_fen: 0n,
            companion_income_fen: 0n,
            commission_rate_bp: shared.commission_rate_bp,
            wx_transaction_id: shared.wx_transaction_id,
            return_amount_fen: refundAmountFen,
            wx_return_no: r.wxReturnNo,
            returned_at: new Date(),
            return_reason: reason,
            idempotency_key: `sharing-return:${shared.id}:${Date.now()}`,
          },
        });
      }
    }

    // 2) 微信原路退款
    const refundRes = await wxPay.refund({
      outTradeNo: payment.wx_out_trade_no,
      outRefundNo: genBizNo('payment'),
      refundAmountFen,
      totalAmountFen: payment.amount_fen,
      reason,
      notifyUrl: process.env.WXPAY_REFUND_NOTIFY_URL ?? 'https://api.example.com/api/v1/payments/refund/wx/notify',
    });
    if (!refundRes.success) throw new AppError(15013, refundRes.errorMessage ?? '微信退款失败');

    // 3) 支付单退款记账 + 订单累计退款
    await tx.payments.update({
      where: { id: payment.id },
      data: {
        refund_amount_fen: { increment: refundAmountFen },
        refunded_at: refundRes.refundedAt ?? new Date(),
        wx_refund_id: refundRes.refundId,
        status: refundAmountFen + payment.refund_amount_fen >= payment.amount_fen ? 'REFUNDED' : payment.status,
      },
    });
    await tx.orders.update({
      where: { id: orderId },
      data: { refund_amount_fen: { increment: refundAmountFen } },
    });
    await tx.order_timeline.create({
      data: {
        order_id: orderId,
        from_status: order.status,
        to_status: order.status,
        action: 'refund',
        operator_type: initiator === 'COMPANION' ? 'COMPANION' : 'SYSTEM',
        reason,
        extra: { refundAmountFen: refundAmountFen.toString(), returnAmountFen: returnAmount.toString() },
      },
    });
    log.info({ event: 'order-refunded', orderNo: order.order_no, refundAmountFen: refundAmountFen.toString(), reason });
    return { refundAmountFen: refundAmountFen.toString(), wxRefundId: refundRes.refundId };
  });
}

/** 退款回调（微信 REFUND 通知）：幂等记账 */
export async function handleWxRefundNotify(rawBody: unknown, headers: Record<string, string>) {
  const wxPay = getWxPayAdapter();
  const notify = await wxPay.parseNotify(rawBody, headers);
  if (notify.type !== 'REFUND') throw new AppError(15004, '非退款回调');
  const payment = await prisma.payments.findUnique({ where: { wx_out_trade_no: notify.outTradeNo } });
  if (!payment) throw new AppError(15001, '支付单不存在');
  // 幂等：已 REFUNDED 直接 ack
  if (payment.status === 'REFUNDED') return { duplicated: true };
  await prisma.payments.updateMany({
    where: { id: payment.id, status: { not: 'REFUNDED' } },
    data: { status: 'REFUNDED', refunded_at: new Date(), wx_refund_id: notify.refundId ?? payment.wx_refund_id },
  });
  return { duplicated: false };
}

// ---------------------------------------------------------------------------
// 5. 待分账超时告警扫描（架构 §7.2：>7 天；微信侧 30 天强制）
// ---------------------------------------------------------------------------

export async function sweepStaleSharing(): Promise<{ alerted: number; critical: number }> {
  const alertBefore = new Date(Date.now() - SHARING_STALE_ALERT_DAYS * 86400_000);
  const criticalBefore = new Date(Date.now() - SHARING_WX_DEADLINE_DAYS * 86400_000);
  const [alerted, critical] = await Promise.all([
    prisma.profit_sharing_records.count({ where: { status: 'FROZEN', created_at: { lt: alertBefore } } }),
    prisma.profit_sharing_records.count({ where: { status: 'FROZEN', created_at: { lt: criticalBefore } } }),
  ]);
  if (alerted > 0) {
    // TODO(notification)：告警 finance（>7 天未分账）；critical → P0 + 强制处置
    log.error({ event: 'sharing-stale-alert', alerted, critical, thresholdDays: SHARING_STALE_ALERT_DAYS });
  }
  return { alerted, critical };
}

// ---------------------------------------------------------------------------
// 6. 每日对账（架构 §7.5：03:00 按渠道）
// ---------------------------------------------------------------------------

export async function runDailyReconciliation(batchDate: string, channel: recon_channel) {
  // 幂等：同 (batch_date, channel) 已有批次则跳过
  const existing = await prisma.reconciliation_records.findFirst({ where: { batch_date: new Date(batchDate), channel } });
  if (existing) return { batchNo: existing.batch_no, status: existing.status, duplicated: true };

  const wxPay = getWxPayAdapter();
  const dayStart = new Date(`${batchDate}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86400_000);

  // 本地聚合
  const [localAgg] = await prisma.$queryRaw<{ cnt: bigint; amt: bigint }[]>`
    SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_fen), 0) AS amt
    FROM payments
    WHERE status = 'SUCCESS' AND paid_at >= ${dayStart} AND paid_at < ${dayEnd}
  `.catch(() => [{ cnt: 0n, amt: 0n }]);
  const localCount = Number(localAgg?.cnt ?? 0);
  const localAmount = BigInt(localAgg?.amt ?? 0);

  // 微信账单（mock：空账单 → 零差异 MATCHED）
  const bill = await wxPay.downloadBill({ billDate: batchDate, channel });
  const wxCount = bill.lines.length;
  const wxAmount = bill.lines.reduce((a, l) => a + l.amountFen, 0n);

  const matchCount = Math.min(localCount, wxCount);
  const diffCount = Math.abs(localCount - wxCount);
  const diffAmount = localAmount > wxAmount ? localAmount - wxAmount : wxAmount - localAmount;
  const status: recon_status = diffCount === 0 && diffAmount === 0n ? 'MATCHED' : 'DIFF';

  const batch = await prisma.reconciliation_records.create({
    data: {
      batch_no: genBizNo('batch'),
      batch_date: dayStart,
      channel,
      local_count: localCount,
      local_amount_fen: localAmount,
      wx_count: wxCount,
      wx_amount_fen: wxAmount,
      match_count: matchCount,
      diff_count: diffCount,
      diff_amount_fen: diffAmount,
      status,
      diff_detail: status === 'DIFF' ? { localCount, wxCount, note: '差异明细待微信账单解析补全' } : undefined,
    },
  });
  if (status === 'DIFF') {
    // TODO(notification)：差异告警 finance（15019）
    log.error({ event: 'recon-diff', batchNo: batch.batch_no, channel, diffCount, diffAmount: diffAmount.toString() });
  }
  return { batchNo: batch.batch_no, status, diffCount, diffAmountFen: diffAmount.toString() };
}

/** 对账 cron 注册助手（每日 03:00 四渠道） */
export async function registerReconCron(): Promise<void> {
  for (const channel of ['WX_PAY', 'WX_SHARING', 'WX_REFUND', 'WX_WITHDRAW'] as const) {
    await enqueue(QUEUE_NAMES.reconciliation, 'daily-recon', { batchDate: '', channel }, {
      repeat: { pattern: RECON_CRON_EXPR },
      jobId: `daily-recon:${channel}`,
    });
  }
}

/** 待分账冻结查询（对账/风控复核用） */
export async function getFrozenSharing(orderId: bigint) {
  return prisma.profit_sharing_records.findMany({
    where: { order_id: orderId },
    orderBy: { id: 'asc' },
  });
}

export { assertTransition, triggersUnfreezeOrReturn };
