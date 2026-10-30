// ============================================================================
// 对账中心：local vs 微信差异批次 + 触发对账 + 差异处理
// ============================================================================
import { Alert, Button, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import type { Dayjs } from 'dayjs';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { reconApi } from '@/api/recon';
import type { ReconciliationRecord } from '@/shared/types';
import { fmtDate, fmtTime } from '@/shared/format';
import { RECON_CHANNEL, RECON_STATUS, recon_status } from '@/shared/enums';

interface Filters {
  status?: string;
  channel?: string;
  startDate?: string;
  endDate?: string;
}

export function ReconPage() {
  const table = useTable<ReconciliationRecord, Filters>({
    fetcher: (params) => reconApi.batches(params),
    initialFilters: {},
  });
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [detail, setDetail] = useState<ReconciliationRecord | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ReconciliationRecord | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const batch = await reconApi.run();
      Modal.success({ content: `已触发对账，批次 ${batch.batchNo}（${RECON_CHANNEL[batch.channel]?.label ?? batch.channel}）` });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!resolveTarget) return;
    if (!note.trim()) {
      Modal.error({ content: '处理必须填写说明（留痕审计）' });
      return;
    }
    setBusy(true);
    try {
      await reconApi.resolve(resolveTarget.batchNo, note.trim());
      Modal.success({ content: `批次 ${resolveTarget.batchNo} 差异已处理` });
      setResolveTarget(null);
      setNote('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '批次号', dataIndex: 'batchNo', width: 170 },
    { title: '账期', dataIndex: 'batchDate', width: 120, render: (v: string) => fmtDate(v) },
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 120,
      render: (v: string) => <Tag color={RECON_CHANNEL[v]?.color}>{RECON_CHANNEL[v]?.label ?? v}</Tag>,
    },
    { title: '本地笔数', dataIndex: 'localCount', width: 90 },
    { title: '本地金额', dataIndex: 'localAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '微信笔数', dataIndex: 'wxCount', width: 90 },
    { title: '微信金额', dataIndex: 'wxAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    {
      title: '差异',
      dataIndex: 'diffCount',
      width: 100,
      render: (v: number, r: ReconciliationRecord) => (v > 0 ? <Tag color="red">{v} 笔 / <MoneyText fen={r.diffAmountFen} /></Tag> : <Tag color="green">0</Tag>),
    },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => <StatusTag kind="recon" value={v} /> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 150,
      fixed: 'right' as const,
      render: (_: unknown, r: ReconciliationRecord) => (
        <span>
          <Button type="link" size="small" onClick={() => setDetail(r)}>差异明细</Button>
          {r.status === recon_status.DIFF && (
            <PermissionButton perm="recon:*" size="small" type="link" onClick={() => { setResolveTarget(r); setNote(''); }}>
              处理
            </PermissionButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer
      title="对账中心"
      desc="每日三方流水比对（本地 / 微信支付 / 分账退款）；差异批次告警并留痕"
      extra={
        <PermissionButton perm="recon:*" type="primary" loading={busy} onClick={run}>
          触发对账
        </PermissionButton>
      }
    >
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="差异处理需填写说明；确认属微信侧脏数据或测试数据的，在说明中注明核实依据。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="批次状态"
          style={{ width: 160 }}
          options={Object.values(RECON_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Select
          allowClear
          placeholder="渠道"
          style={{ width: 160 }}
          options={Object.values(RECON_CHANNEL).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.channel}
          onChange={(v) => table.search({ channel: v })}
        />
        <DatePicker.RangePicker
          value={dates}
          onChange={(v) => setDates(v as [Dayjs | null, Dayjs | null])}
          placeholder={['账期起', '账期止']}
        />
        <div className="filter-actions">
          <Button
            type="primary"
            onClick={() =>
              table.search({
                status: table.filters.status,
                channel: table.filters.channel,
                startDate: dates[0]?.format('YYYY-MM-DD'),
                endDate: dates[1]?.format('YYYY-MM-DD'),
              })
            }
          >
            查询
          </Button>
          <Button onClick={() => { table.reset(); setDates([null, null]); }}>重置</Button>
        </div>
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
        scroll={{ x: 1400 }}
      />
      <Drawer title={`差异明细 ${detail?.batchNo ?? ''}`} width={560} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="账期">{fmtDate(detail.batchDate)}</Descriptions.Item>
              <Descriptions.Item label="本地 vs 微信">
                {detail.localCount} 笔 / <MoneyText fen={detail.localAmountFen} /> vs {detail.wxCount} 笔 / <MoneyText fen={detail.wxAmountFen} />
              </Descriptions.Item>
              <Descriptions.Item label="差异"><Tag color="red">{detail.diffCount} 笔</Tag> <MoneyText fen={detail.diffAmountFen} /></Descriptions.Item>
              <Descriptions.Item label="处理说明">{detail.resolveNote ?? '未处理'}</Descriptions.Item>
              <Descriptions.Item label="处理时间">{fmtTime(detail.resolvedAt)}</Descriptions.Item>
            </Descriptions>
            {(detail.diffDetail ?? []).map((d, i) => (
              <Descriptions key={i} column={1} size="small" style={{ marginBottom: 8 }}>
                <Descriptions.Item label="业务单号">{d.bizNo}</Descriptions.Item>
                <Descriptions.Item label="本地">{d.local}</Descriptions.Item>
                <Descriptions.Item label="微信">{d.wx}</Descriptions.Item>
                <Descriptions.Item label="原因">{d.reason}</Descriptions.Item>
              </Descriptions>
            ))}
          </>
        )}
      </Drawer>
      <Modal
        title={`处理差异批次 ${resolveTarget?.batchNo ?? ''}`}
        open={!!resolveTarget}
        onOk={resolve}
        onCancel={() => setResolveTarget(null)}
        confirmLoading={busy}
        okText="确认处理"
      >
        <Form layout="vertical">
          <Form.Item label="处理说明" required extra="例如：已与微信客服核实为测试环境脏数据（工单号 xxx），差异忽略">
            <Input.TextArea rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
