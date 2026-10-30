// ============================================================================
// 邻伴 · 微信支付适配器（adapters 层：JSAPI 下单 / 分账 / 回退 / 解冻 / 回调）
// ----------------------------------------------------------------------------
// 资金链路（架构 §7）：
//   1. jsapiPrepay    用户付款 → 款项 100% 进平台担保户（profit_sharing=true）；
//   2. parseNotify    回调验签 → 幂等推进（已 SUCCESS 直接 ack）；
//   3. profitSharing  双向核销后分账：平台留成 + 陪聊员直达个人 openid；
//   4. profitSharingReturn  已分账资金回退（分账回退接口）；
//   5. unfreezeRemaining    未分账资金解除剩余待分账；
//   6. refund         订单退款（原路退回）；
//   7. queryOrder     掉单补偿扫描（支付回调丢失时主动查单）；
//   8. downloadBill   每日对账拉取微信账单（架构 §7.5）。
//
// 真实集成点 TODO：
//   · SDK/API：微信支付服务商 APIv3（或 wechatpay-node-v3）；
//   · 凭证：WXPAY_SP_MCHID / WXPAY_APIV3_KEY / WXPAY_CERT_SERIAL_NO /
//     WXPAY_PRIVATE_KEY_PATH / WXPAY_CERT_PATH / 各 NOTIFY_URL（.env.example）；
//   · 回调验签：Wechatpay-Signature + 平台证书（APIv3 应答签名验证）；
//   · 分账接收方：陪聊员个人 openid（RECEIVER_TYPE=PERSONAL_OPENID）。
//
// Mock 约定：确定性成功 + 可注入失败（mockNextFailure），
// 便于 service 层重试/工单升级链路的联调（架构 §6.2 6a/§7.5）。
// ============================================================================

import { randomBytes } from 'node:crypto';
import { AppError } from '@linban/shared';

/** 微信支付适配器接口（业务只依赖接口，禁直接引 SDK） */
export interface WxPayAdapter {
  /** JSAPI 下单（返回 prepay_id + 小程序 wx.requestPayment 参数） */
  jsapiPrepay(input: JsapiPrepayInput): Promise<JsapiPrepayResult>;
  /** 回调报文验签 + 解密（支付/分账/退款共用入口按类型分发） */
  parseNotify(rawBody: unknown, headers: Record<string, string>): Promise<WxPayNotify>;
  /** 请求分账（平台留成 + 陪聊员直达） */
  profitSharing(input: ProfitSharingInput): Promise<ProfitSharingResult>;
  /** 分账回退（已分账资金退回用户，架构 §7.4） */
  profitSharingReturn(input: ProfitSharingReturnInput): Promise<ProfitSharingReturnResult>;
  /** 解除剩余待分账（未分账资金，架构 §7.4） */
  unfreezeRemaining(input: UnfreezeInput): Promise<UnfreezeResult>;
  /** 退款（原路退回，架构 §7.4 各场景） */
  refund(input: RefundInput): Promise<RefundResult>;
  /** 主动查单（掉单补偿） */
  queryOrder(outTradeNo: string): Promise<WxOrderQuery>;
  /** 下载对账单（每日对账） */
  downloadBill(input: { billDate: string; channel: string }): Promise<WxBill>;
}

// ---- 入参/出参类型 ----

export interface JsapiPrepayInput {
  outTradeNo: string; // wx_out_trade_no（我方单号，UK）
  amountFen: bigint; // 订单实收（分）
  openid: string; // 付款用户 openid
  description: string;
  notifyUrl: string;
  profitSharing: boolean; // 服务商分账标记（恒 true，架构 §7.1）
  attach?: string;
}

export interface JsapiPrepayResult {
  prepayId: string;
  /** 小程序 wx.requestPayment 需要的 timeStamp/nonceStr/package/signType/paySign */
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export type WxNotifyType = 'PAYMENT' | 'REFUND';

export interface WxPayNotify {
  type: WxNotifyType;
  outTradeNo: string;
  transactionId: string;
  amountFen: bigint;
  paidAt: Date | null;
  /** 支付成功标记（回调语义） */
  success: boolean;
  /** 退款通知专用 */
  refundId?: string;
  refundAmountFen?: bigint;
  refundStatus?: 'SUCCESS' | 'ABNORMAL' | 'CLOSED';
  raw: unknown;
}

export interface ProfitSharingReceiver {
  /** 分账接收方类型：平台商户 / 个人 openid */
  type: 'MERCHANT_ID' | 'PERSONAL_OPENID';
  account: string;
  amountFen: bigint;
  description: string;
}

export interface ProfitSharingInput {
  sharingNo: string; // 我方分账单号
  transactionId: string; // 微信支付单号
  outOrderNo: string; // 微信侧分账订单号（商户系统内部的分账单号）
  receivers: ProfitSharingReceiver[];
}

export interface ProfitSharingResult {
  success: boolean;
  sharingOrderNo: string | null; // 微信分账单号（回单）
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ProfitSharingReturnInput {
  sharingNo: string;
  outReturnNo: string; // 我方回退单号
  returnAmountFen: bigint;
  reason: string;
}

export interface ProfitSharingReturnResult {
  success: boolean;
  returnNo: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface UnfreezeInput {
  sharingNo: string;
  transactionId: string;
}

export interface UnfreezeResult {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface RefundInput {
  outTradeNo: string;
  outRefundNo: string; // 我方退款单号
  refundAmountFen: bigint;
  totalAmountFen: bigint;
  reason: string;
  notifyUrl: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string | null;
  refundedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface WxOrderQuery {
  outTradeNo: string;
  tradeState: 'SUCCESS' | 'REFUND' | 'NOTPAY' | 'CLOSED' | 'REVOKED' | 'USERPAYING' | 'PAYERROR';
  transactionId: string | null;
  amountFen: bigint | null;
  paidAt: Date | null;
}

export interface WxBill {
  billDate: string;
  channel: string;
  /** 明细行（对账解析后）：交易单号 + 金额 + 状态 */
  lines: { transactionId: string; outTradeNo: string; amountFen: bigint; status: string }[];
}

// ---- Mock 实现 ----

/**
 * Mock 微信支付：确定性假回单 + 失败注入钩子。
 * 失败注入用于联调 service 层重试与工单升级（§6.2 6a / §7.5）：
 *   mockNextFailure = { op: 'profitSharing', times: 2 } → 接下来 2 次分账失败。
 */
interface MockFailure {
  op: 'profitSharing' | 'refund' | 'profitSharingReturn' | 'unfreezeRemaining';
  times: number;
  errorCode: string;
  errorMessage: string;
}

export class MockWxPayAdapter implements WxPayAdapter {
  private failures: MockFailure[] = [];
  /** 已「支付」订单表（mock 侧状态机，供 queryOrder 一致性） */
  private paidOrders = new Map<string, { transactionId: string; amountFen: bigint; paidAt: Date }>();
  /** 已「分账」记录（mock 侧幂等：同 sharingNo 重复分账返回首次回单） */
  private sharedOrders = new Map<string, string>();

  /** 测试/联调钩子：注入接下来 N 次指定操作失败 */
  mockNextFailure(op: MockFailure['op'], times = 1, errorCode = 'MOCK_ERROR', errorMessage = 'mock 注入失败'): void {
    this.failures.push({ op, times, errorCode, errorMessage });
  }

  private consumeFailure(op: MockFailure['op']): MockFailure | null {
    const idx = this.failures.findIndex((f) => f.op === op && f.times > 0);
    if (idx === -1) return null;
    const f = this.failures[idx]!;
    f.times -= 1;
    return f;
  }

  async jsapiPrepay(input: JsapiPrepayInput): Promise<JsapiPrepayResult> {
    if (input.amountFen <= 0n) {
      throw new AppError(15003, '下单金额必须大于 0');
    }
    const prepayId = `wx${randomBytes(12).toString('hex')}`;
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(16).toString('hex');
    return {
      prepayId,
      timeStamp,
      nonceStr,
      package: `prepay_id=${prepayId}`,
      signType: 'RSA',
      paySign: 'MOCK_PAY_SIGN', // TODO(真实集成)：RSA-SHA256 with WXPAY_PRIVATE_KEY_PATH
    };
  }

  async parseNotify(rawBody: unknown, _headers: Record<string, string>): Promise<WxPayNotify> {
    // TODO(真实集成)：Wechatpay-Signature 验签 + AEAD_AES_256_GCM 解密 resource
    // mock：信任报文结构（回调入口在 payment service 仍做业务幂等校验）
    const body = rawBody as {
      event_type?: string;
      out_trade_no?: string;
      transaction_id?: string;
      amount?: { total?: number; payer_total?: number };
      success_time?: string;
      refund_id?: string;
      refund_status?: string;
    };
    if (!body?.out_trade_no) {
      throw new AppError(15004, '微信回调报文缺少 out_trade_no');
    }
    const isRefund = body.event_type === 'REFUND.SUCCESS' || Boolean(body.refund_id);
    if (isRefund) {
      return {
        type: 'REFUND',
        outTradeNo: body.out_trade_no,
        transactionId: body.transaction_id ?? '',
        amountFen: BigInt(body.amount?.total ?? 0),
        paidAt: null,
        success: body.refund_status === 'SUCCESS',
        refundId: body.refund_id ?? `mock_refund_${randomBytes(8).toString('hex')}`,
        refundAmountFen: BigInt(body.amount?.payer_total ?? 0),
        refundStatus: (body.refund_status as 'SUCCESS' | 'ABNORMAL' | 'CLOSED') ?? 'SUCCESS',
        raw: rawBody,
      };
    }
    const amountFen = BigInt(body.amount?.total ?? 0);
    if (body.event_type !== 'TRANSACTION.SUCCESS') {
      throw new AppError(15004, `未知回调事件: ${body.event_type ?? 'null'}`);
    }
    // mock：记录「已支付」供 queryOrder
    const transactionId = body.transaction_id ?? `mock_tx_${randomBytes(10).toString('hex')}`;
    this.paidOrders.set(body.out_trade_no, {
      transactionId,
      amountFen,
      paidAt: body.success_time ? new Date(body.success_time) : new Date(),
    });
    return {
      type: 'PAYMENT',
      outTradeNo: body.out_trade_no,
      transactionId,
      amountFen,
      paidAt: this.paidOrders.get(body.out_trade_no)!.paidAt,
      success: true,
      raw: rawBody,
    };
  }

  async profitSharing(input: ProfitSharingInput): Promise<ProfitSharingResult> {
    // mock 幂等：同 sharingNo 已分账 → 返回首次回单（防重复执行双花钱）
    const existing = this.sharedOrders.get(input.sharingNo);
    if (existing) {
      return { success: true, sharingOrderNo: existing, errorCode: null, errorMessage: null };
    }
    const failure = this.consumeFailure('profitSharing');
    if (failure) {
      return { success: false, sharingOrderNo: null, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
    }
    const orderNo = `SHR${randomBytes(10).toString('hex').toUpperCase()}`;
    this.sharedOrders.set(input.sharingNo, orderNo);
    return { success: true, sharingOrderNo: orderNo, errorCode: null, errorMessage: null };
  }

  async profitSharingReturn(input: ProfitSharingReturnInput): Promise<ProfitSharingReturnResult> {
    const failure = this.consumeFailure('profitSharingReturn');
    if (failure) {
      return { success: false, returnNo: null, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
    }
    void input;
    return {
      success: true,
      returnNo: `RTN${randomBytes(10).toString('hex').toUpperCase()}`,
      errorCode: null,
      errorMessage: null,
    };
  }

  async unfreezeRemaining(input: UnfreezeInput): Promise<UnfreezeResult> {
    const failure = this.consumeFailure('unfreezeRemaining');
    if (failure) {
      return { success: false, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
    }
    void input;
    return { success: true, errorCode: null, errorMessage: null };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const failure = this.consumeFailure('refund');
    if (failure) {
      return { success: false, refundId: null, refundedAt: null, errorCode: failure.errorCode, errorMessage: failure.errorMessage };
    }
    if (input.refundAmountFen <= 0n || input.refundAmountFen > input.totalAmountFen) {
      throw new AppError(15012, '退款金额超出可退额度');
    }
    return {
      success: true,
      refundId: `RFD${randomBytes(10).toString('hex').toUpperCase()}`,
      refundedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    };
  }

  async queryOrder(outTradeNo: string): Promise<WxOrderQuery> {
    const paid = this.paidOrders.get(outTradeNo);
    if (paid) {
      return {
        outTradeNo,
        tradeState: 'SUCCESS',
        transactionId: paid.transactionId,
        amountFen: paid.amountFen,
        paidAt: paid.paidAt,
      };
    }
    // mock：未支付的单查单返回 NOTPAY（掉单补偿的典型输入）
    return { outTradeNo, tradeState: 'NOTPAY', transactionId: null, amountFen: null, paidAt: null };
  }

  async downloadBill(input: { billDate: string; channel: string }): Promise<WxBill> {
    // TODO(真实集成)：GET /v3/bill/tradebill 或 fundflowbill，压缩账单解析
    // mock：空账单（对账批次 MATCHED 的零差异场景）
    return { billDate: input.billDate, channel: input.channel, lines: [] };
  }
}

/** 真实适配器骨架（TODO: APIv3 凭证就绪后实现） */
export class RealWxPayAdapter implements WxPayAdapter {
  async jsapiPrepay(_input: JsapiPrepayInput): Promise<JsapiPrepayResult> {
    // TODO(真实集成)：POST /v3/pay/transactions/jsapi（服务商 sub-mchid 模式）
    throw new AppError(90004, '真实微信支付未实现');
  }
  async parseNotify(_raw: unknown, _headers: Record<string, string>): Promise<WxPayNotify> {
    // TODO(真实集成)：验签 + resource 解密（AEAD_AES_256_GCM）
    throw new AppError(90004, '真实微信回调解析未实现');
  }
  async profitSharing(_input: ProfitSharingInput): Promise<ProfitSharingResult> {
    // TODO(真实集成)：POST /v3/profitsharing/orders（receivers=PERSONAL_OPENID）
    throw new AppError(90004, '真实微信分账未实现');
  }
  async profitSharingReturn(_input: ProfitSharingReturnInput): Promise<ProfitSharingReturnResult> {
    // TODO(真实集成)：POST /v3/profitsharing/return-orders
    throw new AppError(90004, '真实微信分账回退未实现');
  }
  async unfreezeRemaining(_input: UnfreezeInput): Promise<UnfreezeResult> {
    // TODO(真实集成)：POST /v3/profitsharing/orders/unfreeze
    throw new AppError(90004, '真实微信解除待分账未实现');
  }
  async refund(_input: RefundInput): Promise<RefundResult> {
    // TODO(真实集成)：POST /v3/refund/domestic/refunds
    throw new AppError(90004, '真实微信退款未实现');
  }
  async queryOrder(_outTradeNo: string): Promise<WxOrderQuery> {
    // TODO(真实集成)：GET /v3/pay/transactions/out-trade-no/{outTradeNo}?sp-mchid=
    throw new AppError(90004, '真实微信查单未实现');
  }
  async downloadBill(_input: { billDate: string; channel: string }): Promise<WxBill> {
    // TODO(真实集成)：GET /v3/bill/tradebill
    throw new AppError(90004, '真实微信账单未实现');
  }
}

/** 工厂：默认 mock（无凭证不调真实 API；真实实现完成后按凭证切换） */
export function getWxPayAdapter(): WxPayAdapter {
  const configured = Boolean(process.env.WXPAY_SP_MCHID && process.env.WXPAY_APIV3_KEY);
  if (configured) {
    console.warn('[adapter:wx-pay] 检测到支付凭证，但真实实现未完成，暂回落 mock');
  }
  return new MockWxPayAdapter();
}
