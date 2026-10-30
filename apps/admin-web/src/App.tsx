// ============================================================================
// App：路由装配（登录页独立全屏；其余页面走 AppLayout + 权限守卫）
// ============================================================================
import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider } from '@/stores/auth';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/router/RequireAuth';
import { routes } from '@/router/routes';
import { LoginPage } from '@/pages/login/LoginPage';

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#d4380d',
          borderRadius: 6,
          fontSize: 14,
        },
        components: {
          Table: { headerBg: '#fafafa' },
        },
      }}
    >
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppLayout />
                </RequireAuth>
              }
            >
              {routes.map((r) => (
                <Route
                  key={r.path}
                  path={r.path}
                  element={
                    // 懒加载兜底：路由 chunk 下载期间保持布局稳定
                    <Suspense
                      fallback={
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
                          <Spin size="large" tip="页面加载中…" />
                        </div>
                      }
                    >
                      <r.element />
                    </Suspense>
                  }
                />
              ))}
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ConfigProvider>
  );
}
