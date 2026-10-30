// ============================================================================
// 邻伴 · 陪聊员资金读侧装配（service 层）
// ----------------------------------------------------------------------------
// 三个端点（契约 §3.3 资金侧）：
//   GET /payments/income/overview   收入概览（端侧视图模型，不在契约正文）
//   GET /payments/sharings/mine     分账明细（分页）
//   GET /payments/withdrawals       提现记录
//
// 口径纪律：本文件**不含任何余额计算**，全部委托 domain/companion-income.ts。
// 理由见该文件头—— 展示口径与 POST /withdrawals 的扣减口径必须同源。
//
// 隐私纪律（铁律：服务动作可留痕 / L3 加密）：
//   提现列表出参**绝不返回 bank_account_cipher / account_name_cipher**，
//   只返回解密后脱敏的 bankAccountMasked。
//   且解密失败（密钥轮转中 / 数据损坏）时降级为 '****'，
//   不抛 500 —— 陪聊员要的是「提现记录」，不是「密码学服务健康度」，
//   让整页挂掉只会让他以为钱出问题了。
// ============================================================================

import { AppError } from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import { safeDecrypt } from '../../common/crypto';
import {
  LOCKED_WITHDRAWAL_STATUSES,
  SETTLED_WITHDRAWAL_STATUSES,
  buildIncomeOverview,
  maskBankAccount,
} from '../../domain/companion-income';

const log = moduleLogger('companion-income');

/** 密文不可解析时的占位（不区分「解密失败」与「格式非法」，避免向端侧泄露实现细节） */
const BANK_MASK_UNAVAILABLE = '****';
/** 开发回落前缀：密钥未配置时明文落库，见 crypto.maskAddress 同款说明 */
const PLAIN_DEV = 'PLAIN_DEV:';

/** 由密文取脱敏卡号：识别明文回落、失败降级、永不抛 */
export function maskedBankAccountOf(cipher: string): string {
  const plain = cipher.startsWith(PLAIN_DEV) ? cipher.slice(PLAIN_DEV.length) : safeDecrypt(cipher);
  if (!plain) return BANK_MASK_UNAVAILABLE;
  return maskBankAccount(plain);
}

/** 陪聊员主档（不存在则 13001，与 POST /payments/withdrawals 同一错误码） */
async function requireCompanion(userId: bigint) {
  const companion = await prisma.companions.findUnique({
    where: { user_id: userId },
    select: { id: true },
  });
  if (!companion) throw new AppError(13001, '陪聊员主档不存在');
  return companion;
}

/** 本月 UTC 起止（本月入账口径用 shared_at，见 domain 注释） */
function monthRangeUtc(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * GET /payments/income/overview —— 收入概览。
 *
 * 五段口径全在 domain 装配；此处只负责四个 aggregate 的 where 条件正确。
 * 注意 pending 用 FROZEN、locked 用 LOCKED_WITHDRAWAL_STATUSES——
 * 集合从 domain import，**不在此处重复列举**，避免两处定义漂移。
 */
export async function getIncomeOverview(userId: bigint): Promise<{
  availableFen: string;
  pendingFen: string;
  totalSharedFen: string;
  totalWithdrawnFen: string;
  monthSharedFen: string;
}> {
  const companion = await requireCompanion(userId);
  const { from, to } = monthRangeUtc(new Date());
  const cid = companion.id;

  const [shared, frozen, monthShared, locked, settled] = await Promise.all([
    prisma.profit_sharing_records.aggregate({
      where: { order: { companion_id: cid }, status: 'SHARED' },
      _sum: { companion_income_fen: true },
    }),
    prisma.profit_sharing_records.aggregate({
      where: { order: { companion_id: cid }, status: 'FROZEN' },
      _sum: { companion_income_fen: true },
    }),
    prisma.profit_sharing_records.aggregate({
      where: {
        order: { companion_id: cid },
        status: 'SHARED',
        shared_at: { gte: from, lt: to },
      },
      _sum: { companion_income_fen: true },
    }),
    prisma.withdrawals.aggregate({
      where: { companion_id: cid, status: { in: [...LOCKED_WITHDRAWAL_STATUSES] } },
      _sum: { amount_fen: true },
    }),
    prisma.withdrawals.aggregate({
      where: { companion_id: cid, status: { in: [...SETTLED_WITHDRAWAL_STATUSES] } },
      _sum: { amount_fen: true },
    }),
  ]);

  const m = buildIncomeOverview({
    totalSharedFen: shared._sum.companion_income_fen ?? 0n,
    pendingFen: frozen._sum.companion_income_fen ?? 0n,
    monthSharedFen: monthShared._sum.companion_income_fen ?? 0n,
    lockedFen: locked._sum.amount_fen ?? 0n,
    settledFen: settled._sum.amount_fen ?? 0n,
  });

  return {
    availableFen: m.availableFen.toString(),
    pendingFen: m.pendingFen.toString(),
    totalSharedFen: m.totalSharedFen.toString(),
    totalWithdrawnFen: m.totalWithdrawnFen.toString(),
    monthSharedFen: m.monthSharedFen.toString(),
  };
}

/** 分账明细行（契约 §3.3 + 端侧扩展：补平台抽成与时长） */
export interface SharingMineRow {
  orderId: string;
  orderNo: string;
  sharingNo: string;
  status: string;
  frozenAmountFen: string;
  platformCommissionFen: string;
  companionIncomeFen: string;
  commissionRateBp: number;
  /** 服务时长（分钟）：陪聊员核算时薪需要，分账表本身不存 → 从订单取 */
  durationMinutes: number;
  createdAt: string;
  sharedAt: string | null;
  returnedAt: string | null;
}

/**
 * GET /payments/sharings/mine —— 分账明细（分页）。
 *
 * 越权面：where 里带 `order.companion_id = 本人`，
 * **不接受端上传 companionId** —— 否则改个参数就能看别人的收入。
 */
export async function listMySharings(
  userId: bigint,
  page: number,
  pageSize: number,
): Promise<{ list: SharingMineRow[]; total: number }> {
  const companion = await requireCompanion(userId);
  const where = { order: { companion_id: companion.id } };

  const [rows, total] = await Promise.all([
    prisma.profit_sharing_records.findMany({
      where,
      orderBy: { id: 'desc' }, // 分页必须稳定排序，否则翻页有重复/漏项
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        sharing_no: true,
        status: true,
        frozen_amount_fen: true,
        platform_commission_fen: true,
        companion_income_fen: true,
        commission_rate_bp: true,
        shared_at: true,
        returned_at: true,
        created_at: true,
        order: { select: { id: true, order_no: true, duration_minutes: true } },
      },
    }),
    prisma.profit_sharing_records.count({ where }),
  ]);

  return {
    list: rows.map((r) => ({
      orderId: r.order.id.toString(),
      orderNo: r.order.order_no,
      sharingNo: r.sharing_no,
      status: r.status,
      frozenAmountFen: r.frozen_amount_fen.toString(),
      platformCommissionFen: r.platform_commission_fen.toString(),
      companionIncomeFen: r.companion_income_fen.toString(),
      commissionRateBp: r.commission_rate_bp,
      durationMinutes: r.order.duration_minutes,
      createdAt: r.created_at.toISOString(),
      sharedAt: r.shared_at?.toISOString() ?? null,
      returnedAt: r.returned_at?.toISOString() ?? null,
    })),
    total,
  };
}

/** 提现记录行（端侧只用这四个字段） */
export interface WithdrawalMineRow {
  withdrawalNo: string;
  amountFen: string;
  status: string;
  bankAccountMasked: string;
}

/**
 * GET /payments/withdrawals —— 提现记录。
 *
 * 出参是**数组而非分页**（端侧 payment.ts: fetchWithdrawals 返回 WithdrawalView[]）：
 * 提现记录天然条数少（远少于分账明细），强行分页反而让端上多写一层。
 * 这里仍加 take 上限，防止脏数据把响应撑爆。
 */
export async function listMyWithdrawals(userId: bigint): Promise<WithdrawalMineRow[]> {
  const companion = await requireCompanion(userId);
  const rows = await prisma.withdrawals.findMany({
    where: { companion_id: companion.id },
    orderBy: { id: 'desc' },
    take: 200,
    select: {
      withdrawal_no: true,
      amount_fen: true,
      status: true,
      bank_account_cipher: true,
    },
  });

  if (rows.length >= 200) {
    log.warn(
      { event: 'withdrawal-row-cap-hit', companionId: companion.id.toString(), count: rows.length },
      '提现记录触及 200 行上限，出参已截断',
    );
  }

  return rows.map((w) => ({
    withdrawalNo: w.withdrawal_no,
    amountFen: w.amount_fen.toString(),
    status: w.status,
    // 只出脱敏卡号，绝不出 bank_account_cipher（密文也不出，见文件头隐私纪律）
    bankAccountMasked: maskedBankAccountOf(w.bank_account_cipher),
  }));
}