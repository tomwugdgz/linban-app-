// ============================================================================
// 邻伴 · companion 模块路由：入驻四审 / 主档 / 信用分 / 保证金 / 日程
// ----------------------------------------------------------------------------
// 陪聊员端接口 + 后台四审审核接口（admin 前缀路由在本文件集中注册，
// 鉴权用 adminAuthMiddleware + adminPermGuard）。
// 完整契约见 docs/API-CONTRACT.md §4。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { parseOrThrow, validateBody } from '../../common/validation';
import { fenSchema, idSchema, localDateSchema, hmSchema } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import {
  applyCredit,
  completeTraining,
  confirmDepositPaid,
  createDepositPayment,
  ensureCompanionAcceptable,
  ensureDepositSufficient,
  isCompanionLimited,
  submitApplication,
  submitCriminalMaterial,
  submitExam,
  submitFace,
  submitRealname,
} from './companion.service';
import { withTransaction } from '../../infra/prisma';
import { genBizNo } from '../../common/ids';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('companion-routes');

export const companionRouter = Router();
export const companionAdminRouter = Router();

// ---------------------------------------------------------------------------
// 陪聊员端
// ---------------------------------------------------------------------------

/** POST /companion/applications —— 提交入驻申请 */
companionRouter.post('/applications', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({
      realName: z.string().min(2).max(32),
      idCard: z.string().regex(/^\d{17}[\dXx]$/),
      hourlyRateFen: fenSchema,
      serviceRadiusM: z.number().int().min(500).max(20000).optional(),
      tags: z.array(z.string().max(8)).max(10).optional(),
      anchorLat: z.number(),
      anchorLng: z.number(),
    });
    const input = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    const r = await submitApplication(req.user!.userId, { ...input, hourlyRateFen: BigInt(input.hourlyRateFen) });
    void companion;
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /companion/applications/me —— 我的申请状态 */
companionRouter.get('/applications/me', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在，请先提交入驻申请');
    const application = await prisma.companion_applications.findFirst({
      where: { companion_id: companion.id, active_key: 'A' },
    });
    res.json({
      code: 0,
      data: application
        ? {
            applicationNo: application.application_no,
            stage: application.stage,
            stepStatuses: {
              realname: application.realname_status,
              face: application.face_status,
              criminal: application.criminal_status,
              exam: application.exam_score !== null && application.exam_score >= 80 ? 'PASSED' : 'PENDING',
              deposit: application.deposit_paid_at ? 'PASSED' : 'PENDING',
            },
            examScore: application.exam_score,
            examAttemptNo: application.exam_attempt_no,
            depositAmountFen: application.deposit_amount_fen?.toString() ?? null,
            rejectReason: application.reject_reason,
            submittedAt: application.submitted_at.toISOString(),
            decidedAt: application.decided_at?.toISOString() ?? null,
          }
        : { stage: null, hint: '暂无在审申请' },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/realname —— ①实名（OCR+二要素） */
companionRouter.post('/applications/me/realname', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({ frontObjectKey: z.string().min(1), backObjectKey: z.string().min(1) });
    const { frontObjectKey, backObjectKey } = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const r = await submitRealname(companion.id, frontObjectKey, backObjectKey);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/face —— ②人脸（活体+底照） */
companionRouter.post('/applications/me/face', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({ videoObjectKey: z.string().min(1), photoFileId: idSchema.optional() });
    const { videoObjectKey, photoFileId } = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const r = await submitFace(companion.id, videoObjectKey, photoFileId ? BigInt(photoFileId) : null);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/criminal —— ③无犯罪记录材料 */
companionRouter.post('/applications/me/criminal', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({ materialFileId: idSchema });
    const { materialFileId } = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const r = await submitCriminalMaterial(companion.id, BigInt(materialFileId));
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/training-complete —— 培训完成 */
companionRouter.post('/applications/me/training-complete', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({ courseIds: z.array(z.string()).min(1) });
    const { courseIds } = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const r = await completeTraining(companion.id, courseIds);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/exam —— 认证考试 */
companionRouter.post('/applications/me/exam', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({ score: z.number().int().min(0).max(100) });
    const { score } = parseOrThrow(schema, req.body);
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const r = await submitExam(companion.id, score);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /companion/applications/me/deposit —— ④保证金下单 */
companionRouter.post('/applications/me/deposit', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '请先提交入驻申请');
    const key = `deposit:${companion.id}:${Date.now()}`;
    const r = await createDepositPayment(companion.id, key);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** GET /companion/me —— 我的陪聊员主档（含信用分/保证金，R 态本账号可见） */
companionRouter.get('/me', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    res.json({
      code: 0,
      data: {
        id: companion.id.toString(),
        status: companion.status,
        creditScore: companion.credit_score,
        limited: await isCompanionLimited(companion.id),
        hourlyRateFen: companion.hourly_rate_fen.toString(),
        serviceRadiusM: companion.service_radius_m,
        tags: companion.tags,
        ratingAvg: companion.rating_avg.toString(),
        ratingCount: companion.rating_count,
        totalOrders: companion.total_orders,
        completedOrders: companion.completed_orders,
        cancelledOrders: companion.cancelled_orders,
        depositBalanceFen: companion.deposit_balance_fen.toString(),
        createdAt: companion.created_at.toISOString(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /companion/me/credit-logs —— 信用分明细 */
companionRouter.get('/me/credit-logs', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    const logs = await prisma.credit_logs.findMany({
      where: { companion_id: companion.id },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: logs.map((l) => ({
        id: l.id.toString(),
        changeScore: l.change_score,
        type: l.type,
        beforeScore: l.before_score,
        afterScore: l.after_score,
        reason: l.reason,
        relatedOrderId: l.related_order_id?.toString() ?? null,
        createdAt: l.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /companion/me/deposit-txs —— 保证金流水 */
companionRouter.get('/me/deposit-txs', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    const txs = await prisma.deposit_transactions.findMany({
      where: { companion_id: companion.id },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json({
      code: 0,
      data: txs.map((t) => ({
        id: t.id.toString(),
        txNo: t.tx_no,
        type: t.type,
        amountFen: t.amount_fen.toString(),
        balanceAfterFen: t.balance_after_fen.toString(),
        status: t.status,
        remark: t.remark,
        createdAt: t.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 日程（周期模板 + 日期特例）
// ---------------------------------------------------------------------------

/** GET /companion/schedules —— 我的日程 */
companionRouter.get('/schedules', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');
    const list = await prisma.companion_schedules.findMany({
      where: { companion_id: companion.id },
      orderBy: [{ date: 'asc' }, { weekday: 'asc' }, { start_time: 'asc' }],
    });
    res.json({
      code: 0,
      data: list.map((s) => ({
        id: s.id.toString(),
        date: s.date ? s.date.toISOString().slice(0, 10) : null,
        weekday: s.weekday,
        startTime: s.start_time,
        endTime: s.end_time,
        status: s.status,
        note: s.note,
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** PUT /companion/schedules —— 覆盖设置日程（先删后建，事务保证） */
companionRouter.put('/schedules', authMiddleware, roleGuard('COMPANION'), async (req, res, next) => {
  try {
    const schema = z.object({
      windows: z
        .array(
          z.object({
            date: localDateSchema.optional(),
            weekday: z.number().int().min(0).max(6).optional(),
            startTime: hmSchema,
            endTime: hmSchema,
            status: z.enum(['AVAILABLE', 'BLACKOUT']).default('AVAILABLE'),
            note: z.string().max(64).optional(),
          }),
        )
        .max(50),
    });
    const { windows } = parseOrThrow(schema, req.body);
    // 互斥校验：date 与 weekday 必填其一
    for (const w of windows) {
      if (!w.date && w.weekday === undefined) throw new AppError(10001, '日程窗口需指定 date 或 weekday');
      if (w.date && w.weekday !== undefined) throw new AppError(10001, 'date 与 weekday 互斥');
      if (w.startTime >= w.endTime) throw new AppError(10001, '开始时间须早于结束时间');
    }
    const companion = await prisma.companions.findUnique({ where: { user_id: req.user!.userId } });
    if (!companion) throw new AppError(13001, '陪聊员主档不存在');

    await withTransaction(async (tx) => {
      await tx.companion_schedules.deleteMany({ where: { companion_id: companion.id } });
      for (const w of windows) {
        await tx.companion_schedules.create({
          data: {
            companion_id: companion.id,
            date: w.date ? new Date(`${w.date}T00:00:00.000Z`) : null,
            weekday: w.weekday ?? null,
            start_time: w.startTime,
            end_time: w.endTime,
            status: w.status,
            note: w.note ?? null,
          },
        });
      }
    });
    res.json({ code: 0, data: { saved: windows.length }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 浏览/详情（老人端：附近陪聊员）
// ---------------------------------------------------------------------------

/** GET /companions/nearby —— 附近可约陪聊员（R 态脱敏） */
companionRouter.get('/nearby', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      geoHash: z.string().min(1).max(12),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    });
    const { geoHash, page, pageSize } = parseOrThrow(schema, req.query);
    // geohash 前缀扫描（DATABASE.md §4.1②）：ACTIVE × geo_hash 前缀
    const list = await prisma.companions.findMany({
      where: {
        status: 'ACTIVE',
        deleted_at: null,
        geo_hash: { startsWith: geoHash.slice(0, 4) },
      },
      include: { user: { select: { id: true, nickname: true, avatar_url: true } } },
      orderBy: [{ rating_avg: 'desc' }, { completed_orders: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    res.json({
      code: 0,
      data: list.map((c) => ({
        id: c.id.toString(),
        nickname: c.user.nickname,
        avatarUrl: c.user.avatar_url,
        level: c.level,
        ratingAvg: c.rating_avg.toString(),
        ratingCount: c.rating_count,
        tags: c.tags,
        hourlyRateFen: c.hourly_rate_fen.toString(),
        serviceRadiusM: c.service_radius_m,
        totalOrders: c.total_orders,
        distanceM: null, // 距离由端上算（服务端不持有用户全精度坐标）
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /companions/:id —— 陪聊员详情（脱敏：无证件/信用分/保证金） */
companionRouter.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const c = await prisma.companions.findUnique({
      where: { id: BigInt(req.params.id!) },
      include: { user: { select: { id: true, nickname: true, avatar_url: true } } },
    });
    if (!c || c.deleted_at) throw new AppError(13001, '陪聊员不存在');
    res.json({
      code: 0,
      data: {
        id: c.id.toString(),
        nickname: c.user.nickname,
        avatarUrl: c.user.avatar_url,
        level: c.level,
        ratingAvg: c.rating_avg.toString(),
        ratingCount: c.rating_count,
        tags: c.tags,
        hourlyRateFen: c.hourly_rate_fen.toString(),
        serviceRadiusM: c.service_radius_m,
        totalOrders: c.total_orders,
        completedOrders: c.completed_orders,
        status: c.status,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// 后台：四审审核工作台（admin 前缀）
// ---------------------------------------------------------------------------

/** GET /admin/companion-applications —— 审核工作台（按 stage） */
companionAdminRouter.get('/companion-applications', adminAuthMiddleware, adminPermGuard('companion:*'), async (req, res, next) => {
  try {
    const schema = z.object({ stage: z.string().optional(), page: z.coerce.number().default(1), pageSize: z.coerce.number().max(100).default(20) });
    const { stage, page, pageSize } = parseOrThrow(schema, req.query);
    const where = stage ? { stage: stage as never, active_key: 'A' } : { active_key: 'A' };
    const [list, total] = await Promise.all([
      prisma.companion_applications.findMany({
        where,
        include: { companion: { include: { user: { select: { nickname: true, avatar_url: true } } } } },
        orderBy: { submitted_at: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.companion_applications.count({ where }),
    ]);
    res.json({
      code: 0,
      data: {
        list: list.map((a) => ({
          applicationNo: a.application_no,
          companionId: a.companion_id.toString(),
          nickname: a.companion.user.nickname,
          stage: a.stage,
          realnameStatus: a.realname_status,
          faceStatus: a.face_status,
          faceScore: a.face_score,
          criminalStatus: a.criminal_status,
          examScore: a.exam_score,
          submittedAt: a.submitted_at.toISOString(),
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

/** POST /admin/companion-applications/:no/criminal —— ③无犯罪记录人工审核 */
companionAdminRouter.post('/companion-applications/:no/criminal', adminAuthMiddleware, adminPermGuard('companion:*'), async (req, res, next) => {
  try {
    const schema = z.object({ passed: z.boolean(), comment: z.string().max(512).optional() });
    const { passed, comment } = parseOrThrow(schema, req.body);
    const application = await prisma.companion_applications.findUnique({
      where: { application_no: req.params.no! },
      include: { companion: true },
    });
    if (!application) throw new AppError(13002, '申请不存在');
    if (application.stage !== 'FACE_OK') throw new AppError(13004, '当前阶段不可审核无犯罪记录');

    const now = new Date();
    if (passed) {
      await withTransaction(async (tx) => {
        await tx.companion_applications.updateMany({
          where: { id: application.id, stage: 'FACE_OK' },
          data: {
            stage: 'CRIMINAL_OK',
            criminal_status: 'PASSED',
            criminal_reviewer_id: req.admin!.adminId,
            criminal_reviewed_at: now,
            criminal_comment: comment ?? null,
          },
        });
        await tx.companions.update({ where: { id: application.companion_id }, data: { status: 'PENDING' } });
      });
      res.json({ code: 0, data: { stage: 'CRIMINAL_OK' }, requestId: res.locals.requestId });
    } else {
      await withTransaction(async (tx) => {
        await tx.companion_applications.update({
          where: { id: application.id },
          data: {
            criminal_status: 'REJECTED',
            criminal_reviewer_id: req.admin!.adminId,
            criminal_reviewed_at: now,
            criminal_comment: comment ?? '材料不符',
            reject_reason: comment ?? '无犯罪记录审核未通过',
            decided_at: now,
            active_key: null,
          },
        });
        await tx.companions.update({ where: { id: application.companion_id }, data: { status: 'BANNED' } });
      });
      res.json({ code: 0, data: { stage: 'REJECTED' }, requestId: res.locals.requestId });
    }
  } catch (e) {
    next(e);
  }
});

/** POST /admin/companion-applications/:no/deposit-confirm —— 保证金到账确认（人工核实用） */
companionAdminRouter.post('/companion-applications/:no/deposit-confirm', adminAuthMiddleware, adminPermGuard('companion:*'), async (req, res, next) => {
  try {
    const application = await prisma.companion_applications.findUnique({
      where: { application_no: req.params.no! },
      include: { companion: { include: { deposit_transactions: { where: { status: 'PENDING' }, take: 1 } } } },
    });
    if (!application) throw new AppError(13002, '申请不存在');
    const pending = application.companion.deposit_transactions[0];
    if (!pending) throw new AppError(13009, '无待确认的保证金流水');
    const r = await confirmDepositPaid(pending.tx_no, `manual_${Date.now()}`);
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/companions/:id/credit —— 人工调整信用分（MANUAL，写审计） */
companionAdminRouter.post('/companions/:id/credit', adminAuthMiddleware, adminPermGuard('companion:*'), async (req, res, next) => {
  try {
    const schema = z.object({ delta: z.number().int().min(-20).max(20), reason: z.string().min(2).max(256) });
    const { delta, reason } = parseOrThrow(schema, req.body);
    const r = await applyCredit(BigInt(req.params.id!), 'MANUAL', {
      delta,
      reason,
      operatorId: req.admin!.adminId,
    });
    res.json({ code: 0, data: r, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

/** POST /admin/companions/:id/status —— 暂停/恢复/清退（companion_status） */
companionAdminRouter.post('/companions/:id/status', adminAuthMiddleware, adminPermGuard('companion:*'), async (req, res, next) => {
  try {
    const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'RETIRED']), reason: z.string().max(256) });
    const { status, reason } = parseOrThrow(schema, req.body);
    const r = await prisma.companions.update({
      where: { id: BigInt(req.params.id!) },
      data: { status, ...(status === 'RETIRED' ? { retired_at: new Date() } : {}) },
    });
    // 保证金充足性预检仅对罚扣场景；状态调整本身不动资金
    void ensureDepositSufficient;
    void ensureCompanionAcceptable;
    void genBizNo;
    log.info({ event: 'companion-status-change', companionId: req.params.id, status, reason, by: req.admin!.adminId.toString() });
    res.json({ code: 0, data: { id: r.id.toString(), status: r.status }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});
