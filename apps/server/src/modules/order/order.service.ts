// ============================================================================
// 邻伴 · order 模块 service：下单/派单/抢单/取消/服务流（架构 §6.1/§6.2）
// ----------------------------------------------------------------------------
// 时段防重双防线（架构 §6.1 4）：
//   第一道 Redis 锁 lock:slot:<companionId>:<serviceDate>#<slot>（10min）；
//   第二道 DB 唯一索引 (companion_id, service_date, slot_start, slot_guard)：
//     接单时回填 companion_id + guard='L'，冲突即 P2002 → 14003；
//     取消/退款 guard 置 NULL 释放时段（可重新售出）。
// 状态推进全部经 domain/order-state-machine 校验，order_timeline 逐次留痕。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  DISPATCH_TIMEOUT_MIN_DEFAULT,
  GRAB_LOCK_TTL_MIN,
  NIGHT_ORDER_END_HOUR,
  NIGHT_ORDER_START_HOUR,
  ORDER_PAY_TIMEOUT_MIN,
  REDIS_KEYS,
  SLOT_LOCK_TTL_MIN,
  SYSTEM_CONFIG_DEFAULTS,
  defaultConfigInt,
} from '@linban/shared';
import type { cancel_initiator, order_status, operator_type } from '@linban/shared';
import { prisma, withTransaction } from '../../infra/prisma';
import { redis } from '../../infra/redis';
import { acquireLock, releaseLock } from '../../infra/redis';
import { calcOrderAmount } from '../../domain/commission';
import {
  assertTransition,
  canTransition,
  cancelNeedsRefund,
  triggersSharing,
} from '../../domain/order-state-machine';
import { isSlotCoveredBySchedules, slotGuardForStatus, slotOccupancyKey, slotsOverlap } from '../../domain/slot-guard';
import {
  nightConfirmOverdue,
  nightSelfConfirmExempt,
  serviceOvertimeSuspendDue,
  sosSuspendable,
} from '../../domain/safety-suspend';
import { rankDispatchCandidates } from '../../domain/dispatch';
import type { DispatchCandidate } from '../../domain/dispatch';
import { calcCouponDeduct, needsBackfillLog } from '../../domain/coupon-deduct';
import { applyCredit } from '../companion/companion.service';
import { encrypt, isCryptoConfigured, maskAddress } from '../../common/crypto';
import type { AddressVisibility } from '../../common/crypto';
import { genBizNo } from '../../common/ids';
import { enqueue } from '../../infra/queue';
import { QUEUE_NAMES } from '@linban/shared';
import { moduleLogger } from '../../common/logger';
import type { SplitMode } from '@linban/shared';

const log = moduleLogger('order');

/** 券抵扣拒绝原因 → 用户可读文案（勿暴露内部术语） */
function couponDeductRejectMessage(reason: string | undefined): string {
  switch (reason) {
    case 'COUPON_EXPIRED':
      return '优惠券已过期';
    case 'COUPON_TEMPLATE_ENDED':
      return '优惠券不可用（未投放或数据异常）';
    case 'COUPON_ZERO_VALUE':
      // DURATION 类券也走这里 —— 告诉用户"该券本单不可用"，
      // 而不是"面额为0"（后者会让用户以为是系统 bug）
      return '该优惠券本单不可用（面额类型不支持直接抵扣金额）';
    case 'COUPON_EXCEEDS_ORDER':
      return '优惠券面额超过订单金额';
    default:
      return '优惠券不可用';
  }
}

/** 取消违约金率默认基点（1000 = 10%）。
 *  真值走 system_configs.cancel_penalty_rate_bp（后台可配，改动落审计）；
 *  此常量仅作**回落默认值**与单测基准，不得再当硬编码口径用。
 *  （原CANCELLATION_FEE_RATE_BP 常量硬编码在业务里，改动无留痕——已移除。） */
export const DEFAULT_CANCEL_PENALTY_RATE_BP = 1000;

/** 违约金比例配置键（system_configs；基点，1000=10%） */
export const CANCEL_PENALTY_CONFIG_KEY = 'cancel_penalty_rate_bp';

/** 本地（广州 UTC+8）日期时分 → UTC Date（MVP 单城固定偏移，无 DST） */
export function localToUtc(dateStr: string, hm: string): Date {
  const d = new Date(`${dateStr}T${hm}:00+08:00`);
  if (Number.isNaN(d.getTime())) throw new AppError(10001, '日期时间格式不合法');
  return d;
}

/** UTC → 本地日期字符串（YYYY-MM-DD） */
export function utcToLocalDate(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/** UTC → 本地时分（HH:mm） */
export function utcToLocalHm(d: Date): string {
  const shifted = new Date(d.getTime() + 8 * 3600_000);
  return shifted.toISOString().slice(11, 16);
}

/** 是否夜间时段（本地 22:00–06:00） */
export function isNightSlot(slotStartUtc: Date): boolean {
  const h = Number(utcToLocalHm(slotStartUtc).slice(0, 2));
  return h >= NIGHT_ORDER_START_HOUR || h < NIGHT_ORDER_END_HOUR;
}

async function getConfigInt(key: string): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  return row ? Number(row.config_value) : defaultConfigInt(key as keyof typeof SYSTEM_CONFIG_DEFAULTS);
}

/**
 * 读取消违约金比例（基点）。
 * 合法区间 [0, 10000]（0%–100%）：越界回落默认——
 *后台配错不该让订单金额算出负数或超过订单总额，那是资损而不是配置容错。
 */
export async function getCancelPenaltyRateBp(): Promise<bigint> {
  const raw = await getConfigInt(CANCEL_PENALTY_CONFIG_KEY);
  if (!Number.isFinite(raw) || raw < 0 || raw > 10000) {
    log.warn(
      { event: 'config-invalid', key: CANCEL_PENALTY_CONFIG_KEY, value: raw },
      '取消违约金比例配置越界，回落默认值',
    );
    return BigInt(DEFAULT_CANCEL_PENALTY_RATE_BP);
  }
  return BigInt(Math.floor(raw));
}

// ---------------------------------------------------------------------------
// 创建订单（架构 §6.1 1）
// ---------------------------------------------------------------------------

export interface CreateOrderInput {
  userId: bigint;
  elderUserId: bigint;
  /** 指定陪聊员（浏览后下单可选）；不指定走派单引擎 */
  companionId?: bigint | null;
  durationMinutes: number;
  serviceDate: string; // 本地 YYYY-MM-DD
  startTime: string; // 本地 HH:mm
  address: string; // 服务地址（明文进，加密存）
  addressLat: number; // 全精度（服务端模糊化后落库）
  addressLng: number;
  couponUserCouponId?: bigint | null;
  giftCardId?: bigint | null;
  remark?: string;
  createdVia?: 'ELDER_APP' | 'FAMILY_APP' | 'CS';
}

export async function createOrder(input: CreateOrderInput) {
  const slotStartUtc = localToUtc(input.serviceDate, input.startTime);
  const slotEndUtc = new Date(slotStartUtc.getTime() + input.durationMinutes * 60_000);
  if (slotStartUtc.getTime() < Date.now() - 60_000) {
    throw new AppError(14017, '服务开始时间不能早于当前');
  }
  // 预约提前量：至少提前 2 小时（派单 + 老人准备）
  if (slotStartUtc.getTime() < Date.now() + 2 * 3600_000) {
    throw new AppError(10001, '需至少提前 2 小时预约');
  }

  // 夜间单控制
  const night = isNightSlot(slotStartUtc);
  if (night) {
    const enabled = (await getConfigInt('night_order_enabled')) === 1 || process.env.NIGHT_ORDER_ENABLED === 'true';
    if (!enabled) throw new AppError(14006, '夜间订单（22:00–06:00）暂未开放');
  }

  // 下单账号校验
  const buyer = await prisma.users.findUnique({ where: { id: input.userId } });
  if (!buyer || buyer.status !== 'ACTIVE') throw new AppError(10002, '下单账号异常');
  if (buyer.role === 'COMPANION') throw new AppError(14016, '陪聊员账号不能下单');
  const elder = await prisma.users.findUnique({
    where: { id: input.elderUserId },
    include: { elder_profile: true },
  });
  if (!elder || elder.role !== 'ELDER') throw new AppError(12001, '服务对象必须是老人账号');

  // 夜间单豁免（口径 A，team-lead 裁定④）：下单账号 == 老人本人 且已满 18 岁 → 老人自确认；
  // 子女代下单一律走子女确认（30min 时限，超时 sweep 自动取消+全额退款）。
  let nightSelfConfirmed = false;
  if (night) {
    nightSelfConfirmed = nightSelfConfirmExempt(
      input.userId === input.elderUserId,
      elder.elder_profile?.birthday ?? null,
      new Date(),
    );
  }

  // 指定陪聊员：可用性校验
  if (input.companionId) {
    const companion = await prisma.companions.findUnique({ where: { id: input.companionId } });
    if (!companion || companion.status !== 'ACTIVE') throw new AppError(13011, '指定陪聊员不可约');
    // 时段占用校验（含指定单防重）
    const occupied = await prisma.orders.findMany({
      where: {
        companion_id: companion.id,
        service_date: new Date(`${input.serviceDate}T00:00:00.000Z`),
        slot_guard: 'L',
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { slot_start: true, slot_end: true },
    });
    const conflict = occupied.find((o) =>
      slotsOverlap(
        { serviceDate: input.serviceDate, startTime: utcToLocalHm(o.slot_start), endTime: utcToLocalHm(o.slot_end) },
        { serviceDate: input.serviceDate, startTime: input.startTime, endTime: utcToLocalHm(slotEndUtc) },
      ),
    );
    if (conflict) throw new AppError(14003, '该陪聊员此时段已被占用');
  }

  // 计价（时薪：指定陪聊员取其档位；否则按平台默认档 25000 分，派单时以实际接单陪聊员时薪校正）
  const hourlyRateFen = input.companionId
    ? (await prisma.companions.findUnique({ where: { id: input.companionId } }))!.hourly_rate_fen
    : 25000n;
  /**
   * 券抵扣（主理人裁定 2026-10：快照优先，null 回退读模板 + 打日志）。
   *
   * 【为什么原来这里是 `BigInt(0) : 0n` 的占位】
   * 券核销当时标为"在 marketing 模块"但实际从未实现，等于用户有券也抵扣 0 元
   * —— 功能看起来正常（订单能下），钱少扣了，且不报错。
   *
   * 【双分支的过渡期语义】
   * `value_snapshot` 列已落，但**存量 user_coupons 行的快照全是 NULL**。
   *   1. 有快照 → 用快照（面额已冻结，改模板不影响存量券）
   *   2. 无快照 → 回退读模板 value，**并打结构化日志**统计待回填
   *回填上线后（第4 个迁移做批量 UPDATE）这段分支会自动减少到 0。
   */
  let couponDeductFen = 0n;
  if (input.couponUserCouponId) {
    const uc = await prisma.user_coupons.findFirst({
      where: { id: input.couponUserCouponId, user_id: input.userId },
      include: { coupon: { select: { id: true, type: true, value: true, status: true, valid_days: true } } },
    });
    if (!uc) throw new AppError(19204, '优惠券不存在或不属于该用户');
    if (uc.status !== 'UNUSED') throw new AppError(19206, '优惠券已使用或不可用');

    // 原价必须先算出来 —— 抵扣不能超过订单原价（calcCouponDeduct 需要它做钳制）
    const originalFen = calcOrderAmount({
      durationMinutes: input.durationMinutes,
      hourlyRateFen,
      couponDeductFen: 0n,
      giftCardDeductFen: 0n,
    }).originalAmountFen;

    const decided = calcCouponDeduct({
      userCouponId: uc.id,
      couponId: uc.coupon_id,
      couponType: uc.coupon.type,
      templateValue: uc.coupon.value,
      valueSnapshot: uc.value_snapshot,
      userCouponStatus: uc.status,
      expiredAt: uc.expired_at,
      templateStatus: uc.coupon.status,
      orderOriginalFen: originalFen,
      now: new Date(),
    });

    // 【回退分支日志 —— 回填完成度的唯一可观测手段，删不得】
    // 结构化字段是为了能 grep 出「哪些券还待回填」并按 couponId 聚合统计。
    // 只打一句话的话，运维永远查不出还剩多少、回填做完没有。
    if (needsBackfillLog(uc.value_snapshot)) {
      log.warn(
        {
          event: 'coupon-value-snapshot-null',
          userCouponId: uc.id.toString(),
          couponId: uc.coupon_id.toString(),
          couponType: uc.coupon.type,
          orderNo: null,
        },
        '券快照缺失，已回退读模板面额（存量待回填）',
      );
    }

    if (!decided.usable) {
      // 券本身不可用时不静默吞掉——用户选了券却没抵扣成功必须知道原因。
      // 19205「优惠券不可用」是契约既有码，detail 带具体 reason 供前端提示。
      throw new AppError(19205, couponDeductRejectMessage(decided.reason), {
        reason: decided.reason ?? 'UNKNOWN',
      });
    }
    couponDeductFen = decided.deductFen;
  }
  const giftDeduct = input.giftCardId ? BigInt(0) : 0n;
  const amount = calcOrderAmount({
    durationMinutes: input.durationMinutes,
    hourlyRateFen,
    couponDeductFen,
    giftCardDeductFen: giftDeduct,
  });

  // GPS 模糊化（百米级落库）
  const lat = Math.round(input.addressLat * 1000) / 1000;
  const lng = Math.round(input.addressLng * 1000) / 1000;

  const order = await withTransaction(async (tx) => {
    const created = await tx.orders.create({
      data: {
        order_no: genBizNo('order'),
        user_id: input.userId,
        elder_user_id: input.elderUserId,
        companion_id: input.companionId ?? null,
        status: 'CREATED',
        service_type: 'CHAT',
        duration_minutes: input.durationMinutes,
        service_date: new Date(`${input.serviceDate}T00:00:00.000Z`),
        slot_start: slotStartUtc,
        slot_end: slotEndUtc,
        slot_guard: slotGuardForStatus('CREATED'), // 'L'（companion_id 回填后唯一索引生效）
        hourly_rate_fen: hourlyRateFen,
        original_amount_fen: amount.originalAmountFen,
        coupon_deduct_fen: amount.couponDeductFen,
        gift_card_deduct_fen: amount.giftCardDeductFen,
        total_amount_fen: amount.totalAmountFen,
        address_cipher: isCryptoConfigured() ? encrypt(input.address) : `PLAIN_DEV:${input.address}`,
        geo_hash: encodeGeoHash(lat, lng, 5),
        elder_lat: lat,
        elder_lng: lng,
        night_order: night,
        // 豁免单：老人自确认落痕（confirmer=老人本人）；非豁免单留空待子女确认
        family_confirmer_id: night && nightSelfConfirmed ? input.elderUserId : null,
        family_confirmed_at: night && nightSelfConfirmed ? new Date() : null,
        remark: input.remark ?? null,
        idempotency_key: `order:${input.userId}:${input.serviceDate}:${input.startTime}:${Date.now()}`,
        created_via: input.createdVia ?? (buyer.role === 'FAMILY' ? 'FAMILY_APP' : 'ELDER_APP'),
        created_by: input.userId,
      },
    });
    // 券核销落库：与订单创建同一事务，要么都成功要么都回滚。
    //
    // 【条件更新防双花 —— 这是「抵扣但不核销」的漏洞】
    // 若这里用 prisma.user_coupons.update 无条件更新，两笔并发订单会**同时**
    // 把同一张券置 USED，两单都抵扣了同一张券的钱 = 直接资损。
    // 所以必须带 `status: 'UNUSED'` 前置条件，count===0 说明已被另一单核销。
    if (input.couponUserCouponId) {
      const claimed = await tx.user_coupons.updateMany({
        where: { id: input.couponUserCouponId, user_id: input.userId, status: 'UNUSED' },
        data: {
          status: 'USED',
          used_order_id: created.id,
          used_at: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new AppError(19206, '优惠券已被其它订单使用');
      }
    }
    await tx.order_timeline.create({
      data: {
        order_id: created.id,
        from_status: null,
        to_status: 'CREATED',
        action: 'create',
        operator_type: (buyer.role === 'FAMILY' ? 'USER' : 'USER') as operator_type,
        operator_id: input.userId,
        reason: input.remark ?? null,
      },
    });
    return created;
  });

  log.info({ event: 'order-created', orderNo: order.order_no, amountFen: order.total_amount_fen.toString() });
  return order;
}

// ---------------------------------------------------------------------------
// 支付成功（payment 回调调用）：CREATED → PAID
// ---------------------------------------------------------------------------

export async function markOrderPaid(orderId: bigint, paymentNo: string) {
  return withTransaction(async (tx) => {
    const order = await tx.orders.findUnique({ where: { id: orderId } });
    if (!order) throw new AppError(14001, '订单不存在');
    if (order.status === 'PAID') return { alreadyDone: true }; // 幂等
    assertTransition(order.status, 'PAID');
    const { count } = await tx.orders.updateMany({
      where: { id: orderId, status: 'CREATED' },
      data: { status: 'PAID' },
    });
    if (count === 0) throw new AppError(14002, `订单状态 ${order.status}，不可标记支付`);
    await tx.order_timeline.create({
      data: {
        order_id: orderId,
        from_status: 'CREATED',
        to_status: 'PAID',
        action: 'pay',
        operator_type: 'SYSTEM',
        reason: `支付单 ${paymentNo}`,
      },
    });
    return { alreadyDone: false };
  });
}

// ---------------------------------------------------------------------------
// 派单（架构 §6.1 2）：PAID → DISPATCHED，Top N 候选推送
// ---------------------------------------------------------------------------

export async function dispatchOrder(orderId: bigint) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.status !== 'PAID') throw new AppError(14002, `订单状态 ${order.status}，不可派单`);
  // 夜间单门闩（裁定④）：未完成子女确认不得派单
  assertNightConfirmed(order);

  // 指定陪聊员的单：直接置 DISPATCHED（推送通知其接单）
  if (order.companion_id) {
    const deadline = new Date(Date.now() + DISPATCH_TIMEOUT_MIN_DEFAULT * 60_000);
    await withTransaction(async (tx) => {
      const { count } = await tx.orders.updateMany({
        where: { id: orderId, status: 'PAID' },
        data: { status: 'DISPATCHED', dispatched_at: new Date(), dispatch_deadline_at: deadline },
      });
      if (count === 0) throw new AppError(14002, '订单状态已变化');
      await tx.order_timeline.create({
        data: {
          order_id: orderId,
          from_status: 'PAID',
          to_status: 'DISPATCHED',
          action: 'dispatch',
          operator_type: 'SYSTEM',
          reason: `指定陪聊员 ${order.companion_id}`,
        },
      });
    });
    // TODO(notification)：订阅消息推送接单提醒
    return { mode: 'assigned', deadlineAt: deadline.toISOString() };
  }

  // 派单引擎：候选查询 + 过滤 + 打分
  const geoPrefix = order.geo_hash.slice(0, 4);
  const serviceDate = order.service_date;
  const candidatesRaw = await prisma.companions.findMany({
    where: { status: 'ACTIVE', deleted_at: null, geo_hash: { startsWith: geoPrefix } },
    select: {
      id: true,
      tags: true,
      credit_score: true,
      level: true,
      rating_avg: true,
      completed_orders: true,
      hourly_rate_fen: true,
      anchor_lat: true,
      anchor_lng: true,
      schedules: true,
    },
  });

  // 时段占用（ guard='L' 的生效单）
  const occupied = await prisma.orders.findMany({
    where: { service_date: serviceDate, slot_guard: 'L', status: { notIn: ['CANCELLED', 'REFUNDED'] } },
    select: { companion_id: true, slot_start: true, slot_end: true },
  });

  const slot = {
    serviceDate: utcToLocalDate(serviceDate),
    startTime: utcToLocalHm(order.slot_start),
    endTime: utcToLocalHm(order.slot_end),
  };
  const elderInterests = (await prisma.elder_profiles.findUnique({ where: { user_id: order.elder_user_id } }))
    ?.interests as string[] | null | undefined;

  const candidates: DispatchCandidate[] = [];
  for (const c of candidatesRaw) {
    // 时段占用过滤
    const isOccupied = occupied.some(
      (o) =>
        o.companion_id === c.id &&
        slotsOverlap(slot, {
          serviceDate: slot.serviceDate,
          startTime: utcToLocalHm(o.slot_start),
          endTime: utcToLocalHm(o.slot_end),
        }),
    );
    if (isOccupied) continue;
    // 日程覆盖过滤
    const covered = isSlotCoveredBySchedules(
      slot,
      c.schedules.map((s) => ({
        date: s.date ? s.date.toISOString().slice(0, 10) : null,
        weekday: s.weekday,
        startTime: s.start_time,
        endTime: s.end_time,
        status: s.status as 'AVAILABLE' | 'BLACKOUT',
      })),
    );
    if (!covered) continue;
    // 距离（锚点 vs 订单地址，平面近似）
    const distanceM = approxDistanceM(Number(c.anchor_lat), Number(c.anchor_lng), Number(order.elder_lat), Number(order.elder_lng));
    candidates.push({
      companionId: c.id,
      distanceM,
      tags: c.tags as string[] | null,
      creditScore: c.credit_score,
      level: c.level,
      ratingAvg: Number(c.rating_avg),
      completedOrders: c.completed_orders,
      hourlyRateFen: c.hourly_rate_fen,
    });
  }

  const top = rankDispatchCandidates(candidates, { preferredTags: elderInterests ?? null }, 5, {
    maxHourlyRateFen: order.total_amount_fen > 0n ? undefined : undefined,
  });
  if (top.length === 0) throw new AppError(14008, '附近暂无合适陪聊员（已按距离/标签/信用过滤）');

  const deadline = new Date(Date.now() + DISPATCH_TIMEOUT_MIN_DEFAULT * 60_000);
  await withTransaction(async (tx) => {
    const { count } = await tx.orders.updateMany({
      where: { id: orderId, status: 'PAID' },
      data: { status: 'DISPATCHED', dispatched_at: new Date(), dispatch_deadline_at: deadline, distance_m: top[0]!.distanceM },
    });
    if (count === 0) throw new AppError(14002, '订单状态已变化');
    await tx.order_timeline.create({
      data: {
        order_id: orderId,
        from_status: 'PAID',
        to_status: 'DISPATCHED',
        action: 'dispatch',
        operator_type: 'SYSTEM',
        reason: `Top ${top.length} 候选`,
        extra: { candidates: top.map((c) => ({ id: c.companionId.toString(), distanceM: c.distanceM })) },
      },
    });
  });
  // TODO(notification)：向 Top N 推送抢单通知（订阅消息 + IM）
  return { mode: 'broadcast', candidateCount: top.length, deadlineAt: deadline.toISOString() };
}

// ---------------------------------------------------------------------------
// 抢单（架构 §6.1 3）：DISPATCHED → ACCEPTED（时段锁 + DB 唯一索引兜底）
// ---------------------------------------------------------------------------

export async function grabOrder(orderId: bigint, companionUserId: bigint) {
  const companion = await prisma.companions.findUnique({ where: { user_id: companionUserId } });
  if (!companion) throw new AppError(13001, '陪聊员主档不存在');
  if (companion.status !== 'ACTIVE') throw new AppError(13011, `陪聊员状态 ${companion.status}，不可接单`);
  if (companion.credit_score < (await getConfigInt('credit_freeze_threshold'))) {
    throw new AppError(13012, '信用分低于冻结阈值，已停止接单');
  }

  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.status !== 'DISPATCHED' && order.status !== 'PAID') {
    throw new AppError(14002, `订单状态 ${order.status}，不可接单`);
  }
  // 夜间单门闩（裁定④）：未完成子女确认不得接单
  assertNightConfirmed(order);
  if (order.companion_id && order.companion_id !== companion.id) {
    throw new AppError(14010, '该单已指定其他陪聊员');
  }

  const slotKey = REDIS_KEYS.slotLock(companion.id, slotOccupancyKey({
    serviceDate: utcToLocalDate(order.service_date),
    startTime: utcToLocalHm(order.slot_start),
    endTime: utcToLocalHm(order.slot_end),
  }));
  // 第一道防线：Redis 时段锁
  const token = await acquireLock(slotKey, SLOT_LOCK_TTL_MIN * 60_000);
  if (!token) throw new AppError(14004, '时段锁竞争失败，请重试');

  try {
    // 抢单互斥锁（防同一订单双接单）
    const grabToken = await acquireLock(REDIS_KEYS.grabLock(orderId), GRAB_LOCK_TTL_MIN * 60_000);
    if (!grabToken) throw new AppError(14018, '抢单竞争失败，请重试');
    try {
      return await withTransaction(async (tx) => {
        const { count } = await tx.orders.updateMany({
          where: { id: orderId, status: { in: ['DISPATCHED', 'PAID'] }, companion_id: order.companion_id ?? null },
          data: { companion_id: companion.id, status: 'ACCEPTED', accepted_at: new Date(), slot_guard: 'L' },
        });
        if (count === 0) throw new AppError(14002, '订单已被他人接单或状态已变化');
        await tx.order_timeline.create({
          data: {
            order_id: orderId,
            from_status: order.status,
            to_status: 'ACCEPTED',
            action: 'accept',
            operator_type: 'COMPANION',
            operator_id: companion.id,
          },
        });
        return { orderId: orderId.toString(), companionId: companion.id.toString(), status: 'ACCEPTED' as order_status };
      });
    } finally {
      await releaseLock(REDIS_KEYS.grabLock(orderId), grabToken);
    }
  } catch (e) {
    // 第二道防线：DB 唯一索引冲突（P2002）→ 时段占用
    if ((e as { code?: string }).code === 'P2002') {
      throw new AppError(14003, '该时段已被占用（唯一索引兜底）');
    }
    throw e;
  } finally {
    await releaseLock(slotKey, token);
  }
}

// ---------------------------------------------------------------------------
// 取消（架构 §6.2 3/§7.4）：状态推进 + guard 释放 + 退款 + 信用扣减
// ---------------------------------------------------------------------------

export async function cancelOrder(
  orderId: bigint,
  initiator: cancel_initiator,
  reason: string,
  operatorUserId?: bigint,
) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (!canTransition(order.status, 'CANCELLED')) {
    throw new AppError(14014, `订单状态 ${order.status} 不允许取消`);
  }

  // 违约金（MVP 规则：仅 ACCEPTED 后取消收违约金补偿陪聊员；ACCEPTED 前免费——team-lead 裁定①）
  // 比例读配置（后台可配），四舍五入到分：+5000n 后整除 10000n 是标准四舍五入
  let cancelFee = 0n;
  if (order.status === 'ACCEPTED' && order.companion_id) {
    const rateBp = await getCancelPenaltyRateBp();
    cancelFee = (order.total_amount_fen * rateBp + 5000n) / 10000n;
    // 比例被配错（负数/超 100%）时不得出现负违约金或超出订单金额的补偿
    if (cancelFee < 0n) cancelFee = 0n;
    if (cancelFee > order.total_amount_fen) cancelFee = order.total_amount_fen;
  }
  const refundAmount = cancelNeedsRefund(order.status) ? order.total_amount_fen - cancelFee : 0n;

  const result = await withTransaction(async (tx) => {
    const { count } = await tx.orders.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: 'CANCELLED',
        cancel_initiator: initiator,
        cancel_reason: reason,
        cancel_fee_fen: cancelFee,
        refund_amount_fen: refundAmount,
        slot_guard: slotGuardForStatus('CANCELLED'), // NULL：释放时段可重售
      },
    });
    if (count === 0) throw new AppError(14002, '订单状态已变化');
    await tx.order_timeline.create({
      data: {
        order_id: orderId,
        from_status: order.status,
        to_status: 'CANCELLED',
        action: 'cancel',
        operator_type: operatorUserId ? 'USER' : 'SYSTEM',
        operator_id: operatorUserId ?? null,
        reason,
        extra: { initiator, cancelFeeFen: cancelFee.toString(), refundAmountFen: refundAmount.toString() },
      },
    });
    return { cancelFeeFen: cancelFee, refundAmountFen: refundAmount };
  });

  // 已支付 → 退款链路（payment 模块，动态 import 破环）
  if (refundAmount > 0n) {
    const { refundOrder } = await import('../payment/payment.service');
    await refundOrder(orderId, refundAmount, `订单取消（${reason}）`, initiator);
    // 退款成功 → 终态闭环（裁定④整链：取消 → 原路退款 → 分账 RETURNED → REFUNDED）
    const { count: refundedCount } = await prisma.orders.updateMany({
      where: { id: orderId, status: 'CANCELLED' },
      data: { status: 'REFUNDED' },
    });
    if (refundedCount > 0) {
      await prisma.order_timeline.create({
        data: {
          order_id: orderId,
          from_status: 'CANCELLED',
          to_status: 'REFUNDED',
          action: 'refund-done',
          operator_type: 'SYSTEM',
          reason: `取消后退款完成（${refundAmount.toString()} 分）`,
        },
      });
    }
  }

  // 陪聊员取消扣信用分（−2，架构 §8.3；用户取消不扣陪聊员）
  if (initiator === 'COMPANION' && order.companion_id) {
    await applyCredit(order.companion_id, 'CANCEL', { reason: `取消订单 ${order.order_no}`, relatedOrderId: orderId });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 服务流：到岗 → 服务中 → 待确认（架构 §6.2 4）
// ---------------------------------------------------------------------------

/** ARRIVED → IN_SERVICE（开始服务，由到岗核销通过后调用） */
export async function startService(orderId: bigint) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  assertTransition(order.status, 'IN_SERVICE');
  const { count } = await prisma.orders.updateMany({
    where: { id: orderId, status: 'ARRIVED' },
    data: { status: 'IN_SERVICE', service_started_at: new Date() },
  });
  if (count === 0) throw new AppError(14002, '订单状态已变化');
  await prisma.order_timeline.create({
    data: { order_id: orderId, from_status: 'ARRIVED', to_status: 'IN_SERVICE', action: 'start', operator_type: 'COMPANION', operator_id: order.companion_id },
  });
}

/** IN_SERVICE → PENDING_CONFIRM（服务结束待双方确认） */
export async function finishService(orderId: bigint) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  assertTransition(order.status, 'PENDING_CONFIRM');
  const { count } = await prisma.orders.updateMany({
    where: { id: orderId, status: 'IN_SERVICE' },
    data: { status: 'PENDING_CONFIRM', service_ended_at: new Date(), pending_confirm_at: new Date() },
  });
  if (count === 0) throw new AppError(14002, '订单状态已变化');
  await prisma.order_timeline.create({
    data: { order_id: orderId, from_status: 'IN_SERVICE', to_status: 'PENDING_CONFIRM', action: 'finish', operator_type: 'COMPANION', operator_id: order.companion_id },
  });
}

// ---------------------------------------------------------------------------
// 完成确认（架构 §6.2 5）：双向确认 → COMPLETED → 触发分账
// ---------------------------------------------------------------------------

/**
 * 单方确认（COMPANION/USER）。双方都确认 → COMPLETED + 分账入队。
 * 老人侧支持语音「满意」关键词（ASR 转写后由 verification 模块透传）。
 */
export async function confirmCompletion(orderId: bigint, role: 'COMPANION' | 'USER', elderVoiceAsr?: string) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  if (order.status !== 'PENDING_CONFIRM') {
    throw new AppError(16010, `订单状态 ${order.status}，不在待确认阶段`);
  }

  const now = new Date();
  return withTransaction(async (tx) => {
    // COMPLETION 核销记录（upsert 幂等）
    let verification = await tx.verifications.findFirst({
      where: { order_id: orderId, type: 'COMPLETION' },
    });
    if (!verification) {
      verification = await tx.verifications.create({
        data: {
          order_id: orderId,
          companion_id: order.companion_id!,
          user_id: order.elder_user_id,
          type: 'COMPLETION',
          status: 'PENDING',
          attempt_no: 1,
          dynamic_code: `C${Date.now().toString().slice(-6)}`, // 完成确认无需动态码，占位
          companion_confirmed_at: role === 'COMPANION' ? now : null,
          elder_confirmed_at: role === 'USER' ? now : null,
          elder_voice_asr: elderVoiceAsr ?? null,
        },
      });
    } else {
      if (role === 'COMPANION' && verification.companion_confirmed_at) throw new AppError(16011, '您已确认过，等待对方确认');
      if (role === 'USER' && verification.elder_confirmed_at) throw new AppError(16011, '您已确认过，等待对方确认');
      await tx.verifications.update({
        where: { id: verification.id },
        data: {
          companion_confirmed_at: role === 'COMPANION' ? now : verification.companion_confirmed_at,
          elder_confirmed_at: role === 'USER' ? now : verification.elder_confirmed_at,
          elder_voice_asr: elderVoiceAsr ?? verification.elder_voice_asr,
        },
      });
      verification = (await tx.verifications.findUnique({ where: { id: verification.id } }))!;
    }

    const bothConfirmed = Boolean(verification.companion_confirmed_at && verification.elder_confirmed_at);
    if (!bothConfirmed) {
      return { completed: false, waiting: role === 'COMPANION' ? 'ELDER' : 'COMPANION' };
    }

    // 双方确认 → COMPLETED
    await tx.verifications.update({ where: { id: verification.id }, data: { status: 'PASSED' } });
    const { count } = await tx.orders.updateMany({
      where: { id: orderId, status: 'PENDING_CONFIRM' },
      data: { status: 'COMPLETED', completed_at: now },
    });
    if (count === 0) throw new AppError(14002, '订单状态已变化');
    await tx.order_timeline.create({
      data: { order_id: orderId, from_status: 'PENDING_CONFIRM', to_status: 'COMPLETED', action: 'confirm', operator_type: 'SYSTEM', reason: '双方确认完成' },
    });
    return { completed: true };
  }).then(async (r) => {
    if (r.completed) {
      // 触发分账（入队；门闩校验与执行在 payment 模块）
      await enqueue<{ orderId: string; attempt: number; trigger: 'complete' | 'retry' | 'sweep' }>(
        QUEUE_NAMES.profitSharing,
        'execute',
        { orderId: orderId.toString(), attempt: 0, trigger: 'complete' },
      );
      log.info({ event: 'order-completed', orderId: orderId.toString() });
    }
    return r;
  });
}

/** COMPLETED → CLOSED（评价完成或超时，review 模块/ cron 调用） */
export async function closeOrder(orderId: bigint, reason: string) {
  const order = await prisma.orders.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError(14001, '订单不存在');
  assertTransition(order.status, 'CLOSED');
  const { count } = await prisma.orders.updateMany({
    where: { id: orderId, status: 'COMPLETED' },
    data: { status: 'CLOSED', closed_at: new Date() },
  });
  if (count === 0) throw new AppError(14002, '订单状态已变化');
  await prisma.order_timeline.create({
    data: { order_id: orderId, from_status: 'COMPLETED', to_status: 'CLOSED', action: 'close', operator_type: 'SYSTEM', reason },
  });
}

// ---------------------------------------------------------------------------
// 超时扫描（order-timeout 队列 worker 调用）
// ---------------------------------------------------------------------------

/** 支付超时关单：CREATED 超过 15min → CANCELLED（guard 释放） */
export async function sweepPayTimeout(): Promise<number> {
  const timeoutMin = ORDER_PAY_TIMEOUT_MIN;
  const deadline = new Date(Date.now() - timeoutMin * 60_000);
  const stale = await prisma.orders.findMany({
    where: { status: 'CREATED', created_at: { lt: deadline } },
    select: { id: true },
    take: 200,
  });
  for (const o of stale) {
    try {
      await cancelOrder(o.id, 'TIMEOUT', `支付超时 ${timeoutMin} 分钟自动关单`);
    } catch (e) {
      log.warn({ event: 'pay-timeout-close-failed', orderId: o.id.toString(), err: (e as Error).message });
    }
  }
  return stale.length;
}

/** 派单超时转人工：DISPATCHED 超过 30min 无人接单（§6.1：转人工派单/客服介入） */
export async function sweepDispatchTimeout(): Promise<number> {
  const now = new Date();
  const stale = await prisma.orders.findMany({
    where: { status: 'DISPATCHED', dispatch_deadline_at: { lt: now } },
    select: { id: true, order_no: true },
    take: 200,
  });
  for (const o of stale) {
    // MVP：不自动改状态，登记待人工（support 工单 + 告警）
    // TODO(support)：转人工派单工单
    log.warn({ event: 'dispatch-timeout', orderId: o.id.toString(), orderNo: o.order_no });
  }
  return stale.length;
}

// ---------------------------------------------------------------------------
// 安全挂起（team-lead 裁定③）：SOS / 服务超时自动挂起 / 客服手动挂起共用出口
// ---------------------------------------------------------------------------

/** 夜间单确认门闩（裁定④）：非豁免单未完成子女确认 → 禁止派单/接单 */
function assertNightConfirmed(order: { night_order: boolean; family_confirmed_at: Date | null }): void {
  if (order.night_order && !order.family_confirmed_at) {
    throw new AppError(14007, '夜间单待子女确认，确认后方可派单/接单');
  }
}

/** 可被挂起的最小订单投影（供共享助手与 sweep 使用） */
interface SuspendableOrderProjection {
  id: bigint;
  order_no: string;
  status: order_status;
}

/**
 * 安全挂起共享助手（SUSPENDED 客服裁决出口的唯一写入方）。
 * - 状态守卫 updateMany（乐观并发，count=0 → 14002）；
 * - order_timeline 留痕（action/operator 由调用方给，SOS 记触发方、sweep 记 SYSTEM、客服记 ADMIN）；
 * - 仅接受 canTransition(from,'SUSPENDED') 的入态（PENDING_CONFIRM/ACCEPTED/ARRIVED/IN_SERVICE）。
 */
/**
 * 挂起结果（主理人裁定：escalate 的 SOS 出口要精确信号，不靠状态推断）。
 *
 * 之前 escalate 用「order_id 前后差」推断是否真挂起成功，那是**会误报**的：
 * 订单若本来就绑在告警上，差值为 false 但挂起其实成功了 →
 * 后台显示「未挂起」而订单真被挂起，运营会据此做错决策。
 * 直接读返回值，不做推断。
 */
export interface SuspendResult {
  /** 是否真的挂起了（false = 订单本来就不在可挂起态，未做任何写入） */
  suspended: boolean;
  /** 留痕时间线id（可回查挂起记录；未挂起时为 null） */
  suspendNo?: string | null;
  /** 未挂起的原因（便于运营判读，不抛错——挂起失败不该让告警链路整体失败） */
  skipReason?: string;
}

export async function suspendOrderForSafety(
  order: SuspendableOrderProjection,
  reason: string,
  operator: { type: operator_type; id?: bigint | null },
  action = 'suspend',
): Promise<SuspendResult> {
  if (!canTransition(order.status, 'SUSPENDED')) {
    // 不抛错：调用方（告警 SOS 出口 / 超时 sweep）需要的是「有没有挂成」，
    // 抛错会让整条告警链路失败，而这本来只是兜底动作。
    // 但 **orders.updateMany 后的 count===0 仍然抛**——那是并发竞争
    // （状态在我们查之后被别人改了），属于真异常，不该被静默吞掉。
    return {
      suspended: false,
      suspendNo: null,
      skipReason: `订单状态 ${order.status} 不允许挂起`,
    };
  }
  const { count } = await prisma.orders.updateMany({
    where: { id: order.id, status: order.status },
    data: { status: 'SUSPENDED', suspended_at: new Date(), suspend_reason: reason },
  });
  // 并发竞争：别人已先改状态 → 抛 14002（真异常，不静默）
  if (count === 0) throw new AppError(14002, '订单状态已变化');
  const timeline = await prisma.order_timeline.create({
    data: {
      order_id: order.id,
      from_status: order.status,
      to_status: 'SUSPENDED',
      action,
      operator_type: operator.type,
      operator_id: operator.id ?? null,
      reason,
    },
    select: { id: true },
  });
  log.info({ event: 'order-suspended', orderNo: order.order_no, from: order.status, action, reason });
  return { suspended: true, suspendNo: timeline.id.toString() };
}

/**
 * 服务超时挂起 sweep（裁定③）：
 *   IN_SERVICE && now − slot_end ≥ service_overtime_suspend_min
 *   && now − lastActivity ≥ im_silence_suspend_min → SUSPENDED 待客服核实。
 * lastActivity = 订单 IM 最近消息时间；无消息回退 service_started_at ?? accepted_at ?? created_at。
 */
export async function sweepServiceOvertimeSuspend(): Promise<number> {
  const now = new Date();
  const overtimeMin = await getConfigInt('service_overtime_suspend_min');
  const silenceMin = await getConfigInt('im_silence_suspend_min');
  // 粗过滤：slot_end 已过去 overtimeMin 的 IN_SERVICE 单（精确判定在纯函数）
  const cutoff = new Date(now.getTime() - overtimeMin * 60_000);
  const stale = await prisma.orders.findMany({
    where: { status: 'IN_SERVICE', slot_end: { lt: cutoff } },
    select: {
      id: true,
      order_no: true,
      slot_end: true,
      service_started_at: true,
      accepted_at: true,
      created_at: true,
    },
    take: 200,
  });
  let suspended = 0;
  for (const o of stale) {
    // IM 最近互动（会话与订单 1:1；无消息回退服务开始/接单/下单时刻）
    const conversation = await prisma.im_conversations.findFirst({
      where: { order_id: o.id },
      select: { id: true },
    });
    let lastActivityAt = o.service_started_at ?? o.accepted_at ?? o.created_at;
    if (conversation) {
      const lastMsg = await prisma.im_messages.findFirst({
        where: { conversation_id: conversation.id },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
      if (lastMsg) lastActivityAt = lastMsg.created_at;
    }
    const due = serviceOvertimeSuspendDue(
      { status: 'IN_SERVICE', slotEnd: o.slot_end, lastActivityAt },
      now,
      { overtimeMin, silenceMin },
    );
    if (!due) continue;
    try {
      await suspendOrderForSafety(
        { id: o.id, order_no: o.order_no, status: 'IN_SERVICE' },
        `服务超时自动挂起：超过预约结束 ${overtimeMin} 分钟未完成确认且 IM 静默 ${silenceMin} 分钟`,
        { type: 'SYSTEM' },
        'auto_suspend',
      );
      suspended += 1;
      // TODO(support)：客服核实工单（载体随 support_tickets/complaints 方案落地后补建）
      log.warn({ event: 'service-overtime-suspended', orderId: o.id.toString(), orderNo: o.order_no });
    } catch (e) {
      log.warn({ event: 'service-overtime-suspend-failed', orderId: o.id.toString(), err: (e as Error).message });
    }
  }
  return suspended;
}

/**
 * 夜间单确认超时 sweep（裁定④）：
 *   night_order && 未确认 && 前置态（CREATED/PAID）&& 超过 night_confirm_timeout_min
 *   → 自动取消；已支付走 cancelOrder → refundOrder 全额退款链路（分账 FROZEN 解冻回退，
 *     订单终态 REFUNDED）。
 */
export async function sweepNightConfirmTimeout(): Promise<number> {
  const timeoutMin = await getConfigInt('night_confirm_timeout_min');
  const cutoff = new Date(Date.now() - timeoutMin * 60_000);
  const stale = await prisma.orders.findMany({
    where: {
      night_order: true,
      family_confirmed_at: null,
      status: { in: ['CREATED', 'PAID'] },
      created_at: { lt: cutoff },
    },
    select: { id: true, order_no: true, created_at: true },
    take: 200,
  });
  let cancelled = 0;
  for (const o of stale) {
    try {
      await cancelOrder(o.id, 'TIMEOUT', `夜间单子女确认超时 ${timeoutMin} 分钟自动取消`);
      cancelled += 1;
      log.info({ event: 'night-confirm-timeout-cancelled', orderId: o.id.toString(), orderNo: o.order_no });
    } catch (e) {
      log.warn({ event: 'night-confirm-timeout-failed', orderId: o.id.toString(), err: (e as Error).message });
    }
  }
  return cancelled;
}

// ---------------------------------------------------------------------------
// 查询助手（routes 用）
// ---------------------------------------------------------------------------

/**
 * 订单详情出参前的地址处理（主理人裁定：地址分档可见性）。
 *
 * **关键：`address_cipher` 绝不出参**——密文也是信息（长度会泄漏原文长度，
 * 且一旦泄漏即可离线爆破）。原来这里是 `return order` 整行直出，密文就这么
 * 跟着出了接口，属实打洞。
 *
 * 分档规则（按服务进度解锁）：
 *   · 到岗核销通过后（ARRIVED / IN_SERVICE / 及其后）→ full；
 *     人与订单已在物理空间绑定，此时给全量是合理的。
 *   · 到岗前（PENDING/PAID/DISPATCHED/ACCEPTED）→ community；
 *     陪聊员需能导航到小区（否则接单无意义），但不该知道门牌——
 *     老人可能独居，地址在服务开始前泄露的代价不可逆。
 */
export function addressVisibilityForOrder(status: order_status): AddressVisibility {
  const AFTER_ARRIVE: readonly order_status[] = [
    'ARRIVED',
    'IN_SERVICE',
    'PENDING_CONFIRM',
    'COMPLETED',
    'SUSPENDED',
    'CLOSED',
  ];
  return AFTER_ARRIVE.includes(status) ? 'full' : 'community';
}

export async function getOrderDetail(orderId: bigint) {
  const order = await prisma.orders.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, nickname: true, avatar_url: true, role: true, status: true } },
      elder_user: { select: { id: true, nickname: true, avatar_url: true, role: true, status: true } },
      companion: { include: { user: { select: { id: true, nickname: true, avatar_url: true } } } },
      timeline: { orderBy: { id: 'asc' } },
      verifications: true,
      payments: true,
      profit_sharing_records: true,
    },
  });
  if (!order) throw new AppError(14001, '订单不存在');
  // 剥掉密文列，换成按档位脱敏后的 address
  const { address_cipher, ...rest } = order;
  return {
    ...rest,
    address: maskAddress(address_cipher, addressVisibilityForOrder(order.status)),
  };
}

export function orderAccessible(order: { user_id: bigint; elder_user_id: bigint; companion_id: bigint | null }, userId: bigint, role: string): boolean {
  if (role === 'COMPANION') return order.companion_id !== null && order.user_id === userId ? true : false;
  return order.user_id === userId || order.elder_user_id === userId;
}

// ---------------------------------------------------------------------------
// 内部助手
// ---------------------------------------------------------------------------

/** 平面近似距离（米；MVP 内存打分用，精确距离走地图适配器） */
export function approxDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dx = (lng2 - lng1) * 111000 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dy = (lat2 - lat1) * 111000;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

/** 简化 geohash（与 companion.service 同算法，5 字符） */
function encodeGeoHash(lat: number, lng: number, precision: number): string {
  const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) { ch |= 1 << (4 - bit); lngMin = mid; } else { lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) { ch |= 1 << (4 - bit); latMin = mid; } else { latMax = mid; }
    }
    even = !even;
    if (bit < 4) { bit++; } else { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export type { SplitMode };
