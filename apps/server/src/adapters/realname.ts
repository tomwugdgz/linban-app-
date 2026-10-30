// ============================================================================
// 邻伴 · 实名认证适配器（adapters 层：身份证 OCR + 二要素核验）
// ----------------------------------------------------------------------------
// 场景：入驻①实名（架构 §6.6）：OCR 读卡 → 姓名/身份证号 → 二要素
// （姓名+身份证）权威核验 → 通过后字段经 AES-256-GCM 加密落库
// （id_card_cipher + id_card_hmac 盲索引，同一身份证仅一账号）。
//
// 真实集成点 TODO：
//   · OCR：腾讯云 OCR 身份证识别（IDCardOCR）或 OCR 通用；
//   · 二要素：腾讯云慧眼实名核身（EncryptedPhone? 不适用）—— 采用
//     权威数据源二要素接口（如腾讯云实名认证 / 支付宝二要素）；
//   · 凭证：TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY；
//   · 合规：L4 数据，访问写 audit_logs（file 模块负责）。
// ============================================================================

import { AppError } from '@linban/shared';

export interface RealnameAdapter {
  /** 身份证 OCR（正反面 objectKey → 结构化字段） */
  ocrIdCard(input: { frontObjectKey: string; backObjectKey: string }): Promise<OcrIdCardResult>;
  /** 二要素核验（姓名 + 身份证号，权威源比对） */
  verifyTwoElements(input: { name: string; idCard: string }): Promise<TwoElementsResult>;
}

export interface OcrIdCardResult {
  name: string;
  idCard: string;
  gender: string;
  nation: string;
  birthDate: string; // YYYY-MM-DD
  address: string;
  validDate: string; // 有效期
  /** OCR 置信度（0–100） */
  confidence: number;
}

export interface TwoElementsResult {
  passed: boolean;
  /** 不一致时的原因（脱敏，不含明文证件号） */
  reason: string | null;
}

/** Mock：确定性假数据（OCR 读出固定样例；二要素通过）。
 *  联调「不一致」场景可在 mock 内按约定 idCard 前缀切换。 */
export class MockRealnameAdapter implements RealnameAdapter {
  async ocrIdCard(input: { frontObjectKey: string; backObjectKey: string }): Promise<OcrIdCardResult> {
    if (!input.frontObjectKey || !input.backObjectKey) {
      throw new AppError(13005, '实名认证需上传身份证正反面');
    }
    return {
      name: '张淑芬',
      idCard: '440102195803150024',
      gender: '女',
      nation: '汉',
      birthDate: '1958-03-15',
      address: '广东省广州市越秀区****',
      validDate: '20180606-长期',
      confidence: 98,
    };
  }

  async verifyTwoElements(input: { name: string; idCard: string }): Promise<TwoElementsResult> {
    if (!input.name || !/^\d{17}[\dXx]$/.test(input.idCard)) {
      return { passed: false, reason: '证件号格式不正确' };
    }
    // TODO(真实集成)：调权威二要素；mock 约定以 X 结尾的测试证号判不一致
    if (input.idCard.toUpperCase().endsWith('X')) {
      return { passed: false, reason: '姓名与证件号不一致（权威源）' };
    }
    return { passed: true, reason: null };
  }
}

/** 真实适配器骨架 */
export class RealRealnameAdapter implements RealnameAdapter {
  async ocrIdCard(_input: { frontObjectKey: string; backObjectKey: string }): Promise<OcrIdCardResult> {
    // TODO(真实集成)：OCR IDCardOCR（需先从 COS 拉图或直传 base64）
    throw new AppError(90004, '真实身份证 OCR 未实现');
  }
  async verifyTwoElements(_input: { name: string; idCard: string }): Promise<TwoElementsResult> {
    // TODO(真实集成)：权威二要素接口（姓名+身份证）
    throw new AppError(90004, '真实二要素核验未实现');
  }
}

export function getRealnameAdapter(): RealnameAdapter {
  return new MockRealnameAdapter();
}
