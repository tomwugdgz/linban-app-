// ============================================================================
// 邻伴 · marketing 模块：优惠券 / 孝心时长卡 / 分销佣金（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：可领券列表、领券、我的券、时长卡购买/绑定/余额查询。
// TODO：下单核销联动（order.createOrder 的 deduct 占位对接）；
//       过期作废 cron（coupon-expire 队列）；分销佣金结算（月结）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { pageSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { genBizNo, genUuid } from '../../common/ids';
import { encrypt, hmacIndex, isCryptoConfigured, normalizePhone } from '../../common/crypto';

export const marketingRouter = Router();

/** GET /marketing/coupons —— 可领券模板 */
marketingRouter.get('/coupons', authMiddleware, async (req, res, next) => {
  try {
    const { page, pageSize } = parseOrThrow(pageSchema, req.query);
    const [list, total] = await Promise.all([
      prisma.coupons.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.coupons.count({ where: { status: 'ACTIVE' } }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((c) => ({
          couponNo: c.coupon_no,
          name: c.name,
          type: c.type,
          value: c.value,
          minSpendFen: c.min_spend_fen.toString(),
          validDays: c.valid_days,
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /marketing/coupons/:couponNo/claim —— 领券 */
marketingRouter.post('/coupons/:couponNo/claim', authMiddleware, async (req, res, next) => {
  try {
    const coupon = await prisma.coupons.findUnique({ where: { coupon_no: req.params.couponNo! } });
    if (!coupon || coupon.status !== 'ACTIVE') throw new AppError(19204, '券模板不存在或已下架');
    // 幂等：同用户同模板一张 UNUSED
    const dup = await prisma.user_coupons.findFirst({
      where: { user_id: req.user!.userId, coupon_id: coupon.id, status: 'UNUSED' },
    });
    if (dup) throw new AppError(19206, '已领取过该券');
    const userCoupon = await prisma.user_coupons.create({
      data: {
        user_id: req.user!.userId,
        coupon_id: coupon.id,
        source: 'MANUAL',
        status: 'UNUSED',
        expired_at: new Date(Date.now() + coupon.valid_days * 86400_000),
      },
    });
    res.json({
      code: 0,
      data: { userCouponId: userCoupon.id.toString(), expiredAt: userCoupon.expired_at?.toISOString() ?? null },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /marketing/coupons/mine —— 我的券 */
marketingRouter.get('/coupons/mine', authMiddleware, async (req, res, next) => {
  try {
    const list = await prisma.user_coupons.findMany({
      where: { user_id: req.user!.userId },
      include: { coupon: true },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    res.json({
      code: 0,
      data: list.map((uc) => ({
        userCouponId: uc.id.toString(),
        couponId: uc.coupon_id.toString(),
        name: uc.coupon.name,
        type: uc.coupon.type,
        value: uc.coupon.value,
        minSpendFen: uc.coupon.min_spend_fen.toString(),
        status: uc.status,
        source: uc.source,
        expiredAt: uc.expired_at?.toISOString() ?? null,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /marketing/gift-cards —— 购买孝心时长卡（支付联动 TODO） */
marketingRouter.post('/gift-cards', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      faceAmountFen: z.string().regex(/^\d+$/),
      durationMinutes: z.number().int().min(60).max(600),
      recipientPhone: z.string().regex(/^1\d{10}$/).optional(),
      boundElderUserId: z.string().regex(/^\d+$/).optional(),
      message: z.string().max(200).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const card = await prisma.gift_cards.create({
      data: {
        card_no: genBizNo('card'),
        buyer_user_id: req.user!.userId,
        face_amount_fen: BigInt(input.faceAmountFen),
        duration_minutes: input.durationMinutes,
        balance_amount_fen: BigInt(input.faceAmountFen),
        balance_duration_minutes: input.durationMinutes,
        recipient_phone_hmac: input.recipientPhone ? hmacIndex(normalizePhone(input.recipientPhone), true) : null,
        bound_user_id: input.boundElderUserId ? BigInt(input.boundElderUserId) : null,
        message: input.message ?? null,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 365 * 86400_000),
      },
    });
    // TODO(payment)：时长卡支付单（与订单支付同链路）
    res.json({
      code: 0,
      data: { cardNo: card.card_no, faceAmountFen: card.face_amount_fen.toString(), durationMinutes: card.duration_minutes },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /marketing/gift-cards/mine —— 我的时长卡（购买/受赠/绑定视角） */
marketingRouter.get('/gift-cards/mine', authMiddleware, async (req, res, next) => {
  try {
    const list = await prisma.gift_cards.findMany({
      where: {
        OR: [
          { buyer_user_id: req.user!.userId },
          { recipient_user_id: req.user!.userId },
          { bound_user_id: req.user!.userId },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: list.map((c) => ({
        cardNo: c.card_no,
        faceAmountFen: c.face_amount_fen.toString(),
        durationMinutes: c.duration_minutes,
        balanceAmountFen: c.balance_amount_fen.toString(),
        balanceDurationMinutes: c.balance_duration_minutes,
        status: c.status,
        expiresAt: c.expires_at?.toISOString() ?? null,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /marketing/gift-cards/bind —— 受赠人凭手机号绑定（未注册也可先买后绑） */
marketingRouter.post('/gift-cards/bind', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ cardNo: z.string().min(4), phone: z.string().regex(/^1\d{10}$/) });
    const { cardNo, phone } = parseOrThrow(schema, req.body);
    const card = await prisma.gift_cards.findUnique({ where: { card_no: cardNo } });
    if (!card) throw new AppError(19201, '时长卡不存在');
    if (card.recipient_phone_hmac !== hmacIndex(normalizePhone(phone), true)) {
      throw new AppError(19201, '手机号与受赠信息不匹配');
    }
    if (card.status !== 'ACTIVE') throw new AppError(19203, `时长卡状态 ${card.status}`);
    await prisma.gift_cards.update({
      where: { id: card.id },
      data: { recipient_user_id: req.user!.userId, bound_at: new Date() },
    });
    res.json({ code: 0, data: { cardNo: card.card_no, bound: true }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

void encrypt;
void isCryptoConfigured;
void genUuid;
