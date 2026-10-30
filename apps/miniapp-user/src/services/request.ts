// ============================================================================
// 请求层：统一信封解析 + mock 适配 + 鉴权 + 幂等
// ----------------------------------------------------------------------------
// 对齐 docs/API-CONTRACT.md §1：
// - 信封 { code: 0, data, requestId }；HTTP 200 但 code≠0 视为业务失败；
// - Authorization: Bearer <accessToken>；10003(token 过期) 自动 refresh 一次；
// - 写操作带 Idempotency-Key 头（8–128 位）；
// - USE_MOCK=true 时全量走 services/mock（无后端环境演示），
//   后端就绪后仅需把 .env 的 TARO_APP_USE_MOCK 置 false。
// 错误码单一事实源：@linban/shared 的 ERROR_CODES（getErrorDef 取用户文案）。
// ============================================================================

import Taro from '@tarojs/taro'
import { CODE_SUCCESS, getErrorDef } from '@linban/shared'
import type { ApiOk, ApiErr } from '@linban/shared'
import { getToken } from '@/stores/auth'
import { genIdempotencyKey } from '@/utils/storage'
import { mockRequest } from './mock/router'

const BASE_URL = process.env.TARO_APP_BASE_URL || ''
const USE_MOCK = process.env.TARO_APP_USE_MOCK === 'true'

/** 业务错误（信封 code≠0）：message 已做用户友好化 */
export class ApiError extends Error {
  code: number
  requestId?: string
  constructor(code: number, message?: string, requestId?: string) {
    super(message || getErrorDef(code).message)
    this.code = code
    this.requestId = requestId
  }
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  data?: Record<string, unknown>
  /** 显式指定幂等键；缺省时写操作自动生成 */
  idempotencyKey?: string
  /** 是否静默（不弹全局错误 toast，由页面自行处理） */
  silent?: boolean
  showLoading?: boolean
}

let refreshing: Promise<string | null> | null = null

/** 刷新 accessToken（TODO 联调：refreshToken 落盘后由 /auth/refresh 轮换） */
async function refreshAccessToken(): Promise<string | null> {
  return null
}

async function rawRequest<T>(options: RequestOptions, token: string): Promise<T> {
  const { url, method = 'GET', data } = options
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) header.Authorization = `Bearer ${token}`
  if (method !== 'GET') {
    header['Idempotency-Key'] = options.idempotencyKey || genIdempotencyKey(method.toLowerCase() + ':' + url)
  }

  const res = await Taro.request({
    url: BASE_URL + url,
    method,
    data,
    header,
    timeout: 15000,
  })

  const body = res.data as ApiOk<T> | ApiErr | undefined
  if (!body || typeof body.code !== 'number') {
    throw new ApiError(10009, '服务端返回异常')
  }
  if (body.code !== CODE_SUCCESS) {
    const err = body as ApiErr
    // 10003 token 过期：尝试刷新一次并重试
    if (err.code === 10003) {
      if (!refreshing) refreshing = refreshAccessToken()
      const newToken = await refreshing
      refreshing = null
      if (newToken) return rawRequest<T>(options, newToken)
    }
    throw new ApiError(err.code, err.message, err.requestId)
  }
  return (body as ApiOk<T>).data
}

/** 统一请求入口（页面/service 只调这个） */
export async function request<T>(options: RequestOptions): Promise<T> {
  if (USE_MOCK) {
    return mockRequest<T>(options)
  }

  if (options.showLoading) Taro.showLoading({ title: '请稍候', mask: true })
  try {
    return await rawRequest<T>(options, getToken())
  } catch (e) {
    if (!options.silent) {
      const msg = e instanceof ApiError ? e.message : '网络开小差了，请稍后再试'
      Taro.showToast({ title: msg, icon: 'none', duration: 2500 })
    }
    throw e
  } finally {
    if (options.showLoading) Taro.hideLoading()
  }
}

export const http = {
  get: <T>(url: string, data?: Record<string, unknown>, silent?: boolean) =>
    request<T>({ url, method: 'GET', data, silent }),
  post: <T>(url: string, data?: Record<string, unknown>, silent?: boolean) =>
    request<T>({ url, method: 'POST', data, silent }),
  put: <T>(url: string, data?: Record<string, unknown>, silent?: boolean) =>
    request<T>({ url, method: 'PUT', data, silent }),
}

export const config = { BASE_URL, USE_MOCK }
