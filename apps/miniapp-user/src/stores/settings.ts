// ============================================================================
// 适老设置 Store（大字模式 / 语音优先）
// ----------------------------------------------------------------------------
// 大字模式实现：CSS 变量 --font-scale 挂在 page-wrap 根节点，
// 全局文本工具类统一 calc(Nrpx * var(--font-scale)) 缩放（见 app.css），
// 避免逐页面内联样式；老人端核心适老能力。
// ============================================================================

import { create } from 'zustand'
import { storage } from '@/utils/storage'

export type FontScaleLevel = 'normal' | 'large' | 'xlarge'

const FONT_SCALE_MAP: Record<FontScaleLevel, string> = {
  normal: '',
  large: 'fs-large',
  xlarge: 'fs-xlarge',
}

const KEY = 'settings_v1'

interface SettingsState {
  fontScale: FontScaleLevel
  voiceFirst: boolean
  /** 挂到 page-wrap 的类名（由 store 派生，页面零计算） */
  fontScaleClass: string
  setFontScale: (level: FontScaleLevel) => void
  setVoiceFirst: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  fontScale: storage.get<FontScaleLevel>(KEY + ':fontScale', 'large'), // 老人端默认大字
  voiceFirst: storage.get<boolean>(KEY + ':voiceFirst', true), // 默认语音优先
  fontScaleClass: FONT_SCALE_MAP[storage.get<FontScaleLevel>(KEY + ':fontScale', 'large')],

  setFontScale: (level) => {
    storage.set(KEY + ':fontScale', level)
    set({ fontScale: level, fontScaleClass: FONT_SCALE_MAP[level] })
  },
  setVoiceFirst: (v) => {
    storage.set(KEY + ':voiceFirst', v)
    set({ voiceFirst: v })
  },
}))
