// ============================================================================
// 邻伴 · notification 模块：订阅消息 / 短信 / 消息中心（骨架 + 核心接口）
// ----------------------------------------------------------------------------
// 已实现：消息中心列表、已读；发送入队（worker 消费 TODO）。
// TODO：订阅消息模板 ID 配置、失败重试（notification 队列）、
//       短信降级通道（订阅消息失败时）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware } from '../../middlewares/auth';
import { parseOrThrow } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { getSmsAdapter } from '../../adapters/sms';
import { enqueue } from '../../infra/queue';
import { QUEUE_NAMES } from '@linban/shared';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('notification');

export const notificationRouter = Router();

/** GET /notifications —— 我的消息中心 */
notificationRouter.get('/', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ page: z.coerce.number().default(1), pageSize: z.coerce.number().max(50).default(20) });
    const { page, pageSize } = parseOrThrow(schema, req.query);
    const [list, total] = await Promise.all([
      prisma.notification_logs.findMany({
        where: { target_user_id: req.user!.userId },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification_logs.count({ where: { target_user_id: req.user!.userId } }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((n) => ({
          id: n.id.toString(),
          channel: n.channel,
          title: n.title,
          content: n.content,
          bizType: n.biz_type,
          status: n.status,
          sentAt: n.sent_at?.toISOString() ?? null,
          createdAt: n.created_at.toISOString(),
        })),
        total, page, pageSize,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /notifications/read —— 标记已读 */
notificationRouter.post('/read', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({ ids: z.array(z.string().regex(/^\d+$/)).min(1).max(100) });
    const { ids } = parseOrThrow(schema, req.body);
    const { count } = await prisma.notification_logs.updateMany({
      where: { id: { in: ids.map(BigInt) }, target_user_id: req.user!.userId },
      data: { status: 'SENT' },
    });
    res.json({ code: 0, data: { updated: count }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/**
 * 发送通知（内部服务函数：订单事件/告警调用）。
 * 先落 notification_logs（PENDING）再入队，worker 发送后回写 SENT/FAILED。
 * 注：notification_logs.target_user_id 为必填（schema 约束）——
 *     无用户维度的告警短信走 sendSmsDirect（不落库）。
 */
export async function sendNotification(input: {
  targetUserId: bigint;
  targetPhone?: string;
  channel: 'SUBSCRIBE_MESSAGE' | 'SMS' | 'IM_SYSTEM';
  title?: string;
  content: string;
  bizType?: string;
  templateId?: string;
  templateData?: Record<string, string>;
}): Promise<string> {
  const n = await prisma.notification_logs.create({
    data: {
      target_user_id: input.targetUserId,
      target_phone_cipher: input.targetPhone
        ? (await import('../../common/crypto')).encrypt(normalizeForStore(input.targetPhone))
        : null,
      channel: input.channel,
      title: input.title ?? null,
      content: input.content,
      biz_type: input.bizType ?? null,
      status: 'PENDING',
    },
  });
  await enqueue(QUEUE_NAMES.notification, 'send', {
    notificationLogId: n.id.toString(),
    channel: input.channel,
    targetUserId: input.targetUserId?.toString(),
    targetPhone: input.targetPhone,
    title: input.title,
    content: input.content,
    templateData: input.templateData,
    templateId: input.templateId,
  });
  return n.id.toString();
}

/** 短信直发（无用户维度：告警兜底通道） */
export async function sendSmsDirect(phone: string, code: string): Promise<boolean> {
  const sms = getSmsAdapter();
  const r = await sms.sendCode(phone, code);
  return r.sent;
}

function normalizeForStore(phone: string): string {
  return phone.replace(/\D/g, '');
}

void log;
