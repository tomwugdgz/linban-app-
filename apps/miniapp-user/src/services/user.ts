// ============================================================================
// 用户资料 / 家庭绑定服务（对齐契约 §3.1）
// ============================================================================

import { http } from './request'
import type { ElderProfileUpsertDTO, FamilyBindingDTO, UserProfileDTO } from '@linban/shared'

/** 我的完整资料（含老人档案脱敏视图） */
export async function fetchMyProfile(): Promise<UserProfileDTO> {
  return http.get<UserProfileDTO>('/users/me/profile')
}

/** 创建/更新老人档案（子女需 PROGRESS+ 授权） */
export async function updateElderProfile(payload: ElderProfileUpsertDTO): Promise<unknown> {
  return http.put('/users/me/elder-profile', payload as unknown as Record<string, unknown>)
}

/** 我的家庭绑定列表（双向视角） */
export async function fetchFamilyBindings(): Promise<FamilyBindingDTO[]> {
  return http.get<FamilyBindingDTO[]>('/users/family-bindings')
}

/** 子女发起绑定（老人确认后生效） */
export async function createFamilyBinding(elderPhone: string, relation: string): Promise<FamilyBindingDTO> {
  return http.post<FamilyBindingDTO>('/users/family-bindings', { elderPhone, relation })
}

/** 老人确认绑定 */
export async function confirmFamilyBinding(id: string): Promise<FamilyBindingDTO> {
  return http.post<FamilyBindingDTO>(`/users/family-bindings/${id}/confirm`)
}

/** 解除绑定 */
export async function revokeFamilyBinding(id: string): Promise<void> {
  await http.post(`/users/family-bindings/${id}/revoke`)
}

/** 注销申请（15 天冷静期；有进行中订单将被拒绝 10008） */
export async function requestCancel(): Promise<{ ok: boolean }> {
  return http.post('/users/me/cancel-request', {})
}
