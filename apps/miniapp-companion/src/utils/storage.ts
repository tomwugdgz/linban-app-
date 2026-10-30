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

/** 登录态相关的 Storage key（清缓存时必须保留，否则用户被无谓踢下线） */
const AUTH_KEYS = [
  'companion_auth_token',
  'companion_auth_refresh_token',
  'companion_auth_user',
]

/**
 * 清除数据缓存：清掉全部 linban_ 前缀键，但保留登录态。
 * 陪聊员在服务中点「清除缓存」不应该掉线（会被误判成账号异常）。
 */
export function clearCache(keepAuth = true): void {
  try {
    const info = Taro.getStorageInfoSync()
    info.keys.forEach((full) => {
      if (full.indexOf(PREFIX) !== 0) return
      const key = full.slice(PREFIX.length)
      if (keepAuth && AUTH_KEYS.includes(key)) return
      Taro.removeStorageSync(full)
    })
  } catch (e) {
    console.warn('[storage] clearCache failed', e)
  }
}
