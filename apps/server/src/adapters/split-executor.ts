// ============================================================================
// 邻伴 · 分账执行器（adapters 层核心，架构 §7.5 / §7.6 模式开关）
// ----------------------------------------------------------------------------
// 设计目标（主理人明确要求）：
//   分账执行做成「接口 + 模式开关」，由 system_configs.split_mode 驱动，
//   POC 结论回来后只换适配器实现、不动业务代码。
//
// 两种模式：
//   SPLIT_MODE=wechat_profit_sharing（主路径，默认）
//     · 付款冻结（profit_sharing=true）→ 双向核销后分账；
//     · 平台留成 + 陪聊员直达个人 openid（PERSONAL_OPENID）；
//     · 回退/解冻走微信分账回退接口。
//   SPLIT_MODE=manual_settlement_fallback（兜底，灰度联调专用）
//     · 平台 100% 收款 + 人工结算：execute() 不调微信分账，
//       登记人工工单（manual_ticket_no），分账记录保持 FROZEN 等人工处理；
//     · 微信侧无待分账资金 → returnSharing 不支持（15018），
//       unfreezeRemaining 为本地记账空操作；
//     · 上线前必须切回主路径（架构 §7.5 红线）。
//
// 模式切换纪律：
//   · 开关在 system_configs（split_mode），后台可改但写 audit_logs；
//   · 单个订单的分账记录以创建时模式为准（sharing 记录快照模式），
//     避免进行中订单因全局切换而「半微信半人工」。
// ============================================================================

import { AppError } from '@linban/shared';
import { SPLIT_MODE } from '@linban/shared';
import type { SplitMode } from '@linban/shared';
import { genBizNo } from '../common/ids';
import { getWxPayAdapter } from './wechat/pay';
import type { ProfitSharingReceiver } from './wechat/pay';

/** 分账执行器接口（业务代码只依赖此接口） */
export interface ProfitSharingExecutor {
  readonly mode: SplitMode;
  /**
   * 执行分账（门闩已由 domain 校验，此处只做渠道动作）。
   * 成功 → service 推进 profit_sharing_records.status=SHARED；
   * 失败 → 返回失败原因（service 累加 retry_count，≥3 升级工单）；
   * 兜底模式 → pendingHumanSettlement=true（保持 FROZEN，登记工单）。
   */
  execute(input: SharingExecuteInput): Promise<SharingExecuteResult>;
  /** 分账回退（已分账资金退回用户，架构 §7.4） */
  returnSharing(input: SharingReturnInput): Promise<SharingReturnResult>;
  /** 解除剩余待分账（未分账资金，架构 §7.4） */
  unfreezeRemaining(input: ExecUnfreezeInput): Promise<ExecUnfreezeResult>;
}

export interface SharingExecuteInput {
  orderId: bigint;
  orderNo: string;
  /** 我方分账单号（profit_sharing_records.sharing_no） */
  sharingNo: string;
  /** 微信支付单号（payments.wx_transaction_id） */
  wxTransactionId: string;
  platformCommissionFen: bigint;
  companionIncomeFen: bigint;
  /** 陪聊员 openid（分账接收方，个人直达） */
  companionOpenid: string;
  /** 抽成基点快照（记录回单审计） */
  commissionRateBp: number;
  /** 平台商户号（服务商模式；缺省走环境配置） */
  spMchid?: string;
}

export interface SharingExecuteResult {
  success: boolean;
  mode: SplitMode;
  /** 微信分账回单号（SHARED 时落 wx_sharing_order_no） */
  wxSharingOrderNo: string | null;
  /** 兜底模式人工工单号 */
  manualTicketNo: string | null;
  /** true = 已登记人工结算，记录保持 FROZEN 等人工 */
  pendingHumanSettlement: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface SharingReturnInput {
  orderId: bigint;
  orderNo: string;
  sharingNo: string;
  /** 我方回退单号 */
  outReturnNo: string;
  returnAmountFen: bigint;
  reason: string;
}

export interface SharingReturnResult {
  success: boolean;
  wxReturnNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** 解冻入参（执行器侧命名，避免与微信适配器同名类型冲突） */
export interface ExecUnfreezeInput {
  orderId: bigint;
  sharingNo: string;
  wxTransactionId: string;
}

export interface ExecUnfreezeResult {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// 主路径：微信服务商自动分账（mock 适配器）
// ---------------------------------------------------------------------------

export class WechatProfitSharingExecutor implements ProfitSharingExecutor {
  readonly mode: SplitMode = SPLIT_MODE.WECHAT_PROFIT_SHARING;
  private wxPay = getWxPayAdapter();

  async execute(input: SharingExecuteInput): Promise<SharingExecuteResult> {
    // 金额恒等式本地再校（防御 service 层组装错误）
    if (input.platformCommissionFen + input.companionIncomeFen <= 0n) {
      return {
        success: false,
        mode: this.mode,
        wxSharingOrderNo: null,
        manualTicketNo: null,
        pendingHumanSettlement: false,
        errorCode: 'AMOUNT_INVALID',
        errorMessage: '分账金额非正',
      };
    }
    const receivers: ProfitSharingReceiver[] = [
      {
        type: 'MERCHANT_ID',
        account: input.spMchid ?? process.env.WXPAY_SP_MCHID ?? '',
        amountFen: input.platformCommissionFen,
        description: '平台服务费',
      },
      {
        type: 'PERSONAL_OPENID',
        account: input.companionOpenid,
        amountFen: input.companionIncomeFen,
        description: `陪聊服务收入（订单 ${input.orderNo}）`,
      },
    ];
    const res = await this.wxPay.profitSharing({
      sharingNo: input.sharingNo,
      transactionId: input.wxTransactionId,
      outOrderNo: input.sharingNo,
      receivers,
    });
    return {
      success: res.success,
      mode: this.mode,
      wxSharingOrderNo: res.sharingOrderNo,
      manualTicketNo: null,
      pendingHumanSettlement: false,
      errorCode: res.errorCode,
      errorMessage: res.errorMessage,
    };
  }

  async returnSharing(input: SharingReturnInput): Promise<SharingReturnResult> {
    const res = await this.wxPay.profitSharingReturn({
      sharingNo: input.sharingNo,
      outReturnNo: input.outReturnNo,
      returnAmountFen: input.returnAmountFen,
      reason: input.reason,
    });
    return { success: res.success, wxReturnNo: res.returnNo, errorCode: res.errorCode, errorMessage: res.errorMessage };
  }

  async unfreezeRemaining(input: ExecUnfreezeInput): Promise<ExecUnfreezeResult> {
    const res = await this.wxPay.unfreezeRemaining({ sharingNo: input.sharingNo, transactionId: input.wxTransactionId });
    return { success: res.success, errorCode: res.errorCode, errorMessage: res.errorMessage };
  }
}

// ---------------------------------------------------------------------------
// 兜底路径：平台收款 + 人工结算（架构 §7.5）
// ---------------------------------------------------------------------------

export class ManualSettlementFallbackExecutor implements ProfitSharingExecutor {
  readonly mode: SplitMode = SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK;

  async execute(input: SharingExecuteInput): Promise<SharingExecuteResult> {
    // 不调微信分账：登记人工工单，等财务线下结算。
    // 分账记录保持 FROZEN + manual_ticket_no，待人工打款后由后台推进 SHARED。
    const manualTicketNo = genBizNo('sharing'); // SHR 前缀工单号（复用分账单号空间）
    return {
      success: false,
      mode: this.mode,
      wxSharingOrderNo: null,
      manualTicketNo,
      pendingHumanSettlement: true,
      errorCode: null,
      errorMessage: '当前为兜底人工结算模式：已登记人工工单，等待财务结算',
    };
  }

  async returnSharing(_input: SharingReturnInput): Promise<SharingReturnResult> {
    // 兜底模式未走过微信分账，无「回退」动作；退款走原路退（wxPay.refund）
    throw new AppError(15018, '兜底人工结算模式不支持微信分账回退（请走订单退款链路）');
  }

  async unfreezeRemaining(_input: ExecUnfreezeInput): Promise<ExecUnfreezeResult> {
    // 兜底模式无微信侧待分账资金 → 本地记账空操作
    return { success: true, errorCode: null, errorMessage: null };
  }
}

// ---------------------------------------------------------------------------
// 工厂（按模式返回执行器；模式由 system_configs.split_mode 驱动）
// ---------------------------------------------------------------------------

const EXECUTORS: Record<SplitMode, () => ProfitSharingExecutor> = {
  [SPLIT_MODE.WECHAT_PROFIT_SHARING]: () => new WechatProfitSharingExecutor(),
  [SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK]: () => new ManualSettlementFallbackExecutor(),
};

/** 获取分账执行器（未知模式回落主路径 + 告警） */
export function getProfitSharingExecutor(mode: SplitMode): ProfitSharingExecutor {
  const factory = EXECUTORS[mode];
  if (!factory) {
    console.error(`[split-executor] 未知分账模式 ${mode}，回落主路径`);
    return new WechatProfitSharingExecutor();
  }
  return factory();
}

/** 环境变量默认模式（system_configs 缺失时回落） */
export function defaultSplitMode(): SplitMode {
  const env = process.env.SPLIT_MODE;
  if (env === SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK) return SPLIT_MODE.MANUAL_SETTLEMENT_FALLBACK;
  return SPLIT_MODE.WECHAT_PROFIT_SHARING;
}
