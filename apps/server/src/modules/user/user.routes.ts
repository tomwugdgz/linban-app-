// ============================================================================
// 邻伴 · user 模块：老人档案 / 子女家庭绑定 / 注销（架构 §10.1）
// ----------------------------------------------------------------------------
// 接口清单（详见 docs/API-CONTRACT.md）：
//   GET   /api/v1/users/me/profile            我的完整资料
//   PUT   /api/v1/users/me/elder-profile      创建/更新老人档案
//   POST  /api/v1/users/family-bindings       子女发起绑定（老人扫码/确认）
//   GET   /api/v1/users/family-bindings       我的绑定列表（双向视角）
//   POST  /api/v1/users/family-bindings/:id/confirm   老人确认绑定
//   POST  /api/v1/users/family-bindings/:id/revoke    解除绑定
//   GET   /api/v1/users/:id/brief             他人简卡（脱敏）
//   POST  /api/v1/users/me/cancel-request     注销申请（15 天冷静期）
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import { ACCOUNT_CANCEL_COOLDOWN_DAYS } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { authMiddleware, roleGuard } from '../../middlewares/auth';
import { parseOrThrow, validateBody } from '../../common/validation';
import { decrypt, encrypt, isCryptoConfigured, maskPhone } from '../../common/crypto';
import { genBizNo } from '../../common/ids';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('user');

const elderProfileSchema = z.object({
  gender: z.enum(['male', 'female', 'unknown']).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  interests: z.array(z.string().max(16)).max(20).optional(),
  healthBoundaries: z.record(z.unknown()).optional(),
  preferences: z.record(z.unknown()).optional(),
  emergencyContactName: z.string().max(32).optional(),
  emergencyContactPhone: z.string().regex(/^1\d{10}$/).optional(),
  emergencyContactRelation: z.string().max(16).optional(),
});

const bindSchema = z.object({
  /** 老人 userId 或老人手机号（hmac 检索） */
  elderUserId: z.string().regex(/^\d+$/).optional(),
  elderPhone: z.string().regex(/^1\d{10}$/).optional(),
  relation: z.enum(['父子', '母子', '配偶', '亲属', '其他']),
  authLevel: z.enum(['BASIC', 'PROGRESS', 'FULL']).default('BASIC'),
});

export const userRouter = Router();

// ---------------------------------------------------------------------------
// GET /users/me/profile —— 我的完整资料（含老人档案脱敏视图）
// ---------------------------------------------------------------------------
userRouter.get('/me/profile', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user!.userId },
      include: { elder_profile: true, companion: true },
    });
    if (!user) throw new AppError(10002, '账号不存在');

    const elder = user.elder_profile;
    res.json({
      code: 0,
      data: {
        id: user.id.toString(),
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        role: user.role,
        status: user.status,
        createdAt: user.created_at.toISOString(),
        companionId: user.companion?.id.toString() ?? null,
        elderProfile: elder
          ? {
              userId: user.id.toString(),
              gender: elder.gender,
              birthday: elder.birthday?.toISOString().slice(0, 10) ?? null,
              interests: (elder.interests as string[] | null) ?? null,
              preferences: elder.preferences,
              emergencyContactName: safeDecrypt(elder.emergency_contact_name_cipher),
              emergencyContactRelation: elder.emergency_contact_relation,
              hasEmergencyContactPhone: Boolean(elder.emergency_contact_phone_cipher),
            }
          : null,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// PUT /users/me/elder-profile —— 创建/更新老人档案（仅老人或授权子女）
// ---------------------------------------------------------------------------
userRouter.put('/me/elder-profile', authMiddleware, validateBody(elderProfileSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(elderProfileSchema, req.body);

    // 目标老人：本人是老人 → 自己；子女 → 需 PROGRESS 及以上授权
    let elderUserId = req.user!.userId;
    if (req.user!.role === 'FAMILY') {
      const binding = await prisma.family_bindings.findFirst({
        where: { family_user_id: req.user!.userId, status: 'ACTIVE', active_key: 'A' },
      });
      if (!binding) throw new AppError(12004, '未绑定老人账号');
      if (binding.auth_level === 'BASIC') throw new AppError(10004, '当前授权等级不可编辑档案');
      elderUserId = binding.elder_user_id;
    }
    if (req.user!.role === 'COMPANION') throw new AppError(12006, '陪聊员账号无老人档案');

    const data: Record<string, unknown> = {};
    if (input.gender !== undefined) data.gender = input.gender;
    if (input.birthday !== undefined) data.birthday = new Date(`${input.birthday}T00:00:00.000Z`);
    if (input.interests !== undefined) data.interests = input.interests;
    if (input.healthBoundaries !== undefined) data.health_boundaries = input.healthBoundaries;
    if (input.preferences !== undefined) data.preferences = input.preferences;
    if (input.emergencyContactName !== undefined) {
      data.emergency_contact_name_cipher = enc(input.emergencyContactName);
    }
    if (input.emergencyContactPhone !== undefined) {
      data.emergency_contact_phone_cipher = enc(input.emergencyContactPhone);
    }
    if (input.emergencyContactRelation !== undefined) {
      data.emergency_contact_relation = input.emergencyContactRelation;
    }

    const profile = await prisma.elder_profiles.upsert({
      where: { user_id: elderUserId },
      create: { user_id: elderUserId, ...data },
      update: data,
    });
    log.info({ event: 'elder-profile-upsert', elderUserId: elderUserId.toString(), by: req.user!.userId.toString() });
    res.json({
      code: 0,
      data: {
        userId: elderUserId.toString(),
        gender: profile.gender,
        birthday: profile.birthday?.toISOString().slice(0, 10) ?? null,
        interests: (profile.interests as string[] | null) ?? null,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /users/family-bindings —— 子女发起绑定（老人确认后生效）
// ---------------------------------------------------------------------------
userRouter.post('/family-bindings', authMiddleware, roleGuard('FAMILY'), validateBody(bindSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(bindSchema, req.body);

    // 定位老人账号
    let elderUserId: bigint | null = null;
    if (input.elderUserId) {
      const elder = await prisma.users.findUnique({ where: { id: BigInt(input.elderUserId) } });
      if (!elder || elder.role !== 'ELDER') throw new AppError(12001, '老人账号不存在');
      elderUserId = elder.id;
    } else if (input.elderPhone) {
      const { hmacIndex, normalizePhone } = await import('../../common/crypto');
      const elder = await prisma.users.findFirst({ where: { phone_hmac: hmacIndex(normalizePhone(input.elderPhone), true), role: 'ELDER' } });
      if (!elder) throw new AppError(12001, '未找到该手机号对应的老人账号（请老人先登录小程序）');
      elderUserId = elder.id;
    } else {
      throw new AppError(10001, '需提供老人 userId 或手机号');
    }
    if (elderUserId === req.user!.userId) throw new AppError(10001, '不能绑定自己');

    // 查重（生效中唯一：active_key='A'）
    const existing = await prisma.family_bindings.findFirst({
      where: { family_user_id: req.user!.userId, elder_user_id: elderUserId, active_key: 'A' },
    });
    if (existing) throw new AppError(12002, '绑定关系已存在（生效中）');

    // 待确认绑定（active_key 置 NULL：未生效不占唯一位；确认时置 'A'）
    const binding = await prisma.family_bindings.create({
      data: {
        family_user_id: req.user!.userId,
        elder_user_id: elderUserId,
        relation: input.relation,
        auth_level: input.authLevel,
        status: 'PENDING',
        active_key: null,
      },
    });
    // TODO(notification)：订阅消息通知老人确认（notification 模块就绪后接入）
    res.json({
      code: 0,
      data: {
        id: binding.id.toString(),
        status: binding.status,
        elderUserId: elderUserId.toString(),
        hint: '已发起绑定，请老人在小程序「家庭绑定」中确认',
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /users/family-bindings/:id/confirm —— 老人确认（激活绑定）
// ---------------------------------------------------------------------------
userRouter.post('/family-bindings/:id/confirm', authMiddleware, roleGuard('ELDER'), async (req, res, next) => {
  try {
    const binding = await prisma.family_bindings.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!binding || binding.elder_user_id !== req.user!.userId) throw new AppError(12003, '绑定关系不存在');
    if (binding.status !== 'PENDING') throw new AppError(12002, '绑定已被处理');

    // 并发安全：仅当仍为 PENDING 时推进（乐观并发）
    const { count } = await prisma.family_bindings.updateMany({
      where: { id: binding.id, status: 'PENDING' },
      data: { status: 'ACTIVE', active_key: 'A', bound_at: new Date() },
    });
    if (count === 0) throw new AppError(12002, '绑定已被处理');
    res.json({ code: 0, data: { id: binding.id.toString(), status: 'ACTIVE' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /users/family-bindings/:id/revoke —— 解除绑定（双向可发起）
// ---------------------------------------------------------------------------
userRouter.post('/family-bindings/:id/revoke', authMiddleware, async (req, res, next) => {
  try {
    const binding = await prisma.family_bindings.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!binding) throw new AppError(12003, '绑定关系不存在');
    const isFamily = binding.family_user_id === req.user!.userId;
    const isElder = binding.elder_user_id === req.user!.userId;
    if (!isFamily && !isElder) throw new AppError(10004, '非绑定关系当事人');
    if (binding.status !== 'ACTIVE') throw new AppError(12004, '绑定未生效或已解除');

    const { count } = await prisma.family_bindings.updateMany({
      where: { id: binding.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', active_key: null, revoked_at: new Date() }, // 释放唯一位，可重新绑定
    });
    if (count === 0) throw new AppError(12004, '绑定状态已变化');
    res.json({ code: 0, data: { id: binding.id.toString(), status: 'REVOKED' }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /users/family-bindings —— 我的绑定列表（子女视角/老人视角）
// ---------------------------------------------------------------------------
userRouter.get('/family-bindings', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user!.role === 'ELDER' ? { elder_user_id: req.user!.userId } : { family_user_id: req.user!.userId };
    const list = await prisma.family_bindings.findMany({
      where,
      include: {
        family_user: { select: { id: true, nickname: true, avatar_url: true, role: true, status: true } },
        elder_user: { select: { id: true, nickname: true, avatar_url: true, role: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({
      code: 0,
      data: list.map((b) => ({
        id: b.id.toString(),
        familyUser: brief(b.family_user),
        elderUser: brief(b.elder_user),
        relation: b.relation,
        authLevel: b.auth_level,
        status: b.status,
        boundAt: b.bound_at?.toISOString() ?? null,
        createdAt: b.created_at.toISOString(),
      })),
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/brief —— 他人简卡（脱敏：无手机号/证件/地址）
// ---------------------------------------------------------------------------
userRouter.get('/:id/brief', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: BigInt(req.params.id!) } });
    if (!user || user.deleted_at) throw new AppError(10007, '用户不存在');
    res.json({
      code: 0,
      data: {
        id: user.id.toString(),
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        role: user.role,
        status: user.status,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /users/me/cancel-request —— 注销申请（15 天冷静期，架构 §10.1）
// ---------------------------------------------------------------------------
userRouter.post('/me/cancel-request', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({ where: { id: req.user!.userId } });
    if (!user) throw new AppError(10002, '账号不存在');
    if (user.status === 'CANCELLED') throw new AppError(11005, '账号已注销');

    // 铁律预检：进行中订单 / 未结算资金 / 在审入驻 一律不允许注销
    const activeOrders = await prisma.orders.count({
      where: {
        OR: [{ user_id: req.user!.userId }, { elder_user_id: req.user!.userId }],
        status: { in: ['PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'SUSPENDED'] },
      },
    });
    if (activeOrders > 0) throw new AppError(10008, '存在进行中的订单，请先处理完成');
    // TODO(payment)：未提现余额校验（payment 模块 withdrawal 就绪后补）

    await prisma.users.update({
      where: { id: req.user!.userId },
      data: { status: 'CANCELLED', deleted_at: new Date(Date.now() + ACCOUNT_CANCEL_COOLDOWN_DAYS * 86400_000) },
    });
    // TODO(cron)：冷静期到期匿名化任务（昵称/头像/手机号匿名化；资金流水法定保留）
    res.json({
      code: 0,
      data: {
        status: 'CANCELLED',
        cooldownDays: ACCOUNT_CANCEL_COOLDOWN_DAYS,
        effectiveAt: new Date(Date.now() + ACCOUNT_CANCEL_COOLDOWN_DAYS * 86400_000).toISOString(),
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---- 内部助手 ----

function enc(plain: string): string {
  return isCryptoConfigured() ? encrypt(plain) : `PLAIN_DEV:${plain}`;
}

function safeDecrypt(cipher: string | null): string | null {
  if (!cipher) return null;
  if (cipher.startsWith('PLAIN_DEV:')) return cipher.slice('PLAIN_DEV:'.length);
  try {
    return decrypt(cipher);
  } catch {
    return null;
  }
}

function brief(u: { id: bigint; nickname: string; avatar_url: string | null; role: string; status: string }) {
  return {
    id: u.id.toString(),
    nickname: u.nickname,
    avatarUrl: u.avatar_url,
    role: u.role,
    status: u.status,
  };
}
