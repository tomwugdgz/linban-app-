// ============================================================================
// 邻伴 · verification 模块 service：到岗核销（动态码 + 人脸 + GPS 偏差）
// ----------------------------------------------------------------------------
// 到岗核销（架构 §6.2 2 / §8.1 门闩规则 2）：
//   1. 动态码：老人端出示 / 陪聊员扫码，6 位，TTL 300s（可配）；
//   2. 人脸：慧眼活体 + 与入驻底照比对 ≥ face_match_threshold；
//   3. GPS：签到坐标与订单地址偏差 ≤ gps_max_deviation（全精度不落库，
//      模糊化后写 gps_lat/gps_lng + gps_deviation_m）。
// 三项全过 → status=PASSED + arrived_at → order 推进 ARRIVED → IN_SERVICE。
// 任一不过 → status=FAILED + fail_reason（attempt_no 累加，可重试）。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  DYNAMIC_CODE_TTL_DEFAULT,
  FACE_MATCH_THRESHOLD_DEFAULT,
  GPS_FUZZY_MAX_M,
  GPS_FUZZY_MIN_M,
  GPS_MAX_DEVIATION_DEFAULT,
  REDIS_KEYS,
  SYSTEM_CONFIG_DEFAULTS,
  defaultConfigInt,
} from '@linban/shared';
import { prisma, withTransaction } from '../../infra/prisma';
import { redis } from '../../infra/redis';
import { getFaceVerifyAdapter } from '../../adapters/face';
import { getMapAdapter } from '../../adapters/map';
import { approxDistanceM } from '../order/order.service';
import { genDynamicCode } from '../../common/ids';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('verification');

async function getConfigInt(key: string): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  return row ? Number(row.config_value) : defaultConfigInt(key as keyof typeof SYSTEM_CONFIG_DEFAULTS);
}

// ---------------------------------------------------------------------------
// 动态码签发（老人端「到岗核销」页展示；架构 §6.2 2）
// ---------------------------------------------------------------------------

export async function issueArrivalCode(orderId: bigint, userId: bigint) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.elder_user_id !== userId && order.user_id !== userId) {
    throw new AppError(10004, '仅订单老人侧可出示动态码');
  }
  if (order.status !== 'ACCEPTED') throw new AppError(14002, '订单未接单或已过到岗阶段');

  const ttlSec = await getConfigInt('dynamic_code_ttl');
  const code = genDynamicCode(6);
  const now = new Date();
  await redis.set(REDIS_KEYS.verifyCode(orderId), code, 'EX', ttlSec);
  // 同步 DB 记录（留痕；Redis 为快速校验通道）
  const attemptNo =
    (await prisma.verifications.count({ where: { order_id: orderId, type: 'ARRIVAL' } })) + 1;
  await prisma.verifications.create({
    data: {
      order_id: orderId,
      companion_id: order.companion_id!,
      user_id: userId,
      type: 'ARRIVAL',
      status: 'PENDING',
      attempt_no: attemptNo,
      dynamic_code: code,
      code_mode: 'ELDER_SHOW',
      code_sent_at: now,
      code_expires_at: new Date(now.getTime() + ttlSec * 1000),
    },
  });
  return { dynamicCode: code, expiresInSec: ttlSec, attemptNo };
}

// ---------------------------------------------------------------------------
// 到岗核销提交（陪聊员端；架构 §6.2 2 三关齐过 → ARRIVED）
// ---------------------------------------------------------------------------

export interface ArrivalVerifyInput {
  orderId: bigint;
  companionUserId: bigint;
  dynamicCode: string;
  codeMode: 'ELDER_SHOW' | 'COMPANION_SCAN';
  faceScore: number;
  livenessScore: number;
  faceVerifyId: string;
  gpsLat: number;
  gpsLng: number;
}

export async function recordArrivalVerification(input: ArrivalVerifyInput) {
  const order = await prisma.orders.findUnique({
    where: { id: input.orderId },
    include: { companion: true },
  });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.companion?.user_id !== input.companionUserId) throw new AppError(14010, '非本单接单陪聊员');
  if (order.status !== 'ACCEPTED') throw new AppError(14002, `订单状态 ${order.status}，不可到岗核销`);

  // ---- 第 1 关：动态码 ----
  const cached = await redis.get(REDIS_KEYS.verifyCode(input.orderId));
  const pending = await prisma.verifications.findFirst({
    where: { order_id: input.orderId, type: 'ARRIVAL', status: 'PENDING' },
    orderBy: { attempt_no: 'desc' },
  });
  if (!pending) throw new AppError(16001, '无待核销记录（请老人先出示动态码）');
  const codeOk = (cached ?? pending.dynamic_code) === input.dynamicCode;
  if (!codeOk) {
    await prisma.verifications.update({
      where: { id: pending.id },
      data: { status: 'FAILED', fail_reason: '动态码不正确', code_verified_at: new Date() },
    });
    throw new AppError(16002, '动态码不正确');
  }
  if (pending.code_expires_at && pending.code_expires_at.getTime() < Date.now()) {
    await prisma.verifications.update({
      where: { id: pending.id },
      data: { status: 'EXPIRED', fail_reason: '动态码已过期' },
    });
    throw new AppError(16003, '动态码已过期，请老人重新出示');
  }

  // ---- 第 2 关：人脸（阈值来自 system_configs） ----
  const faceThreshold = await getConfigInt('face_match_threshold');
  const facePassed = input.faceScore >= faceThreshold && input.livenessScore >= 80;
  // ---- 第 3 关：GPS 偏差 ----
  const gpsMax = await getConfigInt('gps_max_deviation');
  const deviationM = approxDistanceM(input.gpsLat, input.gpsLng, Number(order.elder_lat), Number(order.elder_lng));
  const gpsPassed = deviationM <= gpsMax;

  // GPS 模糊化（百米级落库，架构 §5.3）
  const fuzzy = fuzzyLatLng(input.gpsLat, input.gpsLng);

  const now = new Date();
  const passed = facePassed && gpsPassed;

  const result = await withTransaction(async (tx) => {
    await tx.verifications.update({
      where: { id: pending.id },
      data: {
        status: passed ? 'PASSED' : 'FAILED',
        code_mode: input.codeMode,
        code_verified_at: now,
        face_score: input.faceScore,
        face_passed: facePassed,
        liveness_score: input.livenessScore,
        face_verify_id: input.faceVerifyId,
        gps_lat: fuzzy.lat,
        gps_lng: fuzzy.lng,
        gps_deviation_m: deviationM,
        arrived_at: passed ? now : null,
        fail_reason: passed ? null : !facePassed ? `人脸比对分 ${input.faceScore} 低于阈值 ${faceThreshold}` : `GPS 偏差 ${deviationM}m 超出 ${gpsMax}m`,
      },
    });
    if (passed) {
      const { count } = await tx.orders.updateMany({
        where: { id: input.orderId, status: 'ACCEPTED' },
        data: { status: 'ARRIVED', arrived_at: now },
      });
      if (count === 0) throw new AppError(14002, '订单状态已变化');
      await tx.order_timeline.create({
        data: {
          order_id: input.orderId,
          from_status: 'ACCEPTED',
          to_status: 'ARRIVED',
          action: 'verify-arrival',
          operator_type: 'COMPANION',
          operator_id: order.companion_id,
          reason: `动态码+人脸(${input.faceScore})+GPS(${deviationM}m)`,
        },
      });
    }
    return { passed, facePassed, gpsPassed, deviationM, faceScore: input.faceScore };
  });

  if (passed) {
    await redis.del(REDIS_KEYS.verifyCode(input.orderId));
    // 核销通过 → 服务开始（架构 §6.2：核销通过进入服务中）
    const { startService } = await import('../order/order.service');
    await startService(input.orderId);
  }
  log.info({ event: 'arrival-verification', orderId: input.orderId.toString(), passed, deviationM });
  return result;
}

// ---------------------------------------------------------------------------
// 完成确认的核销侧视图（order.confirmCompletion 写 verifications 的
// COMPLETION 行；此处提供查询与人工补录入口）
// ---------------------------------------------------------------------------

export async function getVerificationByOrder(orderId: bigint) {
  return prisma.verifications.findMany({
    where: { order_id: orderId },
    orderBy: { created_at: 'desc' },
  });
}

/** 客服人工补录完成确认（争议单：老人不会操作小程序，电话确认后补录） */
export async function csRecordCompletion(orderId: bigint, adminId: bigint, note: string) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  const now = new Date();
  const existing = await prisma.verifications.findFirst({ where: { order_id: orderId, type: 'COMPLETION' } });
  if (existing) {
    await prisma.verifications.update({
      where: { id: existing.id },
      data: {
        status: 'PASSED',
        companion_confirmed_at: existing.companion_confirmed_at ?? now,
        elder_confirmed_at: existing.elder_confirmed_at ?? now,
        completion_note: note,
      },
    });
  } else {
    await prisma.verifications.create({
      data: {
        order_id: orderId,
        companion_id: order.companion_id!,
        user_id: order.elder_user_id,
        type: 'COMPLETION',
        status: 'PASSED',
        attempt_no: 1,
        companion_confirmed_at: now,
        elder_confirmed_at: now,
        completion_note: note,
      },
    });
  }
  const { confirmCompletion } = await import('../order/order.service');
  const r = await confirmCompletion(orderId, 'COMPANION', undefined);
  void adminId;
  return r;
}

// ---------------------------------------------------------------------------
// 内部助手
// ---------------------------------------------------------------------------

/** GPS 模糊化（100–300m 精度：3 位小数 ≈110m） */
export function fuzzyLatLng(lat: number, lng: number): { lat: number; lng: number } {
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const f = { lat: round(lat), lng: round(lng) };
  // 精度自检：模糊后与原始偏差应在 [GPS_FUZZY_MIN_M, GPS_FUZZY_MAX_M] 内
  const drift = approxDistanceM(lat, lng, f.lat, f.lng);
  if (drift < GPS_FUZZY_MIN_M || drift > GPS_FUZZY_MAX_M * 2) {
    log.warn({ event: 'gps-fuzzy-drift', drift, lat, lng });
  }
  return f;
}

export { FACE_MATCH_THRESHOLD_DEFAULT, GPS_MAX_DEVIATION_DEFAULT, DYNAMIC_CODE_TTL_DEFAULT };
