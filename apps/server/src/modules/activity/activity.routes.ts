// ============================================================================
// 邻伴 · activity 模块路由：健康活动感知（架构 §13 / 契约 §13）
// ----------------------------------------------------------------------------
// 本批（第一批）实现范围——team-lead 放行信号：
//   POST   /activity/ingest                采集入口（门闩 6 道，幂等）
//   GET    /activity/report/daily          活动日报
//   GET    /activity/report/trend          活动趋势
//   GET    /activity/privacy               隐私中心
//   GET    /activity/devices               设备列表
//   POST   /activity/devices/bind          绑定探针（先授权后绑，幂等，明文令牌只返一次）
//   POST   /activity/devices/:id/unbind    解绑（令牌即时失效）
//   GET  /admin/activity/dashboard       管理端看板（只读聚合）
//   GET  /admin/activity/funnel          引流漏斗（只读聚合）
//   GET  /admin/activity/elders后台老人活动列表
//   POST /admin/activity/alerts/:id/ack      告警受理（A3 已定稿）
//   POST /admin/activity/alerts/:id/escalate 告警升级（A2 已定稿：工单 + SOS 出口并存）
//   POST /activity/alerts/:id/ack         子女确认已知晓（§13.6.1）
//   GET  /activity/recommend              陪聊推荐（A6 固定话术库，出参带 disclaimer）
//   GET  /admin/activity/revenue         订阅营收报表（revenue:read 独立科目，Q8）
//
// 暂缓（待放行）：
//   POST /admin/activity/alerts/:id/resolve（结案；等客服工作台权限面定稿）
//
// 红线纪律（三条，代码级）：
//   1. elderId 一律从 token 解析，**不接受端上传参**（防水平越权）；
//   2. 设备令牌走 X-Device-Token 头，明文不入库不入日志；
//   3. 出参强制携带 disclaimer（参考指标，非医疗诊断）。
// ============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { wifi_device_status, wifi_device_type } from '@prisma/client';
import { AppError, activity_consent_scope_level, activity_consent_status } from '@linban/shared';
import { authMiddleware, adminAuthMiddleware, adminPermGuard } from '../../middlewares/auth';
import { idempotencyMiddleware } from '../../middlewares/rate-limit';
import { sendOk } from '../../common/errors';
import { idSchema, localDateSchema, parseOrThrow } from '../../common/validation';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { ACTIVITY_DISCLAIMER, CONFIDENCE_DISPLAY_FLOOR, getDailyReport, getTrendReport } from './report.service';
import { getDashboard, getFunnel, listElderActivities } from './admin.service';
import { getRevenueReport } from './revenue.service';
import { ackAlert, escalateAlert } from './alert.service';
import { getRecommend } from './recommend.service';
import { getSignalTtlSec, ingestSignal } from './ingest.service';
import { assertActivityReadable, evaluateConsent, getWatchEnabled, revokeConsent } from './consent.service';
import { bindDevice, unbindDevice } from './device.service';
import { ACTIVITY_SCOPE } from '../../domain/activity-consent';

const log = moduleLogger('activity');

export const activityRouter = Router();
export const activityAdminRouter = Router();

// ---------------------------------------------------------------------------
// 采集入参校验（zod；原文字段仅存在于内存，见ingest.sanitize）
// ---------------------------------------------------------------------------
const ingestSchema = z.object({
  deviceNo: z.string().min(4).max(32),
  windowStart: z.string().datetime({ offset: true }),
  windowMinutes: z.number().int().min(1).max(1440),
  // 网络标识原文：可空，长度受限（防超大入参）
  ssid: z.string().max(64).nullish(),
  bssid: z.string().max(32).nullish(),
  mac: z.string().max(32).nullish(),
  features: z.record(z.string(), z.number()).nullish(),
});

// ---------------------------------------------------------------------------
// POST /activity/ingest —— 采集入口
// ---------------------------------------------------------------------------
activityRouter.post('/ingest', authMiddleware, idempotencyMiddleware, async (req, res, next) => {
  try {
    const input = parseOrThrow(ingestSchema, req.body);
    const deviceToken = (req.headers['x-device-token'] as string | undefined) ?? '';
    // 数据主体一律取 token（契约硬要求）
    const result = await ingestSignal(
      req.user!.userId,
      input.deviceNo,
      deviceToken,
      {
        ssid: input.ssid ?? null,
        bssid: input.bssid ?? null,
        mac: input.mac ?? null,
        window_start: new Date(input.windowStart),
        window_minutes: input.windowMinutes,
        features: input.features ?? null,
      },
    );
    sendOk(res, result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /activity/report/daily —— 活动日报
// ---------------------------------------------------------------------------
activityRouter.get('/report/daily', authMiddleware, async (req, res, next) => {
  try {
    const q = parseOrThrow(z.object({ date: localDateSchema.optional() }), req.query);
    const date = q.date ? new Date(`${q.date}T00:00:00.000Z`) : yesterdayUtc();
    const report = await getDailyReport(req.user!.userId, date, await getSignalTtlSec());
    // 置信度不足：仅回分级与依据码，不出趋势结论
    if (report.confidence < CONFIDENCE_DISPLAY_FLOOR && report.status !== 'UNKNOWN') {
      throw new AppError(23002, '数据置信度不足，结论仅供参考');
    }
    sendOk(res, report);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /activity/report/trend —— 活动趋势（聚合，非实时轨迹）
// ---------------------------------------------------------------------------
activityRouter.get('/report/trend', authMiddleware, async (req, res, next) => {
  try {
    const q = parseOrThrow(
      z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
      req.query,
    );
    const days = q.days ?? 7;
    const report = await getTrendReport(
      req.user!.userId,
      daysAgoUtc(days - 1),
      days,
      await getSignalTtlSec(),
    );
    sendOk(res, report);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /activity/privacy —— 隐私中心
// ---------------------------------------------------------------------------
activityRouter.get('/privacy', authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const [consent, scopes, devices] = await Promise.all([
      prisma.activity_consents.findUnique({
        where: { elder_user_id: userId },
        include: { scopes: { where: { revoked_at: null }, include: { family_binding: true } } },
      }),
      prisma.activity_consent_scopes.findMany({
        where: { consent: { elder_user_id: userId }, revoked_at: null },
        include: { family_binding: { include: { family_user: { select: { id: true, nickname: true } } } } },
      }),
      prisma.wifi_devices.findMany({
        where: { elder_user_id: userId },
        select: { id: true, status: true, collect_enabled: true, bound_at: true, last_heartbeat_at: true },
      }),
    ]);

    sendOk(res, {
      collecting: await getWatchEnabled()
        && consent?.status === activity_consent_status.GRANTED
        && devices.every((d) => d.collect_enabled),
      consentStatus: consent?.status ?? activity_consent_status.PENDING,
      policyVersion: consent?.policy_version ?? null,
      grantedAt: consent?.granted_at ?? null,
      revokedAt: consent?.revoked_at ?? null,
      collectStoppedAt: consent?.collect_stopped_at ?? null,
      // 留存截止：取最近一条信号的清理时点（红线⑥≤14 天）
      retentionUntil: await latestRetainedUntil(userId),
      // 「谁在看我」：生效中的绑定 + 其可见档位
      viewers: scopes.map((s) => ({
        bindingId: s.family_binding_id.toString(),
        relation: s.family_binding?.relation ?? null,
        viewerLevel: s.viewer_level,
        bindingActive: s.family_binding?.active_key === 'A',
        nickname: s.family_binding?.family_user?.nickname ?? null,
      })),
      devices: devices.map((d) => ({
        id: d.id.toString(),
        status: d.status,
        collectEnabled: d.collect_enabled,
        boundAt: d.bound_at,
        lastHeartbeatAt: d.last_heartbeat_at,
      })),
      disclaimer: ACTIVITY_DISCLAIMER,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /activity/privacy/revoke —— 一键关闭（契约 §13.3，幂等，红线④/⑦）
//
// 纪律：consents 置 REVOKED 与「所有设备置停采」**必须同时执行**。
// 只改 consents 会让 GET /privacy 的 collecting 口径漂移（它 = 总开关开 且 授权
// 有效 且 所有设备未停采 三者合取），出现「已一键关闭但 collecting 仍为 true」
// 的自相矛盾状态——这种 bug 会直接摧毁用户对隐私承诺的信任。
//
// 撤销与清理解耦（主理人裁定②）：此处只做「即时停采 + 标记待清理」，
// 未聚合原始数据由 retention sweep 异步清理，完成后回写 purge_status=CONFIRMED。
// ---------------------------------------------------------------------------
activityRouter.post('/privacy/revoke', authMiddleware, async (req, res, next) => {
  try {
    const now = new Date();
    const userId = req.user!.userId;
    const result = await revokeConsent(userId, now);
    // 设备侧同步停采 + 令牌失效（与 consents 同批；不可省）
    await prisma.wifi_devices.updateMany({
      where: { elder_user_id: userId },
      data: {
        collect_enabled: false,
        disabled_at: now,
        // REVOKED 而非 UNBOUND：schema 注释明写「REVOKED = 老人撤销授权（红线⑦）」，
        // UNBOUND 留给「用户主动解绑单设备」。置错会让 ingest 闸 3 的 REVOKED
        // 分支永远走不到，这个枚举值就成了死值。
        status: wifi_device_status.REVOKED,
        device_token_hash: null,
        token_expires_at: null,
      },
    });
    log.info(
      { event: 'activity-privacy-revoke', elder: String(userId), purgeStatus: result.purgeStatus },
      '老人一键关闭健康活动感知（采集即时停止，清理异步执行）',
    );
    sendOk(res, result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /activity/devices/bind —— 绑定探针（契约 §13.3）
// 纪律：**先授权后绑设备**（未授权 22001，不得反向）；device_no 服务端生成，
// 明文 deviceToken 仅本次返回，重复 bind 幂等回放不重签（否则客户端旧令牌
// 立即失效，而明文不可从库里取回）。
// ---------------------------------------------------------------------------
const bindDeviceSchema = z.object({
  // MVP 仅 APP_PROBE（通道A零硬件）；GATEWAY 是 W+1，服务端明确拒绝而非静默降级
  deviceType: z.enum(['APP_PROBE']).default('APP_PROBE'),
  // MAC 原文仅在内存过一道，落库只留 HMAC（红线②）
  mac: z.string().max(32).nullish(),
  vendor: z.string().max(64).nullish(),
  model: z.string().max(64).nullish(),
  heartbeatIntervalSec: z.number().int().min(15).max(3600).nullish(),
});

activityRouter.post('/devices/bind', authMiddleware, async (req, res, next) => {
  try {
    const input = parseOrThrow(bindDeviceSchema, req.body ?? {});
    const result = await bindDevice(req.user!.userId, {
      deviceType: input.deviceType as wifi_device_type,
      mac: input.mac ?? null,
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      heartbeatIntervalSec: input.heartbeatIntervalSec ?? null,
    });
    sendOk(res, result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /activity/devices/:id/unbind —— 解绑（令牌即时失效）
// ---------------------------------------------------------------------------
activityRouter.post('/devices/:id/unbind', authMiddleware, async (req, res, next) => {
  try {
    const params = parseOrThrow(z.object({ id: idSchema }), req.params);
    const result = await unbindDevice(req.user!.userId, BigInt(params.id));
    sendOk(res, result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /activity/devices —— 设备列表（凭据为 X 态，不出参）
// ---------------------------------------------------------------------------
activityRouter.get('/devices', authMiddleware, async (req, res, next) => {
  try {
    const rows = await prisma.wifi_devices.findMany({
      where: { elder_user_id: req.user!.userId },
      orderBy: { created_at: 'desc' },
    });
    if (rows.length === 0) throw new AppError(22002, '感知设备未绑定');
    sendOk(res, {
      list: rows.map((d) => ({
        id: d.id.toString(),
        deviceNo: d.device_no,
        deviceType: d.device_type,
        status: d.status,
        collectEnabled: d.collect_enabled,
        heartbeatIntervalSec: d.heartbeat_interval_sec,
        lastHeartbeatAt: d.last_heartbeat_at,
        tokenExpiresAt: d.token_expires_at,
        boundAt: d.bound_at,
        // X 态：device_token_hash / device_mac_hmac / ssid_hmac / bssid_hmac 绝不出参
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/activity/dashboard —— 管理端看板（只读聚合）
// ---------------------------------------------------------------------------
activityAdminRouter.get(
  '/activity/dashboard',
  adminAuthMiddleware,
  adminPermGuard('risk:read'),
  async (_req, res, next) => {
    try {
      sendOk(res, await getDashboard(await getSignalTtlSec()));
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/activity/elders —— 后台老人活动列表（契约 §13.6）
// 出参含五件套 + explainCode 中文释义 + 近 7 日 sparkline；
// UNKNOWN 与信号过期行带 partition='UNKNOWN_OR_STALE'，
// 端上必须单独视觉分区，禁止与正常状态混排。
// ---------------------------------------------------------------------------
activityAdminRouter.get(
  '/activity/elders',
  adminAuthMiddleware,
  adminPermGuard('risk:read'),
  async (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          status: z
            .union([
              z.enum(['ACTIVE', 'LOW', 'STILL', 'AWAY', 'UNKNOWN']),
              z.array(z.enum(['ACTIVE', 'LOW', 'STILL', 'AWAY', 'UNKNOWN'])),
            ])
            .optional(),
          stale: z.enum(['true', 'false']).optional(),
          days: z.coerce.number().int().min(1).max(30).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
        }),
        req.query,
      );
      const statuses = q.status === undefined ? undefined : Array.isArray(q.status) ? q.status : [q.status];
      sendOk(
        res,
        await listElderActivities({
          statuses: statuses as never,
          stale: q.stale === undefined ? undefined : q.stale === 'true',
          days: q.days,
          page: q.page,
          pageSize: q.pageSize,
          ttlSec: await getSignalTtlSec(),
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/activity/funnel —— 引流漏斗（7 层 + community/trigger/date 三维归因）
// ---------------------------------------------------------------------------
activityAdminRouter.get(
  '/activity/funnel',
  adminAuthMiddleware,
  adminPermGuard('risk:read'),
  async (req, res, next) => {
    try {
      const q = parseOrThrow(z.object({ days: z.coerce.number().int().min(1).max(90).optional() }), req.query);
      sendOk(res, await getFunnel(q.days ?? 30));
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/activity/alerts/:id/ack —— 客服工作台受理（A3 已定稿）
// 幂等：重复 ack 回放首次结果（ack_by / ack_by_role / ack_at），不覆盖首次受理人。
// 非 OPEN 且非 ACKNOWLEDGED → 24007；ACK 侧重复 → 回放成功。
// ---------------------------------------------------------------------------
activityAdminRouter.post(
  '/activity/alerts/:id/ack',
  adminAuthMiddleware,
  adminPermGuard('risk:*'),
  async (req, res, next) => {
    try {
      const params = parseOrThrow(z.object({ id: idSchema }), req.params);
      sendOk(
        res,
        await ackAlert({
          alertId: BigInt(params.id),
          actorId: req.admin!.adminId,
          actorRole: 'ADMIN',
          requestId: res.locals.requestId as string | undefined,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /activity/alerts/:id/ack —— 子女确认已知晓（契约 §13.6.1）
//越权面：告警必须属于该登录者有权限的老人（assertActivityReadable统一 23004）。
// ---------------------------------------------------------------------------
activityRouter.post('/alerts/:id/ack', authMiddleware, async (req, res, next) => {
  try {
    const params = parseOrThrow(z.object({ id: idSchema }), req.params);
    const alertId = BigInt(params.id);
    // 先查告警归属的老人，再用 assertActivityReadable 判越权（不区分「不存在」与「无权限」）
    const alert = await prisma.health_alerts.findUnique({
      where: { id: alertId },
      select: { elder_user_id: true },
    });
    if (!alert) throw new AppError(24001, '告警不存在');
    await assertActivityReadable(
      req.user!.userId,
      alert.elder_user_id,
      activity_consent_scope_level.ALERT_ONLY,
    );
    sendOk(
      res,
      await ackAlert({
        alertId,
        actorId: req.user!.userId,
        actorRole: 'USER',
        requestId: res.locals.requestId as string | undefined,
      }),
    );
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /activity/recommend —— 陪聊推荐（契约 §13.4，A6固定话术库）
// 红线：出参强制带 disclaimer；**给老人的文案不得暗示健康依据**——
// 触发器与依据只供后台归因，前端展示 items[].text 即可。
// 越权面：子女代看走 elderId 入参 + assertActivityReadable；老人本人走 token。
// ---------------------------------------------------------------------------
const recommendSchema = z.object({
  elderId: idSchema.optional(),
});

activityRouter.get('/recommend', authMiddleware, async (req, res, next) => {
  try {
    const q = parseOrThrow(recommendSchema, req.query);
    // 本人 → 用 token 里的 userId（不接受端上传 elderId 覆盖本人）
    // 子女代看 → 端上传 elderId，越权统一 23004
    const elderUserId = q.elderId ? BigInt(q.elderId) : req.user!.userId;
    if (elderUserId !== req.user!.userId) {
      await assertActivityReadable(
        req.user!.userId,
        elderUserId,
        activity_consent_scope_level.ALERT_ONLY,
      );
    }
    sendOk(res, await getRecommend(elderUserId, { newInstall: false }));
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/activity/alerts/:id/escalate —— 升级对外追责
// 交叉验证门闩不可绕过：不通过 → 24004（由 alert.service 内domain 判定）；
// 放行后**工单 + SOS 出口两条并存**（主理人裁定）：落 complaints
// （complainant_id 记系统服务账号 role=SYSTEM）+ audit_logs 留痕（Q11），
// 同时复用 SOS 出口（挂起到岗态订单 + 绑定子女 IM 通知）。出口失败不回滚工单。
// ---------------------------------------------------------------------------
activityAdminRouter.post(
  '/activity/alerts/:id/escalate',
  adminAuthMiddleware,
  adminPermGuard('risk:*'),
  async (req, res, next) => {
    try {
      const params = parseOrThrow(z.object({ id: idSchema }), req.params);
      const body = parseOrThrow(
        z.object({
          channelAValid: z.boolean(),
          channelBValid: z.boolean(),
          crossSourceHit: z.boolean(),
        }),
        req.body,
      );
      sendOk(
        res,
        await escalateAlert(
          BigInt(params.id),
          req.admin!.adminId,
          body,
          res.locals.requestId as string | undefined,
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/activity/revenue —— 订阅营收报表（契约 §13.6，权限点 revenue:read）
//
// 权限点纪律（Q8）：**刻意不复用** payment:* / config:read / risk:*。
// 复用会让「营收与分账的隔离」在 RBAC 层就是假的——
// 能看分账的人自动能看订阅营收，而这两笔钱的性质完全不同。
// revenue:read 已落三处双写面：seed.ts PERMISSIONS/ROLES、
// auth.ts ROLE_PERMISSIONS（finance 持有）、admin-web shared/permissions.ts。
//
// 窗口口径：默认「本自然月至今」，可用 ?start=YYYY-MM-DD&end=YYYY-MM-DD 覆盖。
// 取默认自然月而非「近30 天」的原因：财务科目按月对账，
// 近 30 天窗口跨月会让月度数字与账期对不上。
// ---------------------------------------------------------------------------
activityAdminRouter.get(
  '/activity/revenue',
  adminAuthMiddleware,
  adminPermGuard('revenue:read'),
  async (req, res, next) => {
    try {
      const q = parseOrThrow(
        z.object({
          start: localDateSchema.optional(),
          end: localDateSchema.optional(),
          months: z.coerce.number().int().min(1).max(24).optional(),
        }),
        req.query,
      );
      const { windowStart, windowEnd } = resolveWindow(q.start, q.end);
      if (windowEnd.getTime() <= windowStart.getTime()) {
        throw new AppError(10001, '统计窗口无效：结束日期须晚于开始日期');
      }
      sendOk(
        res,
        await getRevenueReport({
          windowStart,
          windowEnd,
          months: q.months ?? 6,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// 助手
// ---------------------------------------------------------------------------

/** 昨日 UTC 零点 */
function yesterdayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** N 天前 UTC 零点 */
function daysAgoUtc(days: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * 统计窗口解析（闭开区间 [start, end)）。
 *
 * 默认：本自然月 [月初, 次月初) —— **不是**「今天」。用今天作终点会让
 * 本月数只覆盖半个月，运营按月环比时永远对不上账期。
 * 传了 end 时按 [start, end+1天) 处理：入参是「含当日」的日期语义，
 * 但内部区间是排他终点，少加一天会漏掉当天的订阅（表现为月末少一笔）。
 */
function resolveWindow(start?: string, end?: string): { windowStart: Date; windowEnd: Date } {
  const now = new Date();
  if (start && end) {
    // end 入参是「含当日」，内部区间终点排他 → +1 天，否则漏掉 end 当天的订阅
    return {
      windowStart: new Date(`${start}T00:00:00.000Z`),
      windowEnd: new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 86_400_000),
    };
  }
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (start && !end) {
    // 只给 start → 该日到本月月末
    const s = new Date(`${start}T00:00:00.000Z`);
    return { windowStart: s, windowEnd: nextMonthStart.getTime() > s.getTime() ? nextMonthStart : s };
  }
  if (!start && end) {
    // 只给 end → 该月月初到该日+1
    const e = new Date(`${end}T00:00:00.000Z`);
    const s = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 1));
    const eNext = new Date(e.getTime() + 86_400_000);
    return { windowStart: s, windowEnd: eNext };
  }
  return { windowStart: monthStart, windowEnd: nextMonthStart };
}

/** 最近一条信号的留存截止时点（隐私中心展示用） */
async function latestRetainedUntil(elderUserId: bigint): Promise<string | null> {
  const row = await prisma.activity_signals.findFirst({
    where: { elder_user_id: elderUserId },
    orderBy: { window_start: 'desc' },
    select: { retained_until: true },
  });
  return row?.retained_until.toISOString() ?? null;
}

/** 供消费端复用：取某老人的当前采集状态（order/risk 层判断是否可读活动） */
export async function getCollectingState(elderUserId: bigint): Promise<boolean> {
  const consent = await prisma.activity_consents.findUnique({
    where: { elder_user_id: elderUserId },
    select: { status: true },
  });
  if (!(await getWatchEnabled()) || consent?.status !== activity_consent_status.GRANTED) return false;
  const gate = await evaluateConsent(elderUserId, ACTIVITY_SCOPE.SUMMARY);
  return gate.allowed;
}

log.debug('activity 路由已挂载（第一批 7 端点；A1–A6 相关端点暂缓）');