// ============================================================================
// 邻伴 · 微信登录适配器（adapters 层：code2session + 手机号获取）
// ----------------------------------------------------------------------------
// 真实集成点 TODO：
//   · API：GET https://api.weixin.qq.com/sns/jscode2session
//     （appid + secret + js_code → openid/session_key）
//   · 手机号：新版权限 getPhoneNumber（code 换 token → 手机号），
//     见 https://developers.weixin.qq.com/miniprogram/dev/framework/
//   · 凭证：WX_MINIAPPID / WX_MINIAPPSECRET（见 .env.example）
//   · 限流：微信侧 1w/min，超限返回 45009；本适配层不做重试，交上层。
//
// 无凭证环境：MockWxAuthAdapter 返回确定性假 openid（按 code 派生），
// 保证同一 code 永远映射同一用户（POC 可登录、可绑定）。
// ============================================================================

import { createHash } from 'node:crypto';
import { AppError } from '@linban/shared';

/** 微信登录适配器接口 */
export interface WxAuthAdapter {
  /** code → openid/session_key */
  code2Session(code: string): Promise<WxSession>;
  /** getPhoneNumber 的 code → 手机号（用户授权后） */
  getPhoneNumber(code: string): Promise<WxPhone>;
}

export interface WxSession {
  openid: string;
  unionid: string | null;
  sessionKey: string;
}

export interface WxPhone {
  /** 完整手机号（服务端加密后落库 phone_cipher + phone_hmac） */
  phone: string;
  purePhone: string;
  countryCode: string;
}

/** 无凭证 Mock：按 code 确定性派生假 openid */
export class MockWxAuthAdapter implements WxAuthAdapter {
  async code2Session(code: string): Promise<WxSession> {
    if (!code || code.length < 6) {
      throw new AppError(11001, '微信 code 无效或已过期');
    }
    const seed = createHash('sha256').update(`linban-mock:${code}`).digest('hex');
    return {
      openid: `mock_openid_${seed.slice(0, 24)}`,
      unionid: null,
      sessionKey: seed.slice(0, 32),
    };
  }

  async getPhoneNumber(code: string): Promise<WxPhone> {
    if (!code) {
      throw new AppError(11001, '手机号授权 code 缺失');
    }
    // 假手机号按 code 派生（11 位，1 开头，便于联调）
    const seed = createHash('sha256').update(`linban-mock-phone:${code}`).digest('hex');
    const phone = `1${seed.replace(/\D/g, '').slice(0, 10).padEnd(10, '0')}`;
    return { phone, purePhone: phone, countryCode: '86' };
  }
}

/** 真实适配器骨架（TODO: 凭证就绪后实现 HTTP 调用） */
export class RealWxAuthAdapter implements WxAuthAdapter {
  async code2Session(code: string): Promise<WxSession> {
    // TODO(真实集成)：GET /sns/jscode2session?appid=&secret=&js_code=&grant_type=authorization_code
    // 凭证：WX_MINIAPPID / WX_MINIAPPSECRET；错误 40013/40163 → AppError(11001)
    throw new AppError(90004, `真实微信登录未实现（code=${code.slice(0, 6)}***）`);
  }

  async getPhoneNumber(code: string): Promise<WxPhone> {
    // TODO(真实集成)：code → getAccessToken → /wxa/business/getuserphonenumber
    throw new AppError(90004, '真实微信手机号获取未实现');
  }
}

/** 工厂：配置了凭证走真实（当前抛 90004 提示未实现），否则 mock */
export function getWxAuthAdapter(): WxAuthAdapter {
  if (process.env.WX_MINIAPPID && process.env.WX_MINIAPPSECRET) {
    console.warn('[adapter:wx-auth] 检测到微信凭证，但真实实现未完成，暂回落 mock');
  }
  return new MockWxAuthAdapter();
}
