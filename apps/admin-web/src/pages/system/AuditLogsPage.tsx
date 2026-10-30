// ============================================================================
// 审计日志：全操作审计查询（契约 5.1 GET /admin/audit-logs）
// ============================================================================
import { Button, Descriptions, Drawer, Input, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { useTable } from '@/hooks/useTable';
import { auditApi } from '@/api/system';
import type { AuditLog } from '@/shared/types';
import { fmtTime } from '@/shared/format';

interface Filters {
  module?: string;
  action?: string;
  keyword?: string;
}

const MODULE_LABEL: Record<string, string> = {
  companion: '陪聊员',
  profit: '分账/财务',
  risk: '风控',
  order: '订单',
  marketing: '营销',
  system: '系统',
  file: '文件',
};

const ACTION_LABEL: Record<string, string> = {
  approve: '通过',
  reject: '驳回',
  update: '更新',
  view_l4: '查看L4文件',
  handle: '处置',
  export: '导出',
  create: '创建',
};

export function AuditLogsPage() {
  const table = useTable<AuditLog, Filters>({
    fetcher: (params) => auditApi.list(params),
    initialFilters: {},
  });
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '操作人', dataIndex: 'adminName', width: 100 },
    { title: '模块', dataIndex: 'module', width: 100, render: (v: string) => <Tag>{MODULE_LABEL[v] ?? v}</Tag> },
    { title: '动作', dataIndex: 'action', width: 100, render: (v: string) => ACTION_LABEL[v] ?? v },
    { title: '对象', width: 160, render: (_: unknown, r: AuditLog) => `${r.targetType ?? '-'} #${r.targetId ?? '-'}` },
    { title: 'requestId', dataIndex: 'requestId', width: 130 },
    { title: 'IP', dataIndex: 'ip', width: 130 },
    { title: '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, r: AuditLog) => (
        <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
      ),
    },
  ];

  return (
    <PageContainer title="审计日志" desc="全操作审计（只插入不更新）；排查问题请携带 requestId">
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="模块"
          style={{ width: 140 }}
          options={Object.entries(MODULE_LABEL).map(([value, label]) => ({ value, label }))}
          value={table.filters.module}
          onChange={(v) => table.search({ module: v })}
        />
        <Select
          allowClear
          placeholder="动作"
          style={{ width: 140 }}
          options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))}
          value={table.filters.action}
          onChange={(v) => table.search({ action: v })}
        />
        <Input.Search
          allowClear
          placeholder="操作人 / 对象ID / requestId"
          style={{ width: 260 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
      </div>
      <DataTable
        emptyKind="filtered"
       rowKey="id"
        columns={columns}
        dataSource={table.list}
        loading={table.loading}
        error={table.error}
        onRetry={table.retry}
        total={table.total}
        page={table.page}
        pageSize={table.pageSize}
        onPageChange={table.changePage}
        scroll={{ x: 1200 }}
      />
      <Drawer title="审计详情" width={480} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="操作人">{detail.adminName}（#{detail.adminId}）</Descriptions.Item>
            <Descriptions.Item label="模块">{MODULE_LABEL[detail.module] ?? detail.module}</Descriptions.Item>
            <Descriptions.Item label="动作">{ACTION_LABEL[detail.action] ?? detail.action}</Descriptions.Item>
            <Descriptions.Item label="对象">{detail.targetType} #{detail.targetId}</Descriptions.Item>
            <Descriptions.Item label="requestId">
              <span style={{ fontFamily: 'monospace' }}>{detail.requestId}</span>
            </Descriptions.Item>
            <Descriptions.Item label="IP">{detail.ip}</Descriptions.Item>
            <Descriptions.Item label="时间">{fmtTime(detail.createdAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </PageContainer>
  );
}
