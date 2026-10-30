// ============================================================================
// ConfirmButton：危险/资金操作二次确认（Popconfirm，支持输入原因的场景用 Modal）
// ============================================================================
import { Popconfirm, type PopconfirmProps } from 'antd';

interface Props extends Omit<PopconfirmProps, 'onConfirm'> {
  onConfirm: () => void | Promise<void>;
}

export function ConfirmButton({ onConfirm, children, ...rest }: Props) {
  return (
    <Popconfirm
      {...rest}
      okButtonProps={{ danger: rest.okButtonProps?.danger ?? true, size: 'small' }}
      cancelButtonProps={{ size: 'small' }}
      onConfirm={() => void onConfirm()}
    >
      {children as React.ReactNode}
    </Popconfirm>
  );
}
