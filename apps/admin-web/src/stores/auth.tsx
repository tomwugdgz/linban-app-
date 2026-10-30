// ============================================================================
// 登录态 Store：Context + useReducer 轻量实现（架构 §3.5：管理端不上 Redux）
// 令牌持久化 localStorage；permissions 驱动菜单与按钮级权限。
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ADMIN_INFO_KEY, TOKEN_KEY } from '@/shared/constants';
import { authApi } from '@/api/auth';
import type { AdminInfo } from '@/shared/types';

interface AuthState {
  token: string;
  admin: AdminInfo | null;
  permissions: string[];
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (perm?: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStorage(): AuthState {
  const token = localStorage.getItem(TOKEN_KEY) ?? '';
  const adminRaw = localStorage.getItem(ADMIN_INFO_KEY);
  let admin: AdminInfo | null = null;
  let permissions: string[] = [];
  try {
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw);
      admin = parsed.admin ?? null;
      permissions = parsed.permissions ?? [];
    }
  } catch {
    // 存储损坏时静默降级为未登录，由路由守卫跳转登录页
  }
  return { token, admin, permissions };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(readStorage);

  // 刷新页面后校验令牌有效性并同步权限（契约 GET /admin/me）
  useEffect(() => {
    if (!state.token) return;
    authApi
      .me()
      .then((res) => {
        setState({ token: state.token, admin: res.admin, permissions: res.permissions });
        localStorage.setItem(ADMIN_INFO_KEY, JSON.stringify({ admin: res.admin, permissions: res.permissions }));
      })
      .catch(() => {
        // 令牌失效：拦截器已清理并跳登录，这里兜底清理状态
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ADMIN_INFO_KEY);
        setState({ token: '', admin: null, permissions: [] });
      });
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    localStorage.setItem(TOKEN_KEY, res.adminToken);
    localStorage.setItem(ADMIN_INFO_KEY, JSON.stringify({ admin: res.admin, permissions: res.permissions }));
    setState({ token: res.adminToken, admin: res.admin, permissions: res.permissions });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_INFO_KEY);
    setState({ token: '', admin: null, permissions: [] });
  }, []);

  const hasPermission = useCallback(
    (perm?: string) => {
      if (!perm) return true;
      if (state.permissions.includes('*')) return true;
      if (state.permissions.includes(perm)) return true;
      const domain = perm.split(':')[0];
      return state.permissions.includes(`${domain}:*`);
    },
    [state.permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout, hasPermission }),
    [state, login, logout, hasPermission],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
