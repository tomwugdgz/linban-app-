// ============================================================================
// 投诉处理：工单流（受理 → 解决/驳回 + 补偿）（契约缺口，前端补充端点）
// ============================================================================
import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { complaintApi } from '@/api/risk';
import type { Complaint } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import {
  COMPLAINT_ACTION,
  COMPLAINT_PRIORITY,
  COMPLAINT_STATUS,
  complaint_status,
  enumLabel,
  PARTY_ROLE,
} from '@/shared/enums';

interface Filters {
  status?: string;
  priority?: string;
  keyword?: string;
}

export function ComplaintsPage() {
  const table = useTable<Complaint, Filters>({
    fetcher: (params) => complaintApi.list(params),
    initialFilters: { status: 'PENDING' },
  });
  const [detail, setDetail] = useState<Complaint | null>(null);
  const [handleTarget, setHandleTarget] = useState<Complaint | null>(null);
  const [action, setAction] = useState<string>(COMPLAINT_ACTION.RESOLVE.value);
  const [resultNote, setResultNote] = useState('');
  const [compensation, setCompensation] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!handleTarget) return;
    if (action !== COMPLAINT_ACTION.PROCESS.value && !resultNote.trim()) {
      Modal.error({ content: '必须填写处理结果说明' });
      return;
    }
    setBusy(true);
    try {
      await complaintApi.handle(handleTarget.complaintNo, { action, resultNote: resultNote.trim(), compensationAmountFen: compensation });
      Modal.success({ content: '投诉单已处理' });
      setHandleTarget(null);
      setResultNote('');
      setCompensation(0);
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '投诉单号', dataIndex: 'complaintNo', width: 130 },
    { title: '投诉人', dataIndex: 'complainantNameMasked', width: 90 },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      render: (v: string) => <StatusTag kind="complaintPriority" value={v} />,
    },
    { title: '关联订单', dataIndex: 'orderNo', width: 150, render: (v?: string) => v ?? '-' },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <StatusTag kind="complaint" value={v} /> },
    { title: '处理人', dataIndex: 'handlerName', width: 90, render: (v?: string) => v ?? '-' },
    { title: '提交时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, r: Complaint) => (
        <span>
          <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
          {r.status !== complaint_status.RESOLVED && r.status !== complaint_status.REJECTED && (
            <PermissionButton
              perm="risk:*"
              size="small"
              type="link"
              onClick={() => {
                setHandleTarget(r);
                setAction(r.status === complaint_status.PENDING ? COMPLAINT_ACTION.PROCESS.value : COMPLAINT_ACTION.RESOLVE.value);
                setResultNote(r.resultNote ?? '');
                setCompensation(Number(r.compensationAmountFen) || 0);
              }}
            >
              处理
            </PermissionButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer title="投诉处理" desc="工单流：待处理 → 处理中 → 已解决/已驳回；解决可叠加优惠券补偿（契约缺口，前端补充端点）">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="涉及陪聊员违规的，处理完成后请在陪聊员列表扣减信用分；涉嫌飞单的转举报核查流程。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.values(COMPLAINT_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Select
          allowClear
          placeholder="优先级"
          style={{ width: 120 }}
          options={Object.values(COMPLAINT_PRIORITY).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.priority}
          onChange={(v) => table.search({ priority: v })}
        />
        <Input.Search
          allowClear
          placeholder="单号 / 描述 / 订单号"
          style={{ width: 220 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
      </div>
      <DataTable
        emptyKind="clean"
        emptyText={<>当前无投诉工单<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>系统运行正常</span></>}
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
      <Drawer title={`投诉详情 ${detail?.complaintNo ?? ''}`} width={520} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="投诉人">{detail.complainantNameMasked}（{enumLabel(PARTY_ROLE, detail.complainantRole)}）</Descriptions.Item>
            <Descriptions.Item label="关联订单">{detail.orderNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="优先级"><StatusTag kind="complaintPriority" value={detail.priority} /></Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag kind="complaint" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="描述">{detail.description}</Descriptions.Item>
            <Descriptions.Item label="补偿金额">{detail.compensationAmountFen ? `¥${Number(detail.compensationAmountFen) / 100}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="处理结果">{detail.resultNote ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="处理人">{detail.handlerName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="处理时间">{fmtTime(detail.handledAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      <Modal
        title={`处理投诉 ${handleTarget?.complaintNo ?? ''}`}
        open={!!handleTarget}
        onOk={submit}
        onCancel={() => setHandleTarget(null)}
        confirmLoading={busy}
        okText="确认处理"
      >
        <Form layout="vertical">
          <Form.Item label="处理动作">
            <Select
              value={action}
              onChange={(v) => setAction(v)}
              options={[
                { value: 'PROCESS', label: '受理（转处理中）' },
                { value: 'RESOLVE', label: '解决（办结）' },
                { value: 'REJECT', label: '驳回（证据不足）' },
              ]}
            />
          </Form.Item>
          {action === COMPLAINT_ACTION.RESOLVE.value && (
            <Form.Item label="补偿金额（分，0 = 不补偿）" extra="将以优惠券形式发放至投诉人账户">
              <InputNumber style={{ width: '100%' }} min={0} value={compensation} onChange={(v) => setCompensation(v ?? 0)} addonAfter="分" />
            </Form.Item>
          )}
          <Form.Item label="处理结果说明" required={action !== COMPLAINT_ACTION.PROCESS.value}>
            <Input.TextArea rows={3} value={resultNote} onChange={(e) => setResultNote(e.target.value)} placeholder="如：已联系双方核实，补偿优惠券并警告陪聊员" maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
