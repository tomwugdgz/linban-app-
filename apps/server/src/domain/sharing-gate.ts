// ============================================================================
// 邻伴 · 分账门闩（架构 §8.1：防飞单机制 1×3 的工程保证）
// ----------------------------------------------------------------------------
// payment.executeSharing(orderId) 的硬性前置校验，缺一不可执行分账：
//   1. orders.status = COMPLETED（双方确认）；
//   2. verifications 存在通过记录（动态码 + 人脸分数 ≥ 阈值 + GPS 偏差 ≤ 阈值）；
//   3. risk_events 无未决的该订单挂起工单。
// 任一不满足 → 拒绝分账并告警。
//
// 本文件是 §8.1 要求的 domain 侧纯函数实现（零 IO，可单测）；
// service 侧（payment 模块）在调用微信分账前做二次校验（双保险），
// 并把本函数返回的 failures 写入告警与 manual_ticket_no 升级流程。
//
// 附加约束（DATABASE.md §2.2 / 架构 §6.2）：
//   · 分账记录必须处于 FROZEN（分账失败不推进状态，retry_count 累加）；
//   · retry_count ≥ maxRetry（默认 3）已升级人工工单，禁止自动重试。
// ============================================================================

import { AppError } from '@linban/shared';
import type { order_status, profit_sharing_status, verification_status } from '@linban/shared';
import { SHARING_RETRY_MAX } from '@linban/shared';

/** 门闩输入（由 service 组装：订单事实 + 核销事实 + 风控事实 + 分账记录状态） */
export interface SharingGateInput {
  /** 订单当前状态（必须 COMPLETED） */
  orderStatus: order_status;
  /** 该订单的到岗核销记录（ARRIVAL 类型；无记录传 null） */
  verification: {
    status: verification_status;
    faceScore: number | null; // 人脸比对分（0–100）
    gpsDeviationM: number | null; // 与订单地址偏差（米）
  } | null;
  /** 人脸比对通过阈值（system_configs.face_match_threshold） */
  faceMatchThreshold: number;
  /** GPS 最大偏差（米，system_configs.gps_max_deviation） */
  gpsMaxDeviation: number;
  /** 该订单是否存在未决风控挂起工单（risk_events） */
  hasPendingRiskEvent: boolean;
  /** 分账记录当前状态（必须 FROZEN） */
  sharingStatus: profit_sharing_status;
  /** 已重试次数（≥ maxRetry 时已升级人工工单，禁止自动执行） */
  retryCount: number;
  /** 自动重试上限（默认架构 §6.2/§7.5：3） */
  maxRetry?: number;
}

/** 单条门闩失败（规则编码 + 错误码 + 说明，供告警/日志/前端 payload） */
export interface GateFailure {
  /** 门闩规则编码（风控规则库可引用） */
  rule: string;
  /** 对应错误码（见 packages/shared 错误码表） */
  code: number;
  message: string;
}

/** 门闩校验结果 */
export interface GateResult {
  pass: boolean;
  failures: GateFailure[];
}

/**
 * 分账门闩校验（纯函数）。
 * 全量返回失败项而非短路——便于一次告警列明全部阻塞原因（§8.1「拒绝并告警」）。
 */
export function checkSharingGate(input: SharingGateInput): GateResult {
  const maxRetry = input.maxRetry ?? SHARING_RETRY_MAX;
  const failures: GateFailure[] = [];

  // 规则 1：订单必须双方确认完成
  if (input.orderStatus !== 'COMPLETED') {
    failures.push({
      rule: 'GATE_ORDER_STATUS',
      code: 15006,
      message: `订单状态为 ${input.orderStatus}，需 COMPLETED（双方确认）`,
    });
  }

  // 规则 2：核销通过记录必须存在
  if (!input.verification || input.verification.status !== 'PASSED') {
    failures.push({
      rule: 'GATE_VERIFICATION',
      code: 15006,
      message: input.verification ? '核销记录未通过' : '缺少到岗核销通过记录',
    });
  } else {
    // 规则 2a：人脸分数 ≥ 阈值
    if (input.verification.faceScore === null || input.verification.faceScore < input.faceMatchThreshold) {
      failures.push({
        rule: 'GATE_FACE_SCORE',
        code: 16005,
        message: `人脸比对分 ${input.verification.faceScore ?? 'null'} 低于阈值 ${input.faceMatchThreshold}`,
      });
    }
    // 规则 2b：GPS 偏差 ≤ 阈值
    if (input.verification.gpsDeviationM === null || input.verification.gpsDeviationM > input.gpsMaxDeviation) {
      failures.push({
        rule: 'GATE_GPS_DEVIATION',
        code: 16007,
        message: `GPS 偏差 ${input.verification.gpsDeviationM ?? 'null'}m 超出阈值 ${input.gpsMaxDeviation}m`,
      });
    }
  }

  // 规则 3：无未决风控挂起工单
  if (input.hasPendingRiskEvent) {
    failures.push({
      rule: 'GATE_RISK_EVENT',
      code: 20002,
      message: '该订单存在未决风控挂起工单',
    });
  }

  // 附加规则 4：分账记录必须处于 FROZEN（防重复执行/对已回退单执行）
  if (input.sharingStatus !== 'FROZEN') {
    failures.push({
      rule: 'GATE_SHARING_STATUS',
      code: 15007,
      message: `分账记录状态为 ${input.sharingStatus}，需 FROZEN`,
    });
  }

  // 附加规则 5：重试未超限（超限已升级人工工单，禁止自动执行）
  if (input.retryCount >= maxRetry) {
    failures.push({
      rule: 'GATE_RETRY_EXHAUSTED',
      code: 15008,
      message: `分账重试已达上限 ${maxRetry}，已升级人工工单`,
    });
  }

  return { pass: failures.length === 0, failures };
}

/**
 * 门闩断言版本：不通过抛 AppError(15006 SHARING_GATE_BLOCKED)，
 * payload 携带全部失败项（service 层写入告警与工单）。
 */
export function assertSharingGate(input: SharingGateInput): void {
  const result = checkSharingGate(input);
  if (!result.pass) {
    throw new AppError(15006, result.failures.map((f) => f.message).join('；'), {
      failures: result.failures as unknown as Record<string, unknown>[],
    });
  }
}

/** 门闩通过且可执行分账的便捷判断（含分账记录状态与重试限制） */
export function canExecuteSharing(input: SharingGateInput): boolean {
  return checkSharingGate(input).pass;
}
