// ============================================================================
// 邻伴 · review 模块：双向评价（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：评价提交（每单每方向一条，UK 兜底）、我的评价列表、回复。
// 联动：好评 +1 / 差评 −3（companion.applyCredit，架构 §8.3）。
// TODO：评价审核工作台（后台）、敏感词过滤（微信内容安全）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { Prisma } from '@prisma/client';
import { authMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { pageSchema, idSchema } from '../../common/validation';
import { prisma, withTransaction } from '../../infra/prisma';
import { applyCredit } from '../companion/companion.service';

export const reviewRouter = Router();

/** POST /reviews —— 提交评价（COMPLETED 后 7 天内） */
reviewRouter.post('/', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: idSchema,
      rating: z.number().int().min(1).max(5),
      tags: z.array(z.string().max(8)).max(6).optional(),
      content: z.string().max(500).optional(),
      isAnonymous: z.boolean().default(false),
    });
    const input = parseOrThrow(schema, req.body);
    const order = await prisma.orders.findUnique({
      where: { id: BigInt(input.orderId) },
      include: { companion: true },
    });
    if (!order) throw new AppError(14001, '订单不存在');

    const isCompanion = order.companion?.user_id === req.user!.userId;
    const isUserSide = order.user_id === req.user!.userId || order.elder_user_id === req.user!.userId;
    if (!isCompanion && !isUserSide) throw new AppError(10004, '非订单相关方');
    if (order.status !== 'COMPLETED' && order.status !== 'CLOSED') {
      throw new AppError(19003, '订单完成后才可评价');
    }
    // 评价窗口：完成后 7 天
    if (order.completed_at && Date.now() - order.completed_at.getTime() > 7 * 86400_000) {
      throw new AppError(19003, '评价窗口已关闭（完成后 7 天）');
    }

    const reviewerRole = isCompanion ? 'COMPANION' : 'USER';
    const revieweeId = isCompanion ? order.elder_user_id : order.companion?.user_id;
    if (!revieweeId) throw new AppError(14001, '订单未接单，不可评价');

    const result = await withTransaction(async (tx) => {
      // 每单每方向一条（UK: order_id + reviewer_role）
      const dup = await tx.reviews.findFirst({ where: { order_id: order.id, reviewer_role: reviewerRole } });
      if (dup) throw new AppError(19001, '本单该方向已评价');
      const review = await tx.reviews.create({
        data: {
          order_id: order.id,
          reviewer_id: req.user!.userId,
          reviewee_id: revieweeId,
          reviewer_role: reviewerRole,
          rating: input.rating,
          tags: input.tags ?? Prisma.DbNull,
          content: input.content ?? null,
          status: 'APPROVED', // TODO: 敏感词过滤后置 PENDING
          is_anonymous: input.isAnonymous,
        },
      });
      // 陪聊员收到评价 → 信用分（好评 +1 / 差评 −3）
      if (reviewerRole === 'USER' && order.companion_id) {
        await applyCredit(order.companion_id, input.rating >= 4 ? 'GOOD_REVIEW' : 'BAD_REVIEW', {
          reason: `订单 ${order.order_no} 评价 ${input.rating} 星`,
          relatedOrderId: order.id,
        }).catch(() => undefined); // 信用分越界不阻塞评价提交
        // 评分聚合（增量窗口）
        const agg = await tx.reviews.aggregate({
          where: { reviewee_id: order.companion!.user_id, reviewer_role: 'USER', status: 'APPROVED' },
          _avg: { rating: true },
          _count: { _all: true },
        });
        await tx.companions.update({
          where: { id: order.companion_id },
          data: { rating_avg: agg._avg.rating ?? 0, rating_count: agg._count._all },
        });
      }
      return review;
    });

    res.json({
      code: 0,
      data: { id: result.id.toString(), rating: result.rating, status: result.status },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /reviews/mine —— 我发出的评价 */
reviewRouter.get('/mine', authMiddleware, async (req, res, next) => {
  try {
    const list = await prisma.reviews.findMany({
      where: { reviewer_id: req.user!.userId },
      include: { order: { select: { order_no: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: list.map((r) => ({
        id: r.id.toString(),
        orderNo: r.order.order_no,
        reviewerRole: r.reviewer_role,
        rating: r.rating,
        tags: r.tags,
        content: r.content,
        status: r.status,
        replyContent: r.reply_content,
        createdAt: r.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /reviews/companion/:companionId —— 陪聊员收到的评价（老人端详情页） */
reviewRouter.get('/companion/:companionId', authMiddleware, async (req, res, next) => {
  try {
    const { page, pageSize } = parseOrThrow(pageSchema, req.query);
    const companion = await prisma.companions.findUnique({ where: { id: BigInt(req.params.companionId!) } });
    if (!companion) throw new AppError(13001, '陪聊员不存在');
    const [list, total] = await Promise.all([
      prisma.reviews.findMany({
        where: { reviewee_id: companion.user_id, reviewer_role: 'USER', status: 'APPROVED' },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.reviews.count({ where: { reviewee_id: companion.user_id, reviewer_role: 'USER', status: 'APPROVED' } }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((r) => ({
          id: r.id.toString(),
          rating: r.rating,
          tags: r.tags,
          content: r.is_anonymous ? null : r.content, // 匿名评价隐藏内容
          replyContent: r.reply_content,
          createdAt: r.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /reviews/:id/reply —— 被评价方回复 */
reviewRouter.post('/:id/reply', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ content: z.string().min(2).max(500) });
    const { content } = parseOrThrow(schema, req.body);
    const review = await prisma.reviews.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!review) throw new AppError(19002, '评价不存在');
    if (review.reviewee_id !== req.user!.userId) throw new AppError(10004, '仅被评价方可回复');
    if (review.replied_at) throw new AppError(19001, '已回复过');
    await prisma.reviews.update({
      where: { id: review.id },
      data: { reply_content: content, replied_at: new Date() },
    });
    res.json({ code: 0, data: { replied: true }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});
