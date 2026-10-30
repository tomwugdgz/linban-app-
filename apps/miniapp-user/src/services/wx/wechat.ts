// ============================================================================
// 微信 SDK 能力封装（service 化，无凭证不真实调用）
// ----------------------------------------------------------------------------
// 原则：页面不直接 import Taro 调 SDK，统一走本文件；mock 模式下不触发真实
// 授权/支付弹窗。真实凭证（appid、商户号、慧眼配置）就绪后仅改本文件。
// ============================================================================

import Taro from '@tarojs/taro'
import type { PaymentPrepayDTO } from '@/types'

/** 微信一键登录：拿 code（后端用 code 换 openid/session） */
export async function wxLoginCode(): Promise<string> {
  const { code } = await Taro.login({ timeout: 8000 })
  if (!code) throw new Error('微信登录失败，请重试')
  return code
}

/** 手机号授权：button open-type="getPhoneNumber" 的 detail.code（新接口） */
export function pickPhoneCode(e: { detail?: { code?: string; errMsg?: string } }): string | null {
  const code = e?.detail?.code
  if (!code) return null // 用户拒绝授权
  return code
}

/**
 * 微信支付。
 * - mock 模式：弹「模拟支付」确认框，返回成功（不触达微信支付）；
 * - 真实模式：wx.requestPayment(prepay)（参数来自 POST /payments/prepay）。
 */
export async function wxPay(prepay: PaymentPrepayDTO, isMock: boolean): Promise<void> {
  if (isMock) {
    const { confirm } = await Taro.showModal({
      title: '模拟支付（演示）',
      content: `订单金额将通过微信支付扣款。真实环境由 wx.requestPayment 调起。`,
      confirmText: '确认支付',
      cancelText: '取消',
    })
    if (!confirm) throw new Error('支付已取消')
    return
  }
  return new Promise((resolve, reject) => {
    Taro.requestPayment({
      timeStamp: prepay.timeStamp,
      nonceStr: prepay.nonceStr,
      package: prepay.packageValue,
      signType: prepay.signType,
      paySign: prepay.paySign,
      success: () => resolve(),
      fail: (e) => reject(new Error(e.errMsg || '支付未完成')),
    })
  })
}

/**
 * 人脸核验（慧眼，身份证二要素 + 活体）。
 * 无凭证时由页面走 mock 分支；本函数仅在真实配置就绪后调用。
 */
export async function startFacialVerify(name: string, idCardNumber: string): Promise<{ score: number }> {
  // 微信慧眼走 JSBridge 插件（invoke），Taro 类型未声明，用宽松签名调用
  const invoke = (Taro as any).invoke as
    | ((name: string, args: Record<string, unknown>) => Promise<any>)
    | undefined
  if (!invoke) throw new Error('当前环境不支持人脸核验（插件未接入）')
  const res = await invoke('startFacialRecognitionVerify', {
    name,
    idCardNumber,
    // 配置项见微信慧眼文档；TODO(主理人)：接入前补充 faceSdkName 等
  })
  const score = Number(res?.verifyResult?.faceScore || 0)
  if (!score) throw new Error('人脸核验未通过')
  return { score }
}

/** 录音管理器（AI 语音交互 / IM 语音消息），单例 */
let _recorder: Taro.RecorderManager | null = null
export function recorderManager(): Taro.RecorderManager | null {
  try {
    if (!_recorder) _recorder = Taro.getRecorderManager()
    return _recorder
  } catch {
    return null // 开发者工具/真机未授权场景降级为文字输入
  }
}

/** 位置采集（到岗核销 GPS 关；服务端做模糊化后落库，架构 §5.3） */
export async function getLocation(): Promise<{ latitude: number; longitude: number }> {
  const res = await Taro.getLocation({ type: 'gcj02' })
  return { latitude: res.latitude, longitude: res.longitude }
}

/** 隐私号拨打（双方真实号码互不可见；AXB 绑定随订单生命周期） */
export async function makePrivacyCall(virtualNumber: string): Promise<void> {
  await Taro.makePhoneCall({ phoneNumber: virtualNumber })
}

/** 扫码（陪聊员端核销动态码可选方式） */
export async function scanCode(): Promise<string> {
  const res = await Taro.scanCode({})
  return res.result
}
