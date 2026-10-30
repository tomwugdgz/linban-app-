// ============================================================================
// 抽检任务：AI 会话 / IM 消息人工抽检（契约缺口，前端补充端点）
// 抽检比例取 system_configs.ai_sample_rate（默认 5%）。
// ============================================================================
import { Alert, Button, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { samplingApi } from '@/api/risk';
import type { SamplingTask } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { enumLabel, SAMPLING_RESULT, SAMPLING_STATUS } from '@/shared/enums';

interface Filters {
  status?: string;
}

const TARGET_TYPE_LABEL: Record<string, string> = {
  AI_SESSION: 'AI 会话',
  IM_MESSAGE: 'IM 消息',
  REVISIT: '回访',
};

export function SamplingPage() {
  const table = useTable<SamplingTask, Filters>({
    fetcher: (params) => samplingApi.list(params),
    initialFilters: { status: 'PENDING' },
  });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SamplingTask | null>(null);

  const review = async (t: SamplingTask, result: string) => {
    setBusy(true);
    try {
      await samplingApi.review(t.taskNo, result);
      Modal.success({ content: result === SAMPLING_RESULT.PASS.value ? '抽检通过' : '抽检不通过，已转风控事件' });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '任务号', dataIndex: 'taskNo', width: 120 },
    { title: '类型', dataIndex: 'targetType', width: 100, render: (v: string) => <Tag>{TARGET_TYPE_LABEL[v] ?? v}</Tag> },
    { title: '对象', dataIndex: 'targetRef', width: 170 },
    { title: '当事人（脱敏）', dataIndex: 'subjectNameMasked', width: 120 },
    { title: '抽检比例', dataIndex: 'sampleRate', width: 90, render: (v: number) => `${(v * 100).toFixed(0)}%` },
    { title: '内容摘要', dataIndex: 'contentPreview', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={SAMPLING_STATUS[v]?.color}>{enumLabel(SAMPLING_STATUS, v)}</Tag> },
    {
      title: '结果',
      dataIndex: 'reviewResult',
      width: 80,
      render: (v?: string) => (v ? <Tag color={SAMPLING_RESULT[v]?.color}>{enumLabel(SAMPLING_RESULT, v)}</Tag> : '-'),
    },
    { title: '抽检人', dataIndex: 'reviewerName', width: 90, render: (v?: string) => v ?? '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, r: SamplingTask) =>
        r.status === SAMPLING_STATUS.PENDING.value ? (
          <span>
            <PermissionButton perm="risk:*" size="small" type="primary" loading={busy} onClick={() => review(r, SAMPLING_RESULT.PASS.value)}>通过</PermissionButton>
            <PermissionButton perm="risk:*" size="small" danger style={{ marginLeft: 8 }} loading={busy} onClick={() => review(r, SAMPLING_RESULT.REJECT.value)}>不通过</PermissionButton>
          </span>
        ) : (
          <Button type="link" size="small" onClick={() => setPreview(r)}>查看</Button>
        ),
    },
  ];

  return (
    <PageContainer title="抽检任务" desc="AI 会话与 IM 内容按比例人工抽检；不通过自动转风控事件（契约缺口，前端补充端点）">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="抽检比例取 system_configs.ai_sample_rate（默认 5%）；命中风控规则或被投诉引用的消息不归档，保证取证链完整。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={[{ value: 'PENDING', label: '待抽检' }, { value: 'REVIEWED', label: '已抽检' }]}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
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
        scroll={{ x: 1300 }}
      />
      <Modal title={`抽检内容 ${preview?.taskNo ?? ''}`} open={!!preview} footer={null} onCancel={() => setPreview(null)}>
        {preview && (
          <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, fontSize: 13, lineHeight: 1.8 }}>
            {preview.contentPreview}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
