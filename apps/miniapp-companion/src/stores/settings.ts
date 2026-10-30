// ============================================================================
// 适老设置 Store（大字模式 / 语音优先）
// ----------------------------------------------------------------------------
// 陪聊员端同样面向中老年从业者，沿用 CSS 变量 --font-scale 方案：
// 由 page-wrap 根节点挂类名，全局文本类统一 calc(Nrpx * var(--font-scale))。
// ============================================================================

import { create } from 'zustand'
import { storage } from '@/utils/storage'

export type FontScaleLevel = 'normal' | 'large' | 'xlarge'

const FONT_SCALE_MAP: Record<FontScaleLevel, string> = {
  normal: '',
  large: 'fs-large',
  xlarge: 'fs-xlarge',
}

const KEY = 'companion_settings_v1'

interface SettingsState {
  fontScale: FontScaleLevel
  voiceFirst: boolean
  /** 消息通知总开关（派单/接单提醒） */
  notifyEnabled: boolean
  /** 新消息提醒（IM 未读提示音与红点） */
  notifyNewMessage: boolean
  /** 隐私设置：不在预览区展示完整订单号 */
  privacyMaskOrderNo: boolean
  setFontScale: (level: FontScaleLevel) => void
  setVoiceFirst: (v: boolean) => void
  setNotifyEnabled: (v: boolean) => void
  setNotifyNewMessage: (v: boolean) => void
  setPrivacyMaskOrderNo: (v: boolean) => void
  /** 挂到 page-wrap 的类名（由 store 派生，页面零计算） */
  fontScaleClass: string
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  fontScale: storage.get<FontScaleLevel>(KEY + ':fontScale', 'large'),
  voiceFirst: storage.get<boolean>(KEY + ':voiceFirst', true),
  notifyEnabled: storage.get<boolean>(KEY + ':notifyEnabled', true),
  notifyNewMessage: storage.get<boolean>(KEY + ':notifyNewMessage', true),
  privacyMaskOrderNo: storage.get<boolean>(KEY + ':privacyMaskOrderNo', true),
  fontScaleClass: FONT_SCALE_MAP[storage.get<FontScaleLevel>(KEY + ':fontScale', 'large')],

  setFontScale: (level) => {
    storage.set(KEY + ':fontScale', level)
    set({ fontScale: level, fontScaleClass: FONT_SCALE_MAP[level] })
  },
  setVoiceFirst: (v) => {
    storage.set(KEY + ':voiceFirst', v)
    set({ voiceFirst: v })
  },
  setNotifyEnabled: (v) => {
    storage.set(KEY + ':notifyEnabled', v)
    set({ notifyEnabled: v })
  },
  setNotifyNewMessage: (v) => {
    storage.set(KEY + ':notifyNewMessage', v)
    set({ notifyNewMessage: v })
  },
  setPrivacyMaskOrderNo: (v) => {
    storage.set(KEY + ':privacyMaskOrderNo', v)
    set({ privacyMaskOrderNo: v })
  },
}))
