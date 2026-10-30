// ============================================================================
// 陪聊员发现服务（对齐契约 §3.6，用户态）
// ----------------------------------------------------------------------------
// 红线：只消费 CompanionPublicDTO 脱敏视图（无证件/真名/手机号/信用分）。
// ============================================================================

import { http } from './request'
import type { CompanionDetail, CompanionPublicDTO, PageResult, ReviewDTO } from '@/types'

/** 附近陪聊员（距离衰减+标签+信用+等级+评分加权） */
export async function fetchNearbyCompanions(params?: {
  tags?: string
  sort?: 'distance' | 'rating' | 'price'
}): Promise<PageResult<CompanionPublicDTO>> {
  const q = new URLSearchParams()
  if (params?.tags) q.set('tags', params.tags)
  q.set('sort', params?.sort || 'distance')
  return http.get<PageResult<CompanionPublicDTO>>(`/companions/nearby?${q.toString()}`)
}

/** 陪聊员公开卡（含可约时段与评价） */
export async function fetchCompanionDetail(id: string): Promise<CompanionDetail> {
  return http.get<CompanionDetail>(`/companions/${id}`)
}

/** 陪聊员收到的评价（匿名隐藏内容） */
export async function fetchCompanionReviews(companionId: string): Promise<ReviewDTO[]> {
  return http.get<ReviewDTO[]>(`/reviews/companion/${companionId}`)
}
