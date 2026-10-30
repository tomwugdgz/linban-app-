// ============================================================================
// 邻伴 · 保险渠道适配器（adapters 层，架构 §9：MVP 半自动登记）
// ----------------------------------------------------------------------------
// 场景：每单自动投保意外险（订单支付成功后登记保单），出险走理赔登记。
// MVP 策略（架构 §9）：保单登记「半自动」——本适配器创建保单记录，
// 真实投保动作可由渠道后台批量完成；理赔材料人工收单。
//
// 真实集成点 TODO：
//   · API：保险渠道开放 API（渠道待定，占位 INSURANCE_API_BASE/KEY）；
//   · 保单号回填 insurance_policies.policy_no；理赔单关联 risk/complaint。
// ============================================================================

import { AppError } from '@linban/shared';

export interface InsuranceAdapter {
  /** 为订单投保（返回保单号与保费） */
  createPolicy(input: CreatePolicyInput): Promise<CreatePolicyResult>;
  /** 理赔登记 */
  createClaim(input: CreateClaimInput): Promise<CreateClaimResult>;
  /** 查询保单状态 */
  queryPolicy(policyNo: string): Promise<{ status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; startAt: Date; endAt: Date }>;
}

export interface CreatePolicyInput {
  orderId: string;
  orderNo: string;
  /** 被保险人（陪聊员）真实姓名密文引用 */
  insuredNameCipher: string;
  coverageAmountFen: bigint; // 保额（分）
  startAt: Date;
  endAt: Date;
}

export interface CreatePolicyResult {
  /**
   * 🔴 **渠道方保单号**，不是我方单号。
   *
   * 【字段语义单一原则】一个字段只装一种东西。
   *   我方单号（`policy_no`）= `genBizNo('policy')` 生成，由 **routes/service 层**负责；
   *   渠道单号（本字段）    = 渠道 API 返回值，由 **adapter** 负责。
   *   两者混进同一个列是**语义混用**——数据看着都对，但解析会错，
   *   且这种 bug 查不出来（格式都像单号，都能查回，唯独「按前缀判断来源」会全错）。
   *
   * 【为什么现在就要拆】
   *   接入真实渠道后，`policy_no` 一个字段要同时装「我方单号」和「渠道单号」，
   *   那时历史数据已经在里面了，改起来是迁移。**趁数据少拆掉，成本最低。**
   *
   * 【MVP 现状】渠道未定（mock），此字段返回 mock 形态单号，
   *   但**语义已经是渠道单号**，接入真实渠道时直接换成渠道返回值即可，
   *   上层不用动。
   */
  channelPolicyNo: string;
  premiumFen: bigint;
}

export interface CreateClaimInput {
  policyNo: string;
  orderId: string;
  /** 出险原因 + 证明材料 objectKey 列表 */
  reason: string;
  evidenceObjectKeys: string[];
}

export interface CreateClaimResult {
  claimNo: string;
  status: 'PENDING';
}

/** Mock：保费按订单时长估算（1 元/小时，联调用） */
export class MockInsuranceAdapter implements InsuranceAdapter {
  async createPolicy(input: CreatePolicyInput): Promise<CreatePolicyResult> {
    if (!input.orderId) throw new AppError(19101, '投保缺少订单信息');
    const hours = Math.max(1, Math.round((input.endAt.getTime() - input.startAt.getTime()) / 3600000));
    return {
      // ⚠️ 这里返回的是**渠道单号**（语义），mock 用一个明显的渠道形态占位。
      //   **我方单号不在这里生成** —— 由调用方 genBizNo('policy') 生成，
      //   两者分别落 `policy_no` 与 `channel_policy_no`（见 CreatePolicyResult 注释）。
      //   刻意不用 POL 前缀：那是我方号段，若mock 也用 POL，
      //   就复现了「同一业务两种单号无法区分来源」的原始缺陷。
      channelPolicyNo: `MOCKCH${Date.now()}${input.orderNo.slice(-6)}`,
      premiumFen: BigInt(hours * 100), // ¥1/小时
    };
  }

  async createClaim(input: CreateClaimInput): Promise<CreateClaimResult> {
    if (!input.policyNo) throw new AppError(19101, '理赔缺少保单号');
    return { claimNo: `CLM${Date.now()}`, status: 'PENDING' };
  }

  async queryPolicy(policyNo: string): Promise<{ status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; startAt: Date; endAt: Date }> {
    const now = new Date();
    return { status: 'ACTIVE', startAt: now, endAt: new Date(now.getTime() + 24 * 3600 * 1000) };
  }
}

export class RealInsuranceAdapter implements InsuranceAdapter {
  async createPolicy(_input: CreatePolicyInput): Promise<CreatePolicyResult> {
    // TODO(真实集成)：渠道投保 API（INSURANCE_API_BASE + INSURANCE_API_KEY）
    throw new AppError(90004, '真实保险投保未实现');
  }
  async createClaim(_input: CreateClaimInput): Promise<CreateClaimResult> {
    // TODO(真实集成)：渠道理赔 API
    throw new AppError(90004, '真实保险理赔未实现');
  }
  async queryPolicy(_policyNo: string): Promise<{ status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; startAt: Date; endAt: Date }> {
    // TODO(真实集成)：渠道保单查询 API
    throw new AppError(90004, '真实保单查询未实现');
  }
}

export function getInsuranceAdapter(): InsuranceAdapter {
  return new MockInsuranceAdapter();
}
