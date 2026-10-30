// ============================================================================
// 请求层：axios 实例 + 契约 §1 通用约定的落地
// - BaseURL /api/v1；统一信封 {code,data,requestId}，code!==0 即业务错误
// - 后台令牌 adminToken（Authorization: Bearer）；写操作带 Idempotency-Key
// - VITE_USE_MOCK!=='false' 时请求分流到内置 mock 适配层（无后端可联调）
// ============================================================================
import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { message } from 'antd';
import { TOKEN_KEY, USE_MOCK } from '@/shared/constants';
import { ERROR_CODES } from '@linban/shared';
import { dispatch } from './mock/server';

export interface ApiEnvelope<T> {
  code: number;
  data: T;
  requestId: string;
  message?: string;
}

/** 业务错误：携带契约 code 与 requestId（排查必带） */
export class ApiError extends Error {
  code: number;
  requestId?: string;
  constructor(code: number, msg: string, requestId?: string) {
    super(msg);
    this.code = code;
    this.requestId = requestId;
  }
}

const service = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
});

// ---- 请求拦截：令牌 + 幂等键 ----
service.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (['post', 'put', 'delete', 'patch'].includes(config.method ?? '')) {
    // 契约 §1.3：写操作幂等键（8–128 位字母数字）
    const key = `admin:${config.url}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    config.headers['Idempotency-Key'] = key;
  }
  return config;
});

// ---- 响应拦截：信封解包 + 错误归一 ----
service.interceptors.response.use(
  (res) => {
    const body = res.data;
    // 非信封响应（如 blob 导出）直接透传
    if (!body || typeof body !== 'object' || !('code' in body)) return res;
    if (body.code === 0) {
      res.data = body.data;
      return res;
    }
    return Promise.reject(new ApiError(body.code, body.message ?? '请求失败', body.requestId));
  },
  (err) => {
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as ApiEnvelope<unknown> | undefined;
      if (body && typeof body.code === 'number' && body.code !== 0) {
        return Promise.reject(new ApiError(body.code, body.message ?? '请求失败', body.requestId));
      }
      return Promise.reject(new ApiError(err.response?.status ?? 90001, err.message || '网络异常'));
    }
    return Promise.reject(err);
  },
);

// ---- mock 分流：USE_MOCK 时不走 axios，直接命中内存路由表 ----
function mockRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const base = config.baseURL ?? '';
  let path = `${config.url ?? ''}`;
  // 去掉 baseURL 前缀，mock 路由表按契约原始路径登记
  if (base && path.startsWith(base)) path = path.slice(base.length);
  const params = config.params as Record<string, unknown> | undefined;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    });
    const s = qs.toString();
    if (s) path += `?${s}`;
  }
  return dispatch((config.method ?? 'get').toUpperCase(), path, config.data) as Promise<T>;
}

/**
 * mock 处理器抛错的归一：mock 层按契约 §2 抛 { code, message }，
 * 此处包装成 ApiError，让 mock 与真实后端在前端的错误处理路径完全一致。
 */
function normalizeError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const code = typeof (e as { code?: unknown })?.code === 'number' ? ((e as { code: number }).code) : 90001;
  return new ApiError(code, e instanceof Error ? e.message : '未知错误');
}

interface RequestExtra {
  /** 跳过统一错误 toast（由页面自行处理，如表单校验类提示） */
  silent?: boolean;
  responseType?: AxiosRequestConfig['responseType'];
}

async function request<T>(config: AxiosRequestConfig, extra: RequestExtra = {}): Promise<T> {
  try {
    if (USE_MOCK && extra.responseType !== 'blob') {
      return await mockRequest<T>(config);
    }
    const res = await service.request<T>({ ...config, responseType: extra.responseType });
    return res.data;
  } catch (e) {
    const apiErr = normalizeError(e);
    // 服务端未返回文案时，用共享错误码表兜底（前端不硬编码枚举）
    if (apiErr.message === '请求失败' || !apiErr.message) {
      apiErr.message = ERROR_CODES[apiErr.code as keyof typeof ERROR_CODES]?.message ?? '请求失败';
    }
    // 令牌失效：清理登录态并跳登录页
    // （@linban/shared error-codes.ts 为准：10002 未登录 / 10003 token 过期；
    //   API-CONTRACT §2 表格中的 11001/11002 为早期口径，实际是微信登录段，已按共享包修正）
    if (apiErr.code === 10002 || apiErr.code === 10003) {
      localStorage.removeItem(TOKEN_KEY);
      if (location.pathname !== '/login') {
        message.warning('登录已过期，请重新登录');
        location.href = '/login';
      }
    } else if (!extra.silent) {
      message.error(apiErr.message + (apiErr.requestId ? `（requestId: ${apiErr.requestId}）` : ''));
    }
    throw apiErr;
  }
}

export const http = {
  get<T>(url: string, params?: Record<string, unknown>, extra?: RequestExtra) {
    return request<T>({ method: 'get', url, params }, extra);
  },
  post<T>(url: string, data?: unknown, extra?: RequestExtra) {
    return request<T>({ method: 'post', url, data }, extra);
  },
  put<T>(url: string, data?: unknown, extra?: RequestExtra) {
    return request<T>({ method: 'put', url, data }, extra);
  },
  /** 导出：mock 模式取 CSV 文本触发下载；真实模式走 blob */
  async exportCsv(url: string, params?: Record<string, unknown>): Promise<void> {
    if (USE_MOCK) {
      const res = await request<{ fileName: string; csv: string }>({ method: 'get', url, params });
      downloadText(res.fileName, res.csv);
      return;
    }
    const res = await request<Blob>({ method: 'get', url, params }, { responseType: 'blob' });
    const cd = (res as unknown as { headers?: Record<string, string> }).headers?.['content-disposition'];
    const fileName = /filename="?([^"]+)"?/.exec(cd ?? '')?.[1] ?? `export_${Date.now()}.csv`;
    const url2 = URL.createObjectURL(res);
    triggerDownload(url2, fileName);
    URL.revokeObjectURL(url2);
  },
};

function triggerDownload(href: string, fileName: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.click();
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  URL.revokeObjectURL(url);
}

export default service;
