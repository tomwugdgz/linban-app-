// ============================================================================
// 营销服务（时长卡 / 优惠券，对齐契约 §3.5）
// ============================================================================

import { http } from './request'
import type { CouponDTO, GiftCardDTO, UserCouponDTO } from '@linban/shared'

/** 可领券模板列表 */
export async function fetchCouponTemplates(): Promise<CouponDTO[]> {
  return http.get<CouponDTO[]>('/marketing/coupons')
}

/** 领券（同模板一张 UNUSED；重复领取 19206） */
export async function claimCoupon(couponNo: string): Promise<UserCouponDTO> {
  return http.post<UserCouponDTO>(`/marketing/coupons/${couponNo}/claim`)
}

/** 我的券 */
export async function fetchMyCoupons(): Promise<UserCouponDTO[]> {
  return http.get<UserCouponDTO[]>('/marketing/coupons/mine')
}

/** 我的时长卡 */
export async function fetchMyGiftCards(): Promise<GiftCardDTO[]> {
  return http.get<GiftCardDTO[]>('/marketing/gift-cards/mine')
}

/** 购买孝心时长卡（mock 模式直接开通；真实联动支付 TODO） */
export async function purchaseGiftCard(payload: {
  faceAmountFen: number
  durationMinutes: number
  message?: string
}): Promise<GiftCardDTO> {
  return http.post<GiftCardDTO>('/marketing/gift-cards', payload as unknown as Record<string, unknown>)
}

/** 受赠人凭手机号盲索引绑定 */
export async function bindGiftCard(phone: string): Promise<GiftCardDTO> {
  return http.post<GiftCardDTO>('/marketing/gift-cards/bind', { phone })
}
