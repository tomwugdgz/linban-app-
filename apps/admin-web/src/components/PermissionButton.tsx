// ============================================================================
// PermissionButton：无权限按钮自动禁用 + Tooltip 说明（缺权限由服务端 21001 兜底）
// 用法：<PermissionButton perm="withdrawal:*" ...>通过</PermissionButton>
// ============================================================================
import { Button, Tooltip } from 'antd';
import type { ButtonProps } from 'antd';
import { usePermission } from '@/hooks/usePermission';

interface Props extends ButtonProps {
  perm?: string;
}

export function PermissionButton({ perm, disabled, onClick, ...rest }: Props) {
  const { can } = usePermission();
  const allowed = can(perm);
  const btn = (
    <Button {...rest} disabled={!allowed || disabled} onClick={allowed ? onClick : undefined} />
  );
  if (allowed) return btn;
  return (
    <Tooltip title={`无「${perm}」权限，请联系超级管理员授权`}>
      {/* 禁用 Button 不派发鼠标事件，包一层 span 让 tooltip 可展示 */}
      <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>{btn}</span>
    </Tooltip>
  );
}
