// ============================================================================
// 邻伴 · 券模板领域规则（domain 层，纯函数零 IO）
// ----------------------------------------------------------------------------
// 为什么券模板的校验必须是独立纯函数，而不是散在 route handler 的 if 里：
//
//  1. **券面额是资金口径**。`value` 错一位就是用户实际少/多拿钱，且已领取的券
//     是既成事实 —— 改模板改不回来。所以规则必须能被穷举验证。
//  2. 三个不变量互相咬合：
//       ① `used_count ≤ claimed_count ≤ total_count`（限量券）
//       ② `claimed_count > 0` 后不得改`value`（存量已领券面额与模板不一致，
//          核销时"按哪个算"说不清 → 事后对账必然扯皮）
//       ③ `total_count = 0` 表示不限量，此时 ① 只约束 used ≤ claimed
//  3. 这三条**互相冲突**：限量券想加投放量（total↑）可以，但想改面额不行；
//     不限量券（total=0）面额随便改但库存不设防。这些组合只有穷举才验得全。
//
// 纯函数让组合爆炸变成一张表，而不是一堆 if。
// ============================================================================

import { COUPON_STATUS, type CouponStatus } from '@linban/shared';

/** 券类型（schema coupons.type coupon_type 枚举） */
export type CouponType = 'FULL_REDUCTION' | 'DURATION';

/** 编辑券模板的入参（全部字段可选 = 部分更新） */
export interface CouponEditInput {
  name?: string;
  type?: CouponType;
  /** 满减=分；时长=分钟。量纲差 200 倍，见 coupon_type 注释 */
  value?: number;
  /** 使用门槛（分） */
  minSpendFen?: bigint;
  validDays?: number;
  /** 发放总量；0 = 不限量 */
  totalCount?: number;
  scopeRules?: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
}

/** 券模板当前快照（从 DB 行抽出的相关字段） */
export interface CouponSnapshot {
  status: CouponStatus;
  value: number;
  min_spend_fen: bigint;
  valid_days: number;
  total_count: number;
  claimed_count: number;
  used_count: number;
}

/** 校验结果：ok=false 时带字段级原因，便于前端定位到输入框 */
export type CouponRuleResult =
  | { ok: true }
  | { ok: false; field: string; code: CouponRuleError; message: string };

/** 券规则错误码（不占 19xxx 业务段——那是 API 层错误码，域内用符号枚举） */
export type CouponRuleError =
  | 'VALUE_FROZEN'
  | 'TOTAL_BELOW_CLAIMED'
  | 'COUNT_INVERSION'
  | 'STATUS_ILLEGAL'
  | 'VALUE_OUT_OF_RANGE'
  | 'END_BEFORE_START'
  | 'LIMITED_OVERDRAFT';

// ---------------------------------------------------------------------------
// 状态机：模板状态流转
// ---------------------------------------------------------------------------

/**
 * 允许的模板状态流转。
 *
 * `ENDED` 是终态：不可逆。这与 `PAUSED`（可 resume）**必须分开** ——
 * 合并成一个「停用」会让「暂停」变成不可逆，运营误点一次就永久损失投放期。
 * 这条是我方（苏映棠规格）明确要求的，写进域函数锁死。
 */
const TRANSITIONS: Record<CouponStatus, readonly CouponStatus[]> = {
  // 草稿 → 投放中（发布）/ 直接结束（弃用）
  DRAFT: [COUPON_STATUS.ACTIVE, COUPON_STATUS.ENDED],
  // 投放中 → 暂停 / 结束
  ACTIVE: [COUPON_STATUS.PAUSED, COUPON_STATUS.ENDED],
  // 暂停 → 恢复投放 / 结束
  PAUSED: [COUPON_STATUS.ACTIVE, COUPON_STATUS.ENDED],
  // 终态：不可逆
  ENDED: [],
};

/**
 * 该状态下允许流转到的目标状态集合。
 *
 * **未知状态返回空数组（fail-closed）**，这是刻意的：
 * 将来 `COUPON_STATUS` 新增一个值而忘了登记流转表时，若直接写
 * `TRANSITIONS[status].includes(to)` 会抛 TypeError → 冒泡成接口 500；
 * fail-closed 则是「一律拒绝」，语义正确且不把域函数异常冒泡成接口错误。
 * 单测「规则函数对未知状态默认拒绝而非放行」锁这条。
 */
function allowedTargets(from: CouponStatus): readonly CouponStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** 该状态下是否允许流转到目标状态 */
export function canTransition(from: CouponStatus, to: CouponStatus): boolean {
  return allowedTargets(from).includes(to);
}

/** 幂等：目标状态与当前一致时不算非法流转（重复调 publish/end 不该报错） */
export function isIdempotentNoop(from: CouponStatus, to: CouponStatus): boolean {
  return from === to;
}

/** 终态判定（ENDED 之后任何操作都应拒绝；未登记状态亦视为终态 = 一律拒绝） */
export function isTerminal(status: CouponStatus): boolean {
  return allowedTargets(status).length === 0;
}

// ---------------------------------------------------------------------------
// 不变量：计数关系
// ---------------------------------------------------------------------------

/**
 * 计数不变量：`used ≤ claimed ≤ total`，其中 total=0 表示不限量。
 *
 * 为什么这条要独立成函数而不是内联：它同时被「编辑」「发布」「领券」「核销」
 * 四条路径依赖，任何一处改动都要能立刻验证。放一处才有一处真相。
 */
export function checkCountInvariant(input: {
  totalCount: number;
  claimedCount: number;
  usedCount: number;
}): CouponRuleResult {
  const { totalCount, claimedCount, usedCount } = input;
  if (usedCount > claimedCount) {
    return {
      ok: false,
      field: 'usedCount',
      code: 'COUNT_INVERSION',
      message: `已核销(${usedCount})不能大于已领取(${claimedCount})`,
    };
  }
  if (totalCount > 0 && claimedCount > totalCount) {
    return {
      ok: false,
      field: 'totalCount',
      code: 'LIMITED_OVERDRAFT',
      message: `已领取(${claimedCount})不能大于发放总量(${totalCount})，否则会超发`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 编辑校验
// ---------------------------------------------------------------------------

/** 面额与门槛的取值范围（按类型分档，见下） */
const VALUE_RANGES: Record<CouponType, { min: number; max: number }> = {
  // 满减：单位分。单张最多减 500 元 = 50000 分，防误填 50000 分(=500元)被当 500 分用
  FULL_REDUCTION: { min: 1, max: 50000 },
  // 时长：单位分钟。最长 600 分钟（契约 §4.1 时长卡上限同值）
  DURATION: { min: 1, max: 600 },
};

/** 校验一次编辑是否合法 */
export function validateCouponEdit(
  snapshot: CouponSnapshot,
  input: CouponEditInput,
): CouponRuleResult {
  // 1) 终态不可编辑
  if (isTerminal(snapshot.status)) {
    return {
      ok: false,
      field: 'status',
      code: 'STATUS_ILLEGAL',
      message: `券已${snapshot.status === 'ENDED' ? '结束' : '终止'}，不可再编辑`,
    };
  }

  // 2) 面额冻结：`claimed_count > 0` 后改value 会让存量已领券与模板不一致。
  //    这是**资金口径**问题：核销时按模板算 → 已领用户吃亏；按领券时快照算 →
  //    需要 user_coupons 表加面额快照列（当前 schema 没有）。所以直接禁改。
  if (input.value !== undefined && input.value !== snapshot.value && snapshot.claimed_count > 0) {
    return {
      ok: false,
      field: 'value',
      code: 'VALUE_FROZEN',
      message: `已有${snapshot.claimed_count}人领过该券，面额不可再改（否则存量券与模板面额不一致，核销口径说不清）`,
    };
  }

  // 3) 面额取值范围（按目标类型判定，type 与 value 可能同时改）
  const targetType = input.type ?? (snapshot as unknown as { type?: CouponType }).type ?? 'FULL_REDUCTION';
  if (input.value !== undefined) {
    const range = VALUE_RANGES[targetType];
    if (!Number.isInteger(input.value) || input.value < range.min || input.value > range.max) {
      return {
        ok: false,
        field: 'value',
        code: 'VALUE_OUT_OF_RANGE',
        message: `面额超出范围：${targetType === 'FULL_REDUCTION' ? '1–50000 分' : '1–600 分钟'}`,
      };
    }
  }

  // 4) 总量不得小于已领取 —— 否则超发，库存会变负数
  if (input.totalCount !== undefined && input.totalCount !== snapshot.total_count) {
    if (input.totalCount < 0) {
      return { ok: false, field: 'totalCount', code: 'VALUE_OUT_OF_RANGE', message: '发放总量不能为负' };
    }
    if (input.totalCount > 0 && input.totalCount < snapshot.claimed_count) {
      return {
        ok: false,
        field: 'totalCount',
        code: 'TOTAL_BELOW_CLAIMED',
        message: `发放总量(${input.totalCount})不能小于已领取(${snapshot.claimed_count})，否则会超发`,
      };
    }
  }

  // 5) 计数不变量（改动后重验）
  const invariant = checkCountInvariant({
    totalCount: input.totalCount ?? snapshot.total_count,
    claimedCount: snapshot.claimed_count,
    usedCount: snapshot.used_count,
  });
  if (!invariant.ok) return invariant;

  // 6) 有效期区间
  const startAt = input.startAt === undefined ? null : input.startAt;
  const endAt = input.endAt === undefined ? null : input.endAt;
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    return {
      ok: false,
      field: 'endAt',
      code: 'END_BEFORE_START',
      message: '结束时间必须晚于开始时间',
    };
  }

  // 7) 有效期天数
  if (input.validDays !== undefined && (input.validDays < 1 || input.validDays > 3650)) {
    return {
      ok: false,
      field: 'validDays',
      code: 'VALUE_OUT_OF_RANGE',
      message: '有效天数应在 1–3650 之间',
    };
  }

  // 8) 使用门槛非负
  if (input.minSpendFen !== undefined && input.minSpendFen < 0n) {
    return { ok: false, field: 'minSpendFen', code: 'VALUE_OUT_OF_RANGE', message: '使用门槛不能为负' };
  }

  return { ok: true };
}

/**
 * 新建券模板的出参状态。
 *
 * 落 `DRAFT` 而非 `ACTIVE`（苏映棠改的，我认可并已落到域函数里锁死）：
 *   券面额是资金口径，建完直接对外发意味着「还没复核的钱口径已经生效」。
 *   运营流程应是 建 → 复核 → publish，与权限点 `marketing:grant` 的语义一致。
 */
export const NEW_COUPON_INITIAL_STATUS = COUPON_STATUS.DRAFT;

/** 发布（草稿 → 投放中）的前置校验 */
export function validatePublish(
  snapshot: CouponSnapshot,
  type: CouponType,
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): CouponRuleResult {
  // 幂等：已投放中重复 publish 不报错，直接回放
  if (snapshot.status === COUPON_STATUS.ACTIVE) return { ok: true };

  if (!canTransition(snapshot.status, COUPON_STATUS.ACTIVE)) {
    return {
      ok: false,
      field: 'status',
      code: 'STATUS_ILLEGAL',
      message: `当前状态 ${snapshot.status} 不可发布（仅草稿/已暂停可发布）`,
    };
  }

  if (snapshot.value <= 0) {
    return { ok: false, field: 'value', code: 'VALUE_OUT_OF_RANGE', message: '面额为0的券不可投放' };
  }

  const range = VALUE_RANGES[type];
  if (snapshot.value < range.min || snapshot.value > range.max) {
    return {
      ok: false,
      field: 'value',
      code: 'VALUE_OUT_OF_RANGE',
      message: `面额超出该类型允许范围（${range.min}–${range.max}）`,
    };
  }

  // 定时开始且起始时间已过 —— 允许（等价于立即生效），但结束时间必须还在未来，
  // 否则投出去就是死券
  if (endAt && endAt.getTime() <= now.getTime()) {
    return {
      ok: false,
      field: 'endAt',
      code: 'END_BEFORE_START',
      message: '结束时间已过，投出去即为死券',
    };
  }
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    return { ok: false, field: 'endAt', code: 'END_BEFORE_START', message: '结束时间必须晚于开始时间' };
  }

  // 库存已超发（历史脏数据）时不得投放
  const inv = checkCountInvariant({
    totalCount: snapshot.total_count,
    claimedCount: snapshot.claimed_count,
    usedCount: snapshot.used_count,
  });
  if (!inv.ok) return inv;

  return { ok: true };
}

/** 暂停：仅投放中可暂停 */
export function validatePause(snapshot: CouponSnapshot): CouponRuleResult {
  // 幂等：已暂停重复 pause 不报错
  if (snapshot.status === COUPON_STATUS.PAUSED) return { ok: true };
  if (!canTransition(snapshot.status, COUPON_STATUS.PAUSED)) {
    return {
      ok: false,
      field: 'status',
      code: 'STATUS_ILLEGAL',
      message: `当前状态 ${snapshot.status} 不可暂停（仅投放中可暂停）`,
    };
  }
  return { ok: true };
}

/**
 * 恢复：仅已暂停可恢复。
 *
 * 注意这里**不能只看 canTransition(status, ACTIVE)**：草稿也能到 ACTIVE
 * （那是 publish 的路径），若直接复用会把「草稿」当成「已暂停」，
 * 于是 resume 可以绕过 validatePublish 的全部校验（面额范围、死券检查、
 * 库存倒挂）把草稿直接投放出去。所以显式列举允许的来源状态。
 */
export function validateResume(snapshot: CouponSnapshot): CouponRuleResult {
  // 幂等：投放中重复 resume 不报错
  if (snapshot.status === COUPON_STATUS.ACTIVE) return { ok: true };
  if (snapshot.status !== COUPON_STATUS.PAUSED) {
    return {
      ok: false,
      field: 'status',
      code: 'STATUS_ILLEGAL',
      message: `当前状态 ${snapshot.status} 不可恢复（仅已暂停可恢复；草稿请用发布）`,
    };
  }
  return { ok: true };
}

/** 结束投放：任何非终态都可结束，已结束幂等 */
export function validateEnd(snapshot: CouponSnapshot): CouponRuleResult {
  if (snapshot.status === COUPON_STATUS.ENDED) return { ok: true };
  if (!canTransition(snapshot.status, COUPON_STATUS.ENDED)) {
    return {
      ok: false,
      field: 'status',
      code: 'STATUS_ILLEGAL',
      message: `当前状态 ${snapshot.status} 不可结束`,
    };
  }
  return { ok: true };
}