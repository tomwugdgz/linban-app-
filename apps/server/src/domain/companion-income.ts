// ============================================================================
// 邻伴 · 陪聊员收入台账口径（纯函数层，零 IO）
// ----------------------------------------------------------------------------
// 支撑 GET /payments/income/overview（契约 §3.3 资金侧，端侧视图模型）。
//
// ============================================================================
// 为什么把余额口径抽成纯函数，而不是在路由里写个 where 就aggregate
// ----------------------------------------------------------------------------
// 「可提现余额」的定义同时被**两个端点**消费：
//   ① GET  /payments/income/overview  —— 展示给陪聊员看
//   ② POST /payments/withdrawals     —— **据此拒绝超额提现**
// 这两处若各写一份 where，口径一旦漂移，后果是**真金白银**：
//   · 展示口径比扣减口径宽 → 陪聊员看到 ¥500 可提，提现却被拒（体验与信任崩塌）
//   · 展示口径比扣减口径窄 → 陪聊员看到 ¥0 可提，钱却躺在账上不敢提
//   · 两处都"对"但不一致 → 客服每天都在处理「你们后台显示错了」
//
// 而这两条口径**天生就该同源**：都是「已分账收入 − 已占用提现」。
// 抽成纯函数后，两处 import 同一个定义，漂移在编译期就被看见。
//
// ============================================================================
// 口径定义（三条，全部 fail-closed）
// ----------------------------------------------------------------------------
//   已分账收入 totalSharedFen
//       = Σ companion_income_fen where status = SHARED
//       **只算 SHARED**：FROZEN 是「已冻结未分账」，陪聊员看得见但取不走，
//       算进可提余额等于让陪聊员去提一笔平台还没分给他的钱。
//
//   已占用提现 lockedFen
//       = Σ amount_fen where status ∈ { APPROVED, PROCESSING, SUCCESS }
//       **PENDING_REVIEW 也必须扣**：钱还在待审核池里，若不扣，
//       同一笔钱可被反复提交提现（前端不拦、服务端每次都算「够」）——
//       这是并发下最典型的资金超发。注意这与「累计提现」口径不同，见下。
//
//   可提现 availableFen = totalSharedFen − lockedFen
//
//   累计提现 totalWithdrawnFen
//       = Σ amount_fen where status = SUCCESS（**已到账**）
//       与 lockedFen 的区别是刻意的：locked 是「占用中」（防超发），
//       totalWithdrawn 是「历史已到账」（给陪聊员看的成绩单）。
//       两者混用会让「已申请未到账」的钱既不算占用、也不算成绩，从账上蒸发。
//
//   本月入账 monthSharedFen
//       = Σ companion_income_fen where status = SHARED 且 shared_at ∈ 本月（UTC）
//       用 **shared_at** 而非 created_at：created_at 是「下单冻结」时间，
//       用它算「本月入账」会把上月下单本月分账的钱算成本月新收入，
//       运营做收入环比时完全对不上账。
// ============================================================================

/** 分账状态（与 schema enum profit_sharing_status 逐值一致） */
export type SharingStatus = 'FROZEN' | 'SHARED' | 'RETURNED';

/** 提现状态（与 schema enum withdrawal_status 逐值一致） */
export type WithdrawalStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED';

/**
 * **占用提现**的状态集合（防超发）。
 *
 * 为什么含 PENDING_REVIEW：同一笔钱在待审核期间可被反复提交。
 * 端上「再点一次提现」是极常见的动作，不靠前端拦。
 */
export const LOCKED_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = [
  'PENDING_REVIEW',
  'APPROVED',
  'PROCESSING',
  'SUCCESS',
];

/**
 * **已到账提现**的状态集合（给陪聊员看的成绩单）。
 *
 * 刻意只含 SUCCESS：PROCESSING 是「微信在处理」，用户钱还没到，
 * 算进「累计提现」等于虚报。
 */
export const SETTLED_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['SUCCESS'];

export interface IncomeAggregates {
  /** Σ SHARED 的 companion_income_fen（分） */
  totalSharedFen: bigint;
  /** Σ FROZEN 的 companion_income_fen（分）：待入账 */
  pendingFen: bigint;
  /** 本月 shared_at 落在窗口内的 SHARED 收入（分） */
  monthSharedFen: bigint;
  /** Σ 占用态提现（分） */
  lockedFen: bigint;
  /** Σ SUCCESS 提现（分） */
  settledFen: bigint;
}

export interface IncomeOverviewModel {
  /** 可提现余额（分）：totalShared − locked */
  availableFen: bigint;
  /** 待入账（分）：FROZEN 合计 */
  pendingFen: bigint;
  /** 累计已入账（分） */
  totalSharedFen: bigint;
  /** 累计提现（分）：仅 SUCCESS */
  totalWithdrawnFen: bigint;
  /** 本月入账（分） */
  monthSharedFen: bigint;
}

/**
 * 由聚合计数装配概览。
 *
 * availableFen 的**下限钳到 0**：数据不一致时（脏数据 / 提现记录先于分账记录写入）
 * 可能出现 locked > total。返回负数会让陪聊员看到「可提现 −¥30」，
 * 这既不真实也无法行动（提现本来就会被拒），钳 0 更符合业务真相。
 */
export function buildIncomeOverview(agg: IncomeAggregates): IncomeOverviewModel {
  const raw = agg.totalSharedFen - agg.lockedFen;
  return {
    availableFen: raw > 0n ? raw : 0n,
    pendingFen: agg.pendingFen,
    totalSharedFen: agg.totalSharedFen,
    totalWithdrawnFen: agg.settledFen,
    monthSharedFen: agg.monthSharedFen,
  };
}

/** 单笔提现能否被受理（供 POST /payments/withdrawals 复用，与展示同源） */
export interface WithdrawDecision {
  allowed: boolean;
  reason?: 'AMOUNT_NOT_POSITIVE' | 'EXCEEDS_AVAILABLE' | 'LOCK_MISSING';
}

/**
 * 提现受理判定。
 *
 * **这是防超发的最后一道闸**：真正的防超发靠
 * `withdrawals.idempotency_key` 唯一索引 + 事务内 re-check，
 * 本函数只负责「让拒绝有明确原因」，不承担并发安全。
 * 把职责边界写清，免得后人以为调了它就线程安全了。
 */
export function canWithdraw(amountFen: bigint, availableFen: bigint): WithdrawDecision {
  if (amountFen <= 0n) return { allowed: false, reason: 'AMOUNT_NOT_POSITIVE' };
  if (amountFen > availableFen) return { allowed: false, reason: 'EXCEEDS_AVAILABLE' };
  return { allowed: true };
}

/** 银行卡脱敏（前 4 后 4；不足 8 位整体打码） */
export function maskBankAccount(account: string): string {
  const n = account.replace(/\s+/g, '');
  if (n.length < 8) return '****';
  return `${n.slice(0, 4)}********${n.slice(-4)}`;
}