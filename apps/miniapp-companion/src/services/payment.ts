// ============================================================================
// 支付 / 分账 / 提现服务（契约 §3.3 `/payments`）
// ----------------------------------------------------------------------------
// 本模块是「陪聊员的钱」的**唯一口径来源**，三条硬约束：
//
// 1. 预估到手金额一律从服务端取（GET /payments/order/:orderId → sharings[].companionIncomeFen
//    与 platformCommissionFen），前端**禁止硬编码 5–10% 佣金**——费率走
//    system_configs，运营可调，写死会导致对账不上且投诉。
// 2. 提现是资金写操作，必须带 Idempotency-Key（契约 §1）；缺幂等键的重试会重复出款。
// 3. GET /payments/split-mode 决定「钱为什么还没到账」的文案：
//    manual_settlement_fallback（兜底人工结算）时必须显式告诉陪聊员
//    「资金由平台人工结算」，否则「服务完了钱没到」会被当成平台跑路。
//
// 防飞单（红线 §7.2.1）：服务核销完成前资金处于 FROZEN（待分账），
// 可见但不可提现；提现只提交申请，放款由服务端审核（withdrawal_status 流转）。
// ============================================================================

import { http } from './request'
import { SPLIT_MODE } from '@linban/shared'
import type {
  CompanionSharingView,
  OrderPaymentView,
  PageResult,
  SharingRecordView,
  SplitModeView,
  WithdrawalView,
} from '@/types'

/** 订单支付流水 + 分账记录聚合（GET /payments/order/:orderId） */
export interface OrderPaymentDetail {
  payment: OrderPaymentView | null
  sharings: CompanionSharingView[]
}

/**
 * 查订单支付流水与分账记录（GET /payments/order/:orderId）
 * 收入中心/订单详情展示「预估到手」「平台服务费」的唯一来源。
 */
export async function fetchOrderPayment(orderId: string): Promise<OrderPaymentDetail> {
  return http.get<OrderPaymentDetail>(`/payments/order/${orderId}`)
}

/**
 * 分账模式（GET /payments/split-mode）
 * 命中人工结算兜底时，页面须追加「资金由平台人工结算，预计 N 小时内到账」说明。
 */
export async function fetchSplitMode(): Promise<SplitModeView> {
  const raw = await http.get<Partial<SplitModeView> | string>('/payments/split-mode')
  // 兼容服务端直接返回字符串模式值的形态
  if (typeof raw === 'string') {
    return {
      mode: raw,
      manualSettlement: raw === SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK,
      manualSettleHours: null,
      tip: null,
    }
  }
  const mode = raw.mode || SPLIT_MODE.WECHAT_PROFIT_SHARING
  return {
    mode,
    manualSettlement:
      typeof raw.manualSettlement === 'boolean'
        ? raw.manualSettlement
        : mode === SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK,
    manualSettleHours: raw.manualSettleHours ?? null,
    tip: raw.tip ?? null,
  }
}

/** 分账明细（GET /payments/sharings/mine） */
export async function fetchSharingRecords(
  page = 1,
  pageSize = 20,
): Promise<PageResult<SharingRecordView>> {
  return http.get<PageResult<SharingRecordView>>(
    `/payments/sharings/mine?page=${page}&pageSize=${pageSize}`,
  )
}

/** 提现记录（GET /payments/withdrawals） */
export async function fetchWithdrawals(): Promise<WithdrawalView[]> {
  return http.get<WithdrawalView[]>('/payments/withdrawals')
}

/** 提现入参（POST /payments/withdrawals） */
export interface ApplyWithdrawalInput {
  /** 提现金额（分）—— 服务端校验可提余额与单笔上下限 */
  amountFen: string
  bankName: string
  /** 收款账号（明文提交，服务端落库即脱敏；响应只回 masked） */
  bankAccount: string
  /** 收款人姓名 */
  accountName: string
  /** 人脸二次验证通过（服务端会二次核验 faceVerifyId） */
  faceVerified: boolean
  /** 短信二次验证通过 */
  smsVerified: boolean
}

/**
 * 提交提现申请（POST /payments/withdrawals）
 *
 * **资金动作，幂等键必传**：调用方须传入 idempotencyKey（同一笔提现重试复用同一个键），
 * 否则网络超时后用户重复点击会重复出款。
 * TODO(联调)：服务端要求人脸 + 短信二次验证的 verifyToken 由风控模块下发，
 *             当前只上传布尔标记，联调时补 token 字段。
 */
export async function applyWithdrawal(
  input: ApplyWithdrawalInput,
  idempotencyKey: string,
): Promise<WithdrawalView> {
  return http.post<WithdrawalView>(
    '/payments/withdrawals',
    input as unknown as Record<string, unknown>,
    false,
    idempotencyKey,
  )
}