// ============================================================================
// 陪聊员主档服务（契约 §4.4 `/companion`）
// ----------------------------------------------------------------------------
// 入驻四审（§4.1）：每阶段独立端点，阶段推进只认服务端状态机（§7.2.2）。
// 信用分（红线 §7.2.4）：端上只读，GET /companion/me/credit-logs。
// ============================================================================

import { http } from './request'
import type {
  ApplicationStatusDTO,
  CompanionSelfView,
  CreditLogDTO,
  DepositTxDTO,
  ScheduleDTO,
} from '@/types'

// ---------------------------------------------------------------------------
// 入驻四审
// ---------------------------------------------------------------------------

/** 提交入驻申请（四审流起点） */
export async function submitApplication(payload: {
  nickname: string
  hourlyRateFen: string
  serviceRadiusM: number
  tags: string[]
}): Promise<ApplicationStatusDTO> {
  return http.post<ApplicationStatusDTO>('/companion/applications', payload as unknown as Record<string, unknown>)
}

/** 我的申请与当前阶段 */
export async function fetchMyApplication(): Promise<ApplicationStatusDTO | null> {
  return http.get<ApplicationStatusDTO | null>('/companion/applications/me')
}

/** ① 实名（OCR + 公安二要素，服务端 adapter mock） */
export async function submitRealname(payload: {
  name: string
  idCardNumber: string
}): Promise<ApplicationStatusDTO & { idCardMasked: string }> {
  return http.post('/companion/applications/me/realname', payload as unknown as Record<string, unknown>)
}

/** ② 人脸底照（微信慧眼，服务端 adapter mock） */
export async function submitFace(payload: {
  faceScore: number
  faceVerifyId: string
}): Promise<ApplicationStatusDTO & { faceScore: number }> {
  return http.post('/companion/applications/me/face', payload as unknown as Record<string, unknown>)
}

/** ③ 无犯罪记录材料上传（人工审核，无开放 API） */
export async function submitCriminal(payload: { fileId: string; fileName: string }): Promise<ApplicationStatusDTO> {
  return http.post('/companion/applications/me/criminal', payload as unknown as Record<string, unknown>)
}

/** ④ 培训认证完成 */
export async function completeTraining(): Promise<ApplicationStatusDTO> {
  return http.post('/companion/applications/me/training-complete')
}

/** ④ 考试（≥80 通过） */
export async function submitExam(payload: { score: number }): Promise<ApplicationStatusDTO & { passed: boolean }> {
  return http.post('/companion/applications/me/exam', payload as unknown as Record<string, unknown>)
}

/** ④ 保证金缴纳（默认 ¥500 = 50000 分） */
export async function payDeposit(payload: { amountFen: string }): Promise<ApplicationStatusDTO> {
  return http.post('/companion/applications/me/deposit', payload as unknown as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// 工作台
// ---------------------------------------------------------------------------

/** 我的陪聊员主档（信用分/等级/保证金/评分） */
export async function fetchMyCompanion(): Promise<CompanionSelfView> {
  return http.get<CompanionSelfView>('/companion/me')
}

/** 信用分明细（只增不改，端上只读） */
export async function fetchCreditLogs(): Promise<CreditLogDTO[]> {
  return http.get<CreditLogDTO[]>('/companion/me/credit-logs')
}

/** 保证金流水（缴纳/罚扣/退还） */
export async function fetchDepositTxs(): Promise<DepositTxDTO[]> {
  return http.get<DepositTxDTO[]>('/companion/me/deposit-txs')
}

/** 我的可约日程 */
export async function fetchSchedules(): Promise<ScheduleDTO[]> {
  return http.get<ScheduleDTO[]>('/companion/schedules')
}

/** 更新日程（时段冲突返回 14003，不做静默覆盖） */
export async function updateSchedules(schedules: ScheduleDTO[]): Promise<ScheduleDTO[]> {
  return http.put<ScheduleDTO[]>('/companion/schedules', { schedules } as unknown as Record<string, unknown>)
}
