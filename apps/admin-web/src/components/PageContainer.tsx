// ============================================================================
// PageContainer：页面骨架（标题 + 描述 + 卡片内容），统一页面节奏
// ============================================================================
import type { ReactNode } from 'react';

interface Props {
  title: string;
  desc?: string;
  extra?: ReactNode;
  children: ReactNode;
}

export function PageContainer({ title, desc, extra, children }: Props) {
  return (
    <div className="page-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 className="page-title">{title}</h2>
          {desc && <p className="page-desc">{desc}</p>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}
