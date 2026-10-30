// ============================================================================
// 收入服务（分账概览）—— 委托给 payment.ts，避免两处重复定义同一端点
// ----------------------------------------------------------------------------
// 三个 service 的职责边界（主理人派单二指定）：
//   payment.ts      契约 §3.3 资金侧：/payments/order/:id、/payments/withdrawals、
//                   /payments/split-mode（预估到手金额唯一来源、提现幂等键在此）
//   risk.ts         契约 §5.5：/risk/sos、/risk/reports、/risk/complaints/mine
//   verification.ts 契约 §3.4/§4.3：/verifications/arrival-code、/verifications/order/:id
//   order.ts        契约 §4.2 订单动作链（接单/到岗/开始/结束/确认/取消）
// 本文件只保留「收入概览」这一个聚合视图（GET /payments/income/overview），
// 它不在契约里，是端侧视图模型，故留在 income.ts；分账明细与提现已迁到 payment.ts。
// ============================================================================

import { http } from './request'
import type { IncomeOverview } from '@/types'

/** 收入概览（可提现 / 待入账 / 累计入账 / 累计提现 / 本月入账），金额单位均为「分」 */
export async function fetchIncomeOverview(): Promise<IncomeOverview> {
  return http.get<IncomeOverview>('/payments/income/overview')
}