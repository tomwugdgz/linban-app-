// ============================================================================
// 本地存储封装（Taro 同步 API + JSON 序列化）
// 仅存非敏感数据：登录态 token、用户信息、适老设置、mock 演示数据。
// 敏感数据（身份证/人脸/手机号明文）禁止落端（架构 §5.3 / §10.1）。
// ============================================================================

import Taro from '@tarojs/taro'

const PREFIX = 'linban_'

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = Taro.getStorageSync(PREFIX + key)
      if (raw === '' || raw === undefined || raw === null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      Taro.setStorageSync(PREFIX + key, JSON.stringify(value))
    } catch (e) {
      console.warn('[storage] set failed', key, e)
    }
  },
  remove(key: string): void {
    try {
      Taro.removeStorageSync(PREFIX + key)
    } catch {
      /* 忽略 */
    }
  },
}

/** 生成端侧幂等键（下单/发消息等，schema 幂等列约定） */
export function genIdempotencyKey(prefix = 'idem'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}
