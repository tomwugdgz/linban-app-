// ============================================================================
// RequireAuth：路由守卫（未登录跳登录页；权限不足跳 403 提示页）
// ============================================================================
import { Navigate, useLocation } from 'react-router-dom';
import { Result, Button } from 'antd';
import { useAuth } from '@/stores/auth';
import { routes } from './routes';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, permissions } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // 路由级权限校验（meta.perm）
  const route = routes.find((r) => r.path === location.pathname);
  const perm = route?.meta.perm;
  if (perm) {
    const allowed =
      permissions.includes('*') ||
      permissions.includes(perm) ||
      permissions.includes(`${perm.split(':')[0]}:*`);
    if (!allowed) {
      return (
        <Result
          status="403"
          title="403"
          subTitle={`抱歉，您没有访问该页面的权限（需要 ${perm}）。如需开通请联系超级管理员。`}
          extra={
            <Button type="primary" href="/dashboard">
              返回看板
            </Button>
          }
        />
      );
    }
  }
  return <>{children}</>;
}
