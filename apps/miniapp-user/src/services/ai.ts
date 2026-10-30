// ============================================================================
// AI 陪聊服务（对齐契约 §6.2，仅老人端）
// ----------------------------------------------------------------------------
// 语音链路：端上录音（RecorderManager）→ ASR 文本 → /turn/voice → TTS 播放。
// MVP：ASR 走录音 + 端上识别（TODO 联调选定供应商），mock 直接透传文本。
// ============================================================================

import { http } from './request'
import type { AiSessionDTO, AiTurnDTO } from '@linban/shared'

/** 创建 AI 会话（ELDER 角色） */
export async function createAiSession(): Promise<AiSessionDTO> {
  return http.post<AiSessionDTO>('/ai/sessions', {})
}

/** 文本对话轮次 */
export async function aiTurnText(sessionNo: string, text: string): Promise<AiTurnDTO> {
  return http.post<AiTurnDTO>(`/ai/sessions/${sessionNo}/turn`, { text })
}

/** 语音对话轮次（ASR→LLM→TTS） */
export async function aiTurnVoice(sessionNo: string, asrText: string): Promise<AiTurnDTO> {
  return http.post<AiTurnDTO>(`/ai/sessions/${sessionNo}/turn/voice`, { asrText })
}

/** 结束会话（沉淀画像反哺真人匹配，架构 §6.2） */
export async function endAiSession(sessionNo: string): Promise<AiSessionDTO> {
  return http.post<AiSessionDTO>(`/ai/sessions/${sessionNo}/end`)
}

/** 我的 AI 会话列表 */
export async function fetchAiSessions(): Promise<AiSessionDTO[]> {
  return http.get<AiSessionDTO[]>('/ai/sessions')
}
