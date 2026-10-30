// ============================================================================
// 邻伴 · marketing 后台：券模板写操作（service 层，DB 副作用）
// ----------------------------------------------------------------------------
// 铁律三条在本层的落法：
//   1. **资金动作可审计**：每次写操作都落 audit_logs（before/after 快照）。
//      券面额改错必须能追责，否则事后无法定责。
//   2. **服务动作可留痕**：状态流转落操作流水（复用 audit_logs，不新建表）。
//   3. **金额 BigInt 存分**：min_spend_fen 进出参一律 toString()。
//
// 校验全部委托 domain/coupon.ts 的纯函数，本层只做 IO 与事务。
// 不在service 里重复实现规则 —— 那会导致两份规则漂移，且只有一份被测到。
// ============================================================================

import { AppError, COUPON_STATUS } from '@linban/shared';
import type { CouponStatus } from '@linban/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/prisma';
import { withTransaction } from '../../infra/prisma';
import { genBizNo } from '../../common/ids';
import {
  NEW_COUPON_INITIAL_STATUS,
  validateCouponEdit,
  validateEnd,
  validatePause,
  validatePublish,
  validateResume,
  type CouponRuleResult,
  type CouponSnapshot,
  type CouponType,
} from '../../domain/coupon';

/** 券模板出参（后台视图；金额一律字符串） */
export interface CouponAdminDTO {
  id: string;
  couponNo: string;
  name: string;
  type: CouponType;
  value: number;
  minSpendFen: string;
  validDays: number;
  totalCount: number;
  claimedCount: number;
  usedCount: number;
  status: CouponStatus;
  scopeRules: unknown;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 派生：面额是否已冻结（有存量已领券时不可再改） */
  valueFrozen: boolean;
  /** 派生：可用库存；totalCount=0 表示不限量，返回 null */
  remainCount: number | null;
}

/** DB 行 → 域快照 */
function toSnapshot(c: {
  status: string;
  value: number;
  min_spend_fen: bigint;
  valid_days: number;
  total_count: number;
  claimed_count: number;
  used_count: number;
}): CouponSnapshot {
  return {
    status: c.status as CouponStatus,
    value: c.value,
    min_spend_fen: c.min_spend_fen,
    valid_days: c.valid_days,
    total_count: c.total_count,
    claimed_count: c.claimed_count,
    used_count: c.used_count,
  };
}

/** DB 行 → 出参 */
function toDTO(c: {
  id: bigint; coupon_no: string; name: string; type: string; value: number;
  min_spend_fen: bigint; valid_days: number; total_count: number;
  claimed_count: number; used_count: number; status: string;
  scope_rules: unknown; start_at: Date | null; end_at: Date | null;
  created_at: Date; updated_at: Date;
}): CouponAdminDTO {
  return {
    id: c.id.toString(),
    couponNo: c.coupon_no,
    name: c.name,
    type: c.type as CouponType,
    value: c.value,
    // 金额铁律：BigInt 必须字符串化，否则 JSON 序列化会抛错
    minSpendFen: c.min_spend_fen.toString(),
    validDays: c.valid_days,
    totalCount: c.total_count,
    claimedCount: c.claimed_count,
    usedCount: c.used_count,
    status: c.status as CouponStatus,
    scopeRules: c.scope_rules,
    startAt: c.start_at?.toISOString() ?? null,
    endAt: c.end_at?.toISOString() ?? null,
    createdAt: c.created_at.toISOString(),
    updatedAt: c.updated_at.toISOString(),
    // 派生字段：前端据此置灰「面额」输入框，不必自己算
    valueFrozen: c.claimed_count > 0,
    remainCount: c.total_count === 0 ? null : c.total_count - c.claimed_count,
  };
}

/**
 * 域校验结果 → AppError。
 *
 * 错误码选**10008 CONFLICT**（而非 19205「优惠券不可用」）：
 *   - 19205 的文案是「优惠券不可用」，用在「草稿不能 pause」这类状态冲突上
 *     会让运营以为券坏了，而不是"状态不对"；
 *   - 10008 的语义就是「资源状态冲突」，与前端 mock 的expect 一致；
 *   - 券**不存在**仍走 19204（那是真正的 not found），两者不混淆。
 * 字段级原因放 detail.payload，前端可直接定位到输入框/按钮提示。
 */
function throwIfInvalid(r: CouponRuleResult): void {
  if (r.ok) return;
  throw new AppError(10008, r.message, { field: r.field, rule: r.code });
}

/** 按 id 或 couponNo 查券（后台两种入参都支持） */
async function findCoupon(idOrNo: string) {
  const byId = /^\d+$/.test(idOrNo);
  const c = await prisma.coupons.findFirst({
    where: byId ? { id: BigInt(idOrNo) } : { coupon_no: idOrNo },
  });
  if (!c) throw new AppError(19204, '优惠券不存在');
  return c;
}

// ---------------------------------------------------------------------------
// 1) 创建券模板 —— 落 DRAFT（券面额是资金口径，建完不该直接对外发）
// ---------------------------------------------------------------------------

export interface CreateCouponInput {
  name: string;
  type: CouponType;
  value: number;
  minSpendFen: bigint;
  validDays: number;
  totalCount: number;
  scopeRules?: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
  adminId: bigint;
}

export async function createCoupon(input: CreateCouponInput): Promise<CouponAdminDTO> {
  // 面额范围按类型校验：复用 validatePublish 的范围逻辑，但不走状态机
  const draftSnapshot: CouponSnapshot = {
    status: NEW_COUPON_INITIAL_STATUS,
    value: input.value,
    min_spend_fen: input.minSpendFen,
    valid_days: input.validDays,
    total_count: input.totalCount,
    claimed_count: 0,
    used_count: 0,
  };
  // 借validateCouponEdit 做入参范围校验（新建时 claimed=0，面额必然可改）
  throwIfInvalid(validateCouponEdit(draftSnapshot, {
    name: input.name,
    type: input.type,
    value: input.value,
    minSpendFen: input.minSpendFen,
    validDays: input.validDays,
    totalCount: input.totalCount,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
  }));

  return withTransaction(async (tx) => {
    const created = await tx.coupons.create({
      data: {
        coupon_no: genBizNo('coupon'),
        name: input.name,
        type: input.type,
        value: input.value,
        min_spend_fen: input.minSpendFen,
        valid_days: input.validDays,
        total_count: input.totalCount,
        status: NEW_COUPON_INITIAL_STATUS,
        scope_rules: input.scopeRules === undefined ? Prisma.JsonNull : (input.scopeRules as Prisma.InputJsonValue),
        start_at: input.startAt ?? null,
        end_at: input.endAt ?? null,
        created_by: input.adminId,
      },
    });
    await tx.audit_logs.create({
      data: {
        admin_id: input.adminId,
        action: 'create',
        module: 'marketing',
        target_type: 'coupons',
        target_id: created.coupon_no,
        before_json: Prisma.JsonNull,
        after_json: {
          name: created.name,
          type: created.type,
          value: created.value,
          min_spend_fen: created.min_spend_fen.toString(),
          total_count: created.total_count,
          status: created.status,
        },
      },
    });
    return toDTO(created);
  });
}

// ---------------------------------------------------------------------------
// 2) 编辑券模板
// ---------------------------------------------------------------------------

export interface EditCouponInput {
  name?: string;
  type?: CouponType;
  value?: number;
  minSpendFen?: bigint;
  validDays?: number;
  totalCount?: number;
  scopeRules?: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
  adminId: bigint;
}

export async function editCoupon(idOrNo: string, input: EditCouponInput): Promise<CouponAdminDTO> {
  const current = await findCoupon(idOrNo);

  // 面额冻结校验要用**实时 claimed_count**，且必须在事务外读一次、
  // 事务内再条件更新（防并发：两次并发编辑都读到 claimed=0）
  const check = validateCouponEdit(toSnapshot(current), {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(input.minSpendFen === undefined ? {} : { minSpendFen: input.minSpendFen }),
    ...(input.validDays === undefined ? {} : { validDays: input.validDays }),
    ...(input.totalCount === undefined ? {} : { totalCount: input.totalCount }),
    ...(input.startAt === undefined ? {} : { startAt: input.startAt }),
    ...(input.endAt === undefined ? {} : { endAt: input.endAt }),
  });
  throwIfInvalid(check);

  const before = {
    name: current.name,
    type: current.type,
    value: current.value,
    min_spend_fen: current.min_spend_fen.toString(),
    valid_days: current.valid_days,
    total_count: current.total_count,
    status: current.status,
  };

  // 条件更新：status 与 claimed_count 一并作为前置条件。
  // 被并发改动（他人已领券/已暂停）时 count=0 → 明确报错，不静默覆盖。
  const updated = await withTransaction(async (tx) => {
    const res = await tx.coupons.updateMany({
      where: {
        id: current.id,
        status: current.status,
        claimed_count: current.claimed_count,
      },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(input.minSpendFen === undefined ? {} : { min_spend_fen: input.minSpendFen }),
        ...(input.validDays === undefined ? {} : { valid_days: input.validDays }),
        ...(input.totalCount === undefined ? {} : { total_count: input.totalCount }),
        ...(input.scopeRules === undefined ? {} : { scope_rules: input.scopeRules as Prisma.InputJsonValue }),
        ...(input.startAt === undefined ? {} : { start_at: input.startAt }),
        ...(input.endAt === undefined ? {} : { end_at: input.endAt }),
      },
    });
    if (res.count === 0) {
      throw new AppError(10008, '券已被他人修改（状态或领取数已变），请刷新后重试');
    }
    const after = await tx.coupons.findUniqueOrThrow({ where: { id: current.id } });
    await tx.audit_logs.create({
      data: {
        admin_id: input.adminId,
        action: 'update',
        module: 'marketing',
        target_type: 'coupons',
        target_id: after.coupon_no,
        before_json: before as Prisma.InputJsonValue,
        after_json: {
          name: after.name,
          type: after.type,
          value: after.value,
          min_spend_fen: after.min_spend_fen.toString(),
          valid_days: after.valid_days,
          total_count: after.total_count,
          status: after.status,
        } as Prisma.InputJsonValue,
      },
    });
    return toDTO(after);
  });
  return updated;
}

// ---------------------------------------------------------------------------
// 3~5) 状态流转：publish / pause / resume / end
// ---------------------------------------------------------------------------

/**
 * 通用状态流转实现。
 *
 * 为什么用一个函数而不是四个：
 * 四条路径的差异只在「允许的来源状态」与「额外的发布校验」，
 * 事务边界、审计写法、条件更新完全相同 —— 复制四份必然漂移。
 */
async function transition(
  idOrNo: string,
  target: CouponStatus,
  adminId: bigint,
  extraCheck?: (c: ReturnType<typeof toSnapshot> & { type: string; start_at: Date | null; end_at: Date | null }) => CouponRuleResult,
): Promise<CouponAdminDTO> {
  const current = await findCoupon(idOrNo);
  const snapshot = toSnapshot(current);

  if (extraCheck) throwIfInvalid(extraCheck({ ...snapshot, type: current.type, start_at: current.start_at, end_at: current.end_at }));
  else throwIfInvalid(statusGuard(target, snapshot));

  return withTransaction(async (tx) => {
    // 条件更新：status 作为前置条件，防并发双击造成重复流转
    const res = await tx.coupons.updateMany({
      where: { id: current.id, status: current.status },
      data: { status: target },
    });
    if (res.count === 0) {
      throw new AppError(10008, '券状态已被他人变更，请刷新后重试');
    }
    const after = await tx.coupons.findUniqueOrThrow({ where: { id: current.id } });
    await tx.audit_logs.create({
      data: {
        admin_id: adminId,
        action: 'update',
        module: 'marketing',
        target_type: 'coupons',
        target_id: after.coupon_no,
        before_json: { status: current.status } as Prisma.InputJsonValue,
        after_json: {
          status: after.status,
          action: `${current.status}->${target}`,
        } as Prisma.InputJsonValue,
      },
    });
    return toDTO(after);
  });
}

/** 按目标状态选对应的域校验器 */
function statusGuard(target: CouponStatus, snapshot: CouponSnapshot): CouponRuleResult {
  switch (target) {
    case COUPON_STATUS.ACTIVE:
      // resume 路径（publish 有额外校验，走 extraCheck 分支）
      return validateResume(snapshot);
    case COUPON_STATUS.PAUSED:
      return validatePause(snapshot);
    case COUPON_STATUS.ENDED:
      return validateEnd(snapshot);
    default:
      return { ok: false, field: 'status', code: 'STATUS_ILLEGAL', message: `不支持的目标状态 ${target}` };
  }
}

/** 发布：草稿/已暂停 → 投放中（幂等：已投放中重复发布回放） */
export async function publishCoupon(idOrNo: string, adminId: bigint): Promise<CouponAdminDTO> {
  return transition(idOrNo, COUPON_STATUS.ACTIVE, adminId, (c) =>
    validatePublish(c, c.type as CouponType, c.start_at, c.end_at, new Date()),
  );
}

/** 暂停：仅投放中可暂停（幂等） */
export async function pauseCoupon(idOrNo: string, adminId: bigint): Promise<CouponAdminDTO> {
  return transition(idOrNo, COUPON_STATUS.PAUSED, adminId);
}

/** 恢复：仅已暂停可恢复（幂等） */
export async function resumeCoupon(idOrNo: string, adminId: bigint): Promise<CouponAdminDTO> {
  return transition(idOrNo, COUPON_STATUS.ACTIVE, adminId);
}

/** 结束投放：不可逆，与 pause 分离；已结束幂等 */
export async function endCoupon(idOrNo: string, adminId: bigint): Promise<CouponAdminDTO> {
  return transition(idOrNo, COUPON_STATUS.ENDED, adminId);
}

// ---------------------------------------------------------------------------
// 列表查询（后台只读侧，供页面加载）
// ---------------------------------------------------------------------------

export interface ListCouponsQuery {
  page: number;
  pageSize: number;
  status?: CouponStatus;
  type?: CouponType;
  keyword?: string;
}

export async function listCoupons(q: ListCouponsQuery): Promise<{
  list: CouponAdminDTO[]; total: number; page: number; pageSize: number;
}> {
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.type ? { type: q.type } : {}),
    // keyword 同时搜券名与券号（运营只记得其中之一）
    ...(q.keyword
      ? {
          OR: [
            { name: { contains: q.keyword } },
            { coupon_no: { contains: q.keyword } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.coupons.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.coupons.count({ where }),
  ]);
  return { list: rows.map(toDTO), total, page: q.page, pageSize: q.pageSize };
}

export { toDTO as toCouponAdminDTO };