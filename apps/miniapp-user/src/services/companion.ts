// ============================================================================
// 陪聊员发现服务（对齐契约 §3.6，用户态）
// ----------------------------------------------------------------------------
// 红线：只消费 CompanionPublicDTO 脱敏视图（无证件/真名/手机号/信用分）。
// ============================================================================

import { http } from './request'
import type { CompanionDetail, CompanionListItem, PageResult, ReviewDTO } from '@/types'
import type { companion_role } from '@linban/shared'

/** 附近陪聊员（契约 §15.8：入参 +role?、出参每条 +role） */
export async function fetchNearbyCompanions(params?: {
  tags?: string
  sort?: 'distance' | 'rating' | 'price'
  role?: companion_role
}): Promise<PageResult<CompanionListItem>> {
  const q = new URLSearchParams()
  if (params?.tags) q.set('tags', params.tags)
  if (params?.role) q.set('role', params.role)
  q.set('sort', params?.sort || 'distance')
  return http.get<PageResult<CompanionListItem>>(`/companions/nearby?${q.toString()}`)
}

/** 陪聊员公开卡（含可约时段与评价） */
export async function fetchCompanionDetail(id: string): Promise<CompanionDetail> {
  return http.get<CompanionDetail>(`/companions/${id}`)
}

/** 陪聊员收到的评价（匿名隐藏内容） */
export async function fetchCompanionReviews(companionId: string): Promise<ReviewDTO[]> {
  return http.get<ReviewDTO[]>(`/reviews/companion/${companionId}`)
}
