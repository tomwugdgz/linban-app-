// 权限判断 hook（契约 §5：缺权限 21001；按钮级禁用 + tooltip 引导申请）
import { useAuth } from '@/stores/auth';

export function usePermission() {
  const { permissions } = useAuth();
  const can = (perm?: string) => {
    if (!perm) return true;
    if (permissions.includes('*')) return true;
    if (permissions.includes(perm)) return true;
    const domain = perm.split(':')[0];
    return permissions.includes(`${domain}:*`);
  };
  return { can, permissions };
}
