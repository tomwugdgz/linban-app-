// ============================================================================
// 邻伴 · 短信适配器（adapters 层：验证码 + 通知兜底）
// ----------------------------------------------------------------------------
// 场景：登录/绑定手机号验证码、告警兜底通道（架构 §10：订阅消息失败降级）。
//
// 真实集成点 TODO：
//   · SDK：tencentcloud-sdk-nodejs（sms 模块 SendSms）；
//   · 凭证：SMS_SDK_APPID / SMS_SIGN_NAME / SMS_TEMPLATE_ID_CODE +
//     TENCENTCLOUD_SECRET_ID / SECRET_KEY；
//   · 验证码存储：Redis code:<phone>（infra/redis），不在本适配器。
// ============================================================================

import { AppError } from '@linban/shared';

export interface SmsAdapter {
  /** 发送验证码（模板参数 [code]） */
  sendCode(phone: string, code: string): Promise<SmsSendResult>;
  /** 发送通知（模板参数） */
  sendNotice(phone: string, templateId: string, params: string[]): Promise<SmsSendResult>;
}

export interface SmsSendResult {
  sent: boolean;
  /** 渠道回执流水号（落 notification_logs） */
  serialNo: string | null;
  errorMessage: string | null;
}

export class MockSmsAdapter implements SmsAdapter {
  async sendCode(phone: string, code: string): Promise<SmsSendResult> {
    if (!/^1\d{10}$/.test(phone)) throw new AppError(10001, '手机号格式不正确');
    if (!/^\d{4,8}$/.test(code)) throw new AppError(10001, '验证码格式不正确');
    // mock：打印到日志（开发期肉眼可取码），不真实发送
    console.info(`[sms:mock] 验证码 ${phone.slice(0, 3)}****${phone.slice(7)} → ${code}`);
    return { sent: true, serialNo: `mock_sms_${Date.now()}`, errorMessage: null };
  }

  async sendNotice(phone: string, templateId: string, params: string[]): Promise<SmsSendResult> {
    if (!/^1\d{10}$/.test(phone)) throw new AppError(10001, '手机号格式不正确');
    if (!templateId) throw new AppError(10001, '缺少短信模板 ID');
    console.info(`[sms:mock] 通知 ${phone.slice(0, 3)}****${phone.slice(7)} 模板=${templateId} 参数=${params.join(',')}`);
    return { sent: true, serialNo: `mock_sms_${Date.now()}`, errorMessage: null };
  }
}

export class RealSmsAdapter implements SmsAdapter {
  async sendCode(_phone: string, _code: string): Promise<SmsSendResult> {
    // TODO(真实集成)：sms.SendSms（SdkAppId/SignName/TemplateId/TemplateParamSet）
    throw new AppError(90004, '真实短信发送未实现');
  }
  async sendNotice(_phone: string, _templateId: string, _params: string[]): Promise<SmsSendResult> {
    // TODO(真实集成)：sms.SendSms
    throw new AppError(90004, '真实短信发送未实现');
  }
}

export function getSmsAdapter(): SmsAdapter {
  return new MockSmsAdapter();
}
