// ============================================================================
// 邻伴 · auth 模块：微信登录 + JWT + 账号资料（架构 §3.2 / §6.1 入口）
// ----------------------------------------------------------------------------
// 接口清单（详见 docs/API-CONTRACT.md）：
//   POST /api/v1/auth/wx-login      微信 code → 登录/注册（三端共用）
//   POST /api/v1/auth/phone-login   手机号验证码登录（子女端备用通道）
//   POST /api/v1/auth/refresh       refresh token 续期
//   POST /api/v1/auth/logout        登出（Redis 会话失效）
//   GET  /api/v1/auth/profile       当前登录者资料
//   POST /api/v1/auth/phone         绑定/换绑手机号（getPhoneNumber）
//   POST /api/v1/auth/admin-login   后台账密登录（失败锁定）
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '@linban/shared';
import type { user_role, user_status } from '@linban/shared';
import { ACCESS_TOKEN_TTL_SEC, REDIS_KEYS, REFRESH_TOKEN_TTL_SEC } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { getWxAuthAdapter } from '../../adapters/wechat/auth';
import { decrypt, encrypt, hmacIndex, isCryptoConfigured, maskPhone, normalizePhone } from '../../common/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../common/jwt';
import { parseOrThrow, validateBody } from '../../common/validation';
import { killSession, sessionAlive, touchSession } from '../../infra/redis';
import { getSmsAdapter } from '../../adapters/sms';
import { redis } from '../../infra/redis';
import { moduleLogger } from '../../common/logger';
import { loginRateLimit } from '../../middlewares/rate-limit';

const log = moduleLogger('auth');

/** 角色选择（登录时若账号已存在则忽略，按账号实际角色） */
const wxLoginSchema = z.object({
  code: z.string().min(6, '微信 code 无效'),
  /** 期望角色（仅新用户注册时生效；ELDER/FAMILY/COMPANION） */
  role: z.enum(['ELDER', 'FAMILY', 'COMPANION']).optional(),
  /** getPhoneNumber 授权 code（可选；不传则手机号后补） */
  phoneCode: z.string().optional(),
});

const phoneLoginSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, '手机号格式不正确'),
  code: z.string().regex(/^\d{6}$/, '验证码为 6 位数字'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const phoneBindSchema = z.object({
  phoneCode: z.string().min(6, '手机号授权 code 无效'),
});

const smsCodeSchema = z.object({
  phone: z.string().regex(/^1\d{10}$/, '手机号格式不正确'),
});

const adminLoginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(6).max(64),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});

export const authRouter = Router();

// ---------------------------------------------------------------------------
// POST /auth/wx-login —— 微信登录/注册（三端共用入口）
// ---------------------------------------------------------------------------
authRouter.post('/wx-login', validateBody(wxLoginSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(wxLoginSchema, req.body);
    const wxAuth = getWxAuthAdapter();
    const session = await wxAuth.code2Session(input.code);

    // 手机号（可选授权）：加密落库 + 盲索引查重
    let phoneCipher: string | null = null;
    let phoneHmac: string | null = null;
    if (input.phoneCode) {
      const wxPhone = await wxAuth.getPhoneNumber(input.phoneCode);
      const normalized = normalizePhone(wxPhone.purePhone);
      phoneCipher = isCryptoConfigured() ? encrypt(normalized) : `PLAIN_DEV:${normalized}`;
      phoneHmac = hmacIndex(normalized, true);
    }

    // 查找或创建账号（openid 唯一）
    let user = await prisma.users.findUnique({ where: { openid: session.openid } });
    let isNew = false;
    if (!user) {
      // 手机号查重（防一号多账号）
      if (phoneHmac) {
        const dup = await prisma.users.findFirst({ where: { phone_hmac: phoneHmac } });
        if (dup) throw new AppError(11003, '该手机号已绑定其他账号');
      }
      isNew = true;
      user = await prisma.users.create({
        data: {
          openid: session.openid,
          phone_cipher: phoneCipher,
          phone_hmac: phoneHmac,
          nickname: '邻伴用户',
          role: input.role ?? 'ELDER',
          status: 'ACTIVE',
        },
      });
      // 新用户按角色建档案
      // 注意：COMPANION 主档（real_name_cipher/id_card_cipher 必填）在入驻
      // 申请提交时创建（companion 模块），登录时不预建空档。
      if (user.role === 'ELDER') {
        await prisma.elder_profiles.create({ data: { user_id: user.id } });
      }
    } else if (phoneHmac && !user.phone_hmac) {
      // 存量用户首次补手机号：查重后更新
      const dup = await prisma.users.findFirst({ where: { phone_hmac: phoneHmac, id: { not: user.id } } });
      if (dup) throw new AppError(11003, '该手机号已绑定其他账号');
      await prisma.users.update({ where: { id: user.id }, data: { phone_cipher: phoneCipher!, phone_hmac: phoneHmac } });
    }

    if (user.status !== 'ACTIVE') {
      throw user.status === 'FROZEN' ? new AppError(11004) : new AppError(11005);
    }

    const tokens = await issueTokens(user.id, user.role, user.status);
    log.info({ event: 'wx-login', userId: user.id.toString(), role: user.role, isNew });
    res.json({
      code: 0,
      data: {
        ...tokens,
        isNew,
        user: { id: user.id.toString(), role: user.role, status: user.status },
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/phone-login —— 手机号验证码登录（子女端备用；老人主用微信一键）
// ---------------------------------------------------------------------------
authRouter.post('/phone-login', validateBody(phoneLoginSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(phoneLoginSchema, req.body);
    // 校验验证码（Redis code:<phone>）
    const stored = await redis.get(REDIS_KEYS.smsCode(normalizePhone(input.phone)));
    if (!stored || stored !== input.code) {
      throw new AppError(11001, '验证码错误或已过期');
    }
    await redis.del(REDIS_KEYS.smsCode(normalizePhone(input.phone)));

    const hmac = hmacIndex(normalizePhone(input.phone), true);
    let user = await prisma.users.findUnique({ where: { phone_hmac: hmac } });
    if (!user) {
      // 手机号登录即注册（默认 FAMILY：子女代操作场景）
      user = await prisma.users.create({
        data: {
          openid: `phone_${hmac.slice(0, 32)}`, // 手机号用户无 openid：占位唯一
          nickname: '邻伴用户',
          phone_cipher: isCryptoConfigured() ? encrypt(normalizePhone(input.phone)) : `PLAIN_DEV:${normalizePhone(input.phone)}`,
          phone_hmac: hmac,
          role: 'FAMILY',
          status: 'ACTIVE',
        },
      });
    }
    if (user.status !== 'ACTIVE') {
      throw user.status === 'FROZEN' ? new AppError(11004) : new AppError(11005);
    }
    const tokens = await issueTokens(user.id, user.role, user.status);
    res.json({ code: 0, data: { ...tokens, isNew: false }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/sms-code —— 发送手机号验证码
// ---------------------------------------------------------------------------
authRouter.post('/sms-code', validateBody(smsCodeSchema), async (req, res, next) => {
  try {
    const { phone } = parseOrThrow(smsCodeSchema, req.body);
    const normalized = normalizePhone(phone);
    // 限流：同手机号 60s 一条
    const ttl = await redis.ttl(REDIS_KEYS.smsCode(normalized));
    if (ttl > 240) throw new AppError(10005, '验证码发送过于频繁，请稍后再试');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await redis.set(REDIS_KEYS.smsCode(normalized), code, 'EX', 300); // 5min
    const sms = getSmsAdapter();
    const r = await sms.sendCode(normalized, code);
    if (!r.sent) throw new AppError(90004, '验证码发送失败');
    res.json({ code: 0, data: { sent: true, debugCode: process.env.NODE_ENV === 'production' ? undefined : code }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/refresh —— 续期（refresh → 新 access + 新 refresh）
// ---------------------------------------------------------------------------
authRouter.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    const { refreshToken } = parseOrThrow(refreshSchema, req.body);
    const { sub } = verifyRefreshToken(refreshToken);
    const user = await prisma.users.findUnique({ where: { id: BigInt(sub) } });
    if (!user) throw new AppError(10002, '账号不存在');
    if (user.status !== 'ACTIVE') {
      throw user.status === 'FROZEN' ? new AppError(11004) : new AppError(11005);
    }
    if (!(await sessionAlive(user.id))) {
      throw new AppError(10002, '登录状态已失效，请重新登录');
    }
    const tokens = await issueTokens(user.id, user.role, user.status);
    res.json({ code: 0, data: tokens, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/logout —— 登出（Redis 会话删除，全端踢下线）
// ---------------------------------------------------------------------------
authRouter.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const { verifyAccessToken } = await import('../../common/jwt');
        const payload = verifyAccessToken(header.slice(7));
        await killSession(BigInt(payload.sub));
      } catch {
        // token 已过期：无会话可杀，按成功处理
      }
    }
    res.json({ code: 0, data: { loggedOut: true }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /auth/profile —— 当前登录者资料
// ---------------------------------------------------------------------------
authRouter.get('/profile', async (req, res, next) => {
  try {
    if (!req.user) throw new AppError(10002);
    const user = await prisma.users.findUnique({
      where: { id: req.user.userId },
      include: { elder_profile: true, companion: true },
    });
    if (!user) throw new AppError(10002, '账号不存在');

    let phoneMasked: string | null = null;
    if (user.phone_cipher && !user.phone_cipher.startsWith('PLAIN_DEV:')) {
      try {
        phoneMasked = maskPhone(decrypt(user.phone_cipher));
      } catch {
        phoneMasked = null;
      }
    }

    res.json({
      code: 0,
      data: {
        id: user.id.toString(),
        nickname: user.nickname,
        avatarUrl: user.avatar_url,
        role: user.role,
        status: user.status,
        phoneMasked,
        createdAt: user.created_at.toISOString(),
        elderProfile: user.elder_profile
          ? {
              userId: user.id.toString(),
              gender: user.elder_profile.gender,
              birthday: user.elder_profile.birthday?.toISOString().slice(0, 10) ?? null,
              interests: (user.elder_profile.interests as string[] | null) ?? null,
            }
          : null,
        companionId: user.companion?.id.toString() ?? null,
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/phone —— 绑定/换绑手机号（getPhoneNumber 授权）
// ---------------------------------------------------------------------------
authRouter.post('/phone', validateBody(phoneBindSchema), async (req, res, next) => {
  try {
    if (!req.user) throw new AppError(10002);
    const { phoneCode } = parseOrThrow(phoneBindSchema, req.body);
    const wxAuth = getWxAuthAdapter();
    const wxPhone = await wxAuth.getPhoneNumber(phoneCode);
    const normalized = normalizePhone(wxPhone.purePhone);
    const hmac = hmacIndex(normalized, true);
    const dup = await prisma.users.findFirst({ where: { phone_hmac: hmac, id: { not: req.user.userId } } });
    if (dup) throw new AppError(11003, '该手机号已绑定其他账号');
    await prisma.users.update({
      where: { id: req.user.userId },
      data: {
        phone_cipher: isCryptoConfigured() ? encrypt(normalized) : `PLAIN_DEV:${normalized}`,
        phone_hmac: hmac,
      },
    });
    res.json({ code: 0, data: { phoneMasked: maskPhone(normalized) }, requestId: res.locals.requestId });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/admin-login —— 后台账密登录（失败锁定 30min，架构 §10.1）
// ---------------------------------------------------------------------------
authRouter.post('/admin-login', loginRateLimit, validateBody(adminLoginSchema), async (req, res, next) => {
  try {
    const input = parseOrThrow(adminLoginSchema, req.body);
    const failKey = REDIS_KEYS.adminLoginFail(input.username);
    const fails = Number((await redis.get(failKey)) ?? '0');
    if (fails >= Number(process.env.ADMIN_LOGIN_FAIL_MAX ?? 5)) {
      throw new AppError(11009, '登录失败次数过多，请 30 分钟后再试');
    }
    const admin = await prisma.admins.findUnique({ where: { username: input.username }, include: { role: true } });
    const bcrypt = await import('bcryptjs');
    const ok = admin && admin.status === 'ACTIVE' && (await bcrypt.compare(input.password, admin.password_hash));
    if (!ok || !admin) {
      await redis.set(failKey, String(fails + 1), 'EX', Number(process.env.ADMIN_LOGIN_LOCK_MIN ?? 30) * 60);
      throw new AppError(11006);
    }
    await redis.del(failKey);
    const { signAdminToken } = await import('../../common/jwt');
    const token = signAdminToken({ sub: admin.id.toString(), roleKey: admin.role?.role_key ?? 'cs' });
    await prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
    res.json({
      code: 0,
      data: {
        accessToken: token,
        admin: { id: admin.id.toString(), username: admin.username, realName: admin.real_name, roleKey: admin.role?.role_key ?? 'cs' },
      },
      requestId: res.locals.requestId,
    });
  } catch (e) {
    next(e);
  }
});

/** 后台登录限流：IP 级 loginRateLimit + 用户名失败计数（Redis）双保险 */

/** 签发双 token + 建立 Redis 会话 */
async function issueTokens(userId: bigint, role: user_role, status: user_status) {
  const accessToken = signAccessToken({ sub: userId.toString(), role, st: status });
  const refreshToken = signRefreshToken(userId);
  await touchSession(userId, Math.max(ACCESS_TOKEN_TTL_SEC, REFRESH_TOKEN_TTL_SEC));
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SEC };
}
