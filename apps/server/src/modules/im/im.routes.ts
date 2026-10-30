// ============================================================================
// 邻伴 · im 模块：订单会话 / 消息 / 隐私号（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：会话自动建立（接单时）、消息发送（端上幂等）、历史游标分页、
//         隐私号绑定查询。
// TODO：内容安全送检（微信 msgSecCheck）接 content-review 队列；
//       历史归档热/冷表 UNION 查询（DATABASE.md §7.2）；
//       WebSocket 长连接（MVP 走轮询 + 订阅消息提醒）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { cursorSchema } from '../../common/validation';
import { prisma, withTransaction } from '../../infra/prisma';
import { getPrivacyNumberAdapter } from '../../adapters/privacy-number';
import { genUuid } from '../../common/ids';

export const imRouter = Router();

/** POST /im/conversations/order/:orderId —— 确保订单会话存在（接单时自动建；幂等） */
imRouter.post('/conversations/order/:orderId', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({
      where: { id: BigInt(req.params.orderId!) },
      include: { companion: true },
    });
    if (!order || !order.companion) throw new AppError(14001, '订单不存在或未接单');
    const isUser = order.user_id === req.user!.userId || order.elder_user_id === req.user!.userId;
    const isCompanion = order.companion.user_id === req.user!.userId;
    if (!isUser && !isCompanion) throw new AppError(10004, '非订单相关方');

    const existing = await prisma.im_conversations.findUnique({ where: { order_id: order.id } });
    if (existing) {
      return res.json({ code: 0, data: { conversationId: existing.id.toString() }, requestId: res.locals.requestId });
    }
    const conv = await prisma.im_conversations.create({
      data: { order_id: order.id, user_id: order.elder_user_id, companion_id: order.companion_id! },
    });
    res.json({ code: 0, data: { conversationId: conv.id.toString() }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /im/conversations —— 我的会话列表 */
imRouter.get('/conversations', authMiddleware, async (req, res, next) => {
  try {
    let where: Record<string, unknown>;
    if (req.user!.role === 'COMPANION') {
      const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
      if (!companion) throw new AppError(13001, '陪聊员主档不存在');
      where = { companion_id: companion.id };
    } else {
      where = { user_id: req.user!.userId };
    }
    const list = await prisma.im_conversations.findMany({
      where,
      include: { order: { select: { order_no: true, status: true } } },
      orderBy: { last_message_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: list.map((c) => ({
        id: c.id.toString(),
        orderId: c.order_id.toString(),
        orderNo: c.order.order_no,
        orderStatus: c.order.status,
        status: c.status,
        unread: req.user!.role === 'COMPANION' ? c.companion_unread : c.user_unread,
        lastMessageAt: c.last_message_at?.toISOString() ?? null,
        lastMessagePreview: c.last_message_preview,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /im/conversations/:id/messages —— 历史消息（游标分页，DATABASE.md §4.1④） */
imRouter.get('/conversations/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const { cursor, limit } = parseOrThrow(cursorSchema, req.query);
    const conv = await prisma.im_conversations.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!conv) throw new AppError(17001, '会话不存在');
    // 权限：订单相关方
    const order = await prisma.orders.findUnique({ where: { id: conv.order_id } });
    const companion = req.user!.role === 'COMPANION'
      ? await prisma.companions.findUnique({ where: { user_id: req.user!.userId } })
      : null;
    if (
      order &&
      order.user_id !== req.user!.userId &&
      order.elder_user_id !== req.user!.userId &&
      (!companion || order.companion_id !== companion.id)
    ) {
      throw new AppError(10004, '非会话相关方');
    }
    const messages = await prisma.im_messages.findMany({
      where: { conversation_id: conv.id, ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1, // 多取一条判断 hasMore
    });
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();
    res.json({
      code: 0,
      data: {
        list: page.map((m) => ({
          id: m.id.toString(),
          senderId: m.sender_id.toString(),
          senderRole: m.sender_role,
          msgType: m.msg_type,
          content: m.content,
          status: m.status,
          fileMetaId: m.file_meta_id?.toString() ?? null,
          voiceDurationMs: m.voice_duration_ms,
          asrText: m.asr_text,
          createdAt: m.created_at.toISOString(),
        })),
        nextCursor: hasMore && page.length > 0 ? page[0]!.id.toString() : null,
        hasMore,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /im/conversations/:id/messages —— 发送消息（端上幂等 client_msg_id） */
imRouter.post('/conversations/:id/messages', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      clientMsgId: z.string().min(8).max(64),
      msgType: z.enum(['TEXT', 'IMAGE', 'VOICE', 'SYSTEM']).default('TEXT'),
      content: z.string().min(1).max(2000),
      fileMetaId: z.string().regex(/^\d+$/).optional(),
      voiceDurationMs: z.number().int().min(0).max(120000).optional(),
    });
    const input = parseOrThrow(schema, req.body);
    const conv = await prisma.im_conversations.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!conv) throw new AppError(17001, '会话不存在');
    if (conv.status !== 'ACTIVE') throw new AppError(17002, '会话已关闭');

    const senderRole = req.user!.role === 'COMPANION' ? 'COMPANION' : 'USER';
    const result = await withTransaction(async (tx) => {
      // 端上幂等：重复 client_msg_id 返回原消息
      const dup = await tx.im_messages.findUnique({
        where: { conversation_id_client_msg_id: { conversation_id: conv.id, client_msg_id: input.clientMsgId } },
      });
      if (dup) return { message: dup, duplicated: true };
      const message = await tx.im_messages.create({
        data: {
          conversation_id: conv.id,
          sender_id: req.user!.userId,
          sender_role: senderRole,
          msg_type: input.msgType,
          content: input.content,
          client_msg_id: input.clientMsgId,
          file_meta_id: input.fileMetaId ? BigInt(input.fileMetaId) : null,
          voice_duration_ms: input.voiceDurationMs ?? null,
          review_status: 'PENDING', // 异步送检（content-review 队列）
        },
      });
      await tx.im_conversations.update({
        where: { id: conv.id },
        data: {
          last_message_at: message.created_at,
          last_message_preview: input.content.slice(0, 64),
          user_unread: senderRole === 'COMPANION' ? { increment: 1 } : 0,
          companion_unread: senderRole === 'USER' ? { increment: 1 } : 0,
        },
      });
      return { message, duplicated: false };
    });
    // TODO(content-review)：入队内容安全送检（微信 msgSecCheck + 人工抽检）
    res.json({
      code: 0,
      data: {
        id: result.message.id.toString(),
        duplicated: result.duplicated,
        createdAt: result.message.created_at.toISOString(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /im/conversations/:id/read —— 已读上报 */
imRouter.post('/conversations/:id/read', authMiddleware, async (req, res, next) => {
  try {
    const conv = await prisma.im_conversations.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!conv) throw new AppError(17001, '会话不存在');
    const field = req.user!.role === 'COMPANION' ? 'companion_unread' : 'user_unread';
    await prisma.im_conversations.update({ where: { id: conv.id }, data: { [field]: 0 } });
    await prisma.im_messages.updateMany({
      where: { conversation_id: conv.id, ...(req.user!.role === 'COMPANION' ? { read_by_companion_at: null } : { read_by_user_at: null }) },
      data: req.user!.role === 'COMPANION' ? { read_by_companion_at: new Date() } : { read_by_user_at: new Date() },
    });
    res.json({ code: 0, data: { read: true }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /im/privacy-binding/order/:orderId —— 订单隐私号（虚拟号互打） */
imRouter.get('/privacy-binding/order/:orderId', authMiddleware, async (req, res, next) => {
  try {
    const order = await prisma.orders.findUnique({ where: { id: BigInt(req.params.orderId!) } });
    if (!order) throw new AppError(14001, '订单不存在');
    const binding = await prisma.privacy_bindings.findUnique({ where: { order_id: order.id } });
    if (!binding) {
      // 懒绑定：服务时段内首次查看时建立 AXB
      if (!order.companion_id) throw new AppError(17004, '订单未接单，隐私号未建立');
      const companion = await prisma.companions.findUnique({ where: { id: order.companion_id } });
      if (!companion) throw new AppError(13001, '陪聊员不存在');
      const adapter = getPrivacyNumberAdapter();
      // 真实号码密文引用（适配层只做标识，不还原明文）
      const expiredAt = new Date((order.slot_end?.getTime() ?? Date.now()) + 24 * 3600_000);
      const r = await adapter.bindAxb({
        orderId: order.id.toString(),
        userPhoneCipher: 'cipher-ref',
        companionPhoneCipher: 'cipher-ref',
        expiredAt,
      });
      const created = await prisma.privacy_bindings.create({
        data: {
          order_id: order.id,
          user_id: order.elder_user_id,
          companion_id: order.companion_id,
          axb_bind_id: r.bindId,
          // 端上只暴露「对方虚拟号」：老人视角见 companion_virtual_number，反之亦然
          user_virtual_number: r.virtualNumber,
          companion_virtual_number: r.virtualNumber,
          status: 'ACTIVE',
          expired_at: expiredAt,
        },
      });
      const virtualNumber = req.user!.role === 'COMPANION' ? created.user_virtual_number : created.companion_virtual_number;
      return res.json({
        code: 0,
        data: { virtualNumber, status: created.status, expiredAt: created.expired_at?.toISOString() ?? null },
        requestId: res.locals.requestId,
      });
    }
    const virtualNumber = req.user!.role === 'COMPANION' ? binding.user_virtual_number : binding.companion_virtual_number;
    res.json({
      code: 0,
      data: { virtualNumber, status: binding.status, expiredAt: binding.expired_at?.toISOString() ?? null },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

void genUuid;
void roleGuard;
