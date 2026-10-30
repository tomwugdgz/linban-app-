// ============================================================================
// 邻伴 · 号码隐私保护适配器（adapters 层：AXB 隐私号，架构 §8 防飞单机制 2）
// ----------------------------------------------------------------------------
// 场景：订单服务时段内，老人与陪聊员经腾讯云隐私号（AXB）通话，
// 真实号码互不可见；到期自动解绑（服务完成后 24h，可配）。
//
// 真实集成点 TODO：
//   · API：腾讯云号码隐私保护 AXB 绑定（CreateAxbBind / DeleteAxbBind）；
//   · 凭证：PRIVACY_NUMBER_SDK_APPID / PRIVACY_NUMBER_APPID +
//     TENCENTCLOUD_SECRET_ID / SECRET_KEY；
//   · 呼叫：双方拨打虚拟号 X → 平台桥接 A（老人）/B（陪聊员）。
// ============================================================================

import { randomInt } from 'node:crypto';
import { AppError } from '@linban/shared';

export interface PrivacyNumberAdapter {
  /** 绑定 AXB（A=老人, B=陪聊员, X=虚拟号） */
  bindAxb(input: BindAxbInput): Promise<BindAxbResult>;
  /** 解绑 */
  unbind(bindId: string): Promise<void>;
  /** 查询绑定状态（到期扫描） */
  queryBind(bindId: string): Promise<BindStatus | null>;
}

export interface BindAxbInput {
  orderId: string;
  /** 老人真实号码（A 方，密文进、适配层只用其 hmac 做标识） */
  userPhoneCipher: string;
  /** 陪聊员真实号码（B 方） */
  companionPhoneCipher: string;
  /** 绑定有效期至 */
  expiredAt: Date;
}

export interface BindAxbResult {
  bindId: string; // axb_bind_id（UK）
  virtualNumber: string; // 虚拟号 X（端上只暴露此号）
}

export interface BindStatus {
  bindId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'UNBOUND';
  expiredAt: Date;
}

/** Mock：确定性假虚拟号（170 号段 + 派生尾号），恒 ACTIVE */
export class MockPrivacyNumberAdapter implements PrivacyNumberAdapter {
  private binds = new Map<string, BindStatus>();

  async bindAxb(input: BindAxbInput): Promise<BindAxbResult> {
    const bindId = `mock_axb_${randomInt(100000, 999999)}`;
    const virtualNumber = `170${String(randomInt(10000000, 99999999))}`;
    this.binds.set(bindId, { bindId, status: 'ACTIVE', expiredAt: input.expiredAt });
    return { bindId, virtualNumber };
  }

  async unbind(bindId: string): Promise<void> {
    const b = this.binds.get(bindId);
    if (b) b.status = 'UNBOUND';
  }

  async queryBind(bindId: string): Promise<BindStatus | null> {
    return this.binds.get(bindId) ?? null;
  }
}

/** 真实适配器骨架 */
export class RealPrivacyNumberAdapter implements PrivacyNumberAdapter {
  async bindAxb(_input: BindAxbInput): Promise<BindAxbResult> {
    // TODO(真实集成)：CreateAxbBind（SdkAppId + A + B + Expiration）
    throw new AppError(90004, '真实隐私号绑定未实现');
  }
  async unbind(_bindId: string): Promise<void> {
    // TODO(真实集成)：DeleteAxbBind（BindId）
    throw new AppError(90004, '真实隐私号解绑未实现');
  }
  async queryBind(_bindId: string): Promise<BindStatus | null> {
    // TODO(真实集成)：DescribeAxbBindList
    throw new AppError(90004, '真实隐私号查询未实现');
  }
}

export function getPrivacyNumberAdapter(): PrivacyNumberAdapter {
  return new MockPrivacyNumberAdapter();
}
