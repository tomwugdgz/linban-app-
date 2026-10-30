// ============================================================================
// StatCard：看板指标卡（标签 + 主数值 + 辅助说明）
// ============================================================================
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
}

export function StatCard({ label, value, extra, icon }: Props) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {extra && <div className="stat-extra">{extra}</div>}
    </div>
  );
}
