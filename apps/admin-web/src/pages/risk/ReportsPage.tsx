// ============================================================================
// 举报管理：飞单举报核查 + 奖励发放（契约 5.4：handle；reward 为前端补充）
// 契约红线：奖励金额取 system_configs.report_reward，不写死；同订单同举报人去重。
// ============================================================================
import { Alert, Button, Descriptions, Drawer, Form, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { ConfirmButton } from '@/components/ConfirmButton';
import { useTable } from '@/hooks/useTable';
import { reportApi } from '@/api/risk';
import type { Report } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { enumLabel, PARTY_ROLE, REPORT_ACTION, REPORT_STATUS, report_reward_status, report_status } from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
}

const REPORT_TYPE_LABEL: Record<string, string> = {
  OFFLINE_PRICE: '线下报价',
  CONTACT_EXCHANGE: '联系方式交换',
  OTHER: '其他',
};

export function ReportsPage() {
  const table = useTable<Report, Filters>({
    fetcher: (params) => reportApi.list(params),
    initialFilters: { status: 'PENDING' },
  });
  const [detail, setDetail] = useState<Report | null>(null);
  const [handleTarget, setHandleTarget] = useState<Report | null>(null);
  const [action, setAction] = useState<'SUBSTANTIATED' | 'UNFOUNDED'>('SUBSTANTIATED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!handleTarget) return;
    if (!note.trim()) {
      Modal.error({ content: '必须填写核查说明' });
      return;
    }
    setBusy(true);
    try {
      await reportApi.handle(handleTarget.reportNo, action, note.trim());
      Modal.success({
        content: action === report_status.SUBSTANTIATED ? '核查属实：奖励券待发放，飞单处罚（−20 分清退）已联动' : '核查不属实，已留存记录',
      });
      setHandleTarget(null);
      setNote('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const grantReward = async (r: Report) => {
    setBusy(true);
    try {
      await reportApi.grantReward(r.reportNo);
      Modal.success({ content: `举报奖励已发放：¥${Number(r.rewardAmountFen) / 100}（金额取 system_configs.report_reward）` });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '举报单号', dataIndex: 'reportNo', width: 130 },
    { title: '举报人', dataIndex: 'reporterNameMasked', width: 90 },
    { title: '被举报人', dataIndex: 'targetNameMasked', width: 100 },
    { title: '类型', dataIndex: 'type', width: 110, render: (v: string) => REPORT_TYPE_LABEL[v] ?? v },
    { title: '关联订单', dataIndex: 'orderNo', width: 150, render: (v?: string) => v ?? '-' },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <StatusTag kind="report" value={v} /> },
    {
      title: '奖励',
      key: 'reward',
      width: 130,
      render: (_: unknown, r: Report) => (
        <span>
          <StatusTag kind="reportReward" value={r.rewardStatus} />
          {r.rewardStatus !== report_reward_status.NONE && <span style={{ marginLeft: 6 }}><MoneyText fen={r.rewardAmountFen} /></span>}
        </span>
      ),
    },
    { title: '提交时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 190,
      fixed: 'right' as const,
      render: (_: unknown, r: Report) => (
        <span>
          <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
          {r.status === report_status.PENDING && (
            <PermissionButton
              perm="report:*"
              size="small"
              type="link"
              onClick={() => {
                setHandleTarget(r);
                setAction('SUBSTANTIATED');
                setNote('');
              }}
            >
              核查
            </PermissionButton>
          )}
          {r.rewardStatus === report_reward_status.PENDING && (
            <ConfirmButton
              title="确认发放举报奖励？"
              description={`属实举报奖励 ¥${Number(r.rewardAmountFen) / 100}，发放后不可撤销`}
              onConfirm={() => grantReward(r)}
            >
              <PermissionButton perm="report:*" size="small" type="link" loading={busy}>发奖励</PermissionButton>
            </ConfirmButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer title="举报管理" desc="飞单/私下交易举报核查；属实发放奖励券并对陪聊员 −20 分清退（契约 5.4）">
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="防刷规则：同订单同举报人去重；奖励金额取 system_configs.report_reward（当前默认 ¥20），不写死。"
      />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="核查状态"
          style={{ width: 140 }}
          options={Object.values(REPORT_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input.Search
          allowClear
          placeholder="单号 / 描述"
          style={{ width: 220 }}
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
        scroll={{ x: 1500 }}
      />
      <Drawer title={`举报详情 ${detail?.reportNo ?? ''}`} width={520} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="举报人">{detail.reporterNameMasked}（{enumLabel(PARTY_ROLE, detail.reporterRole)}）</Descriptions.Item>
            <Descriptions.Item label="被举报人">{detail.targetNameMasked}</Descriptions.Item>
            <Descriptions.Item label="类型">{REPORT_TYPE_LABEL[detail.type] ?? detail.type}</Descriptions.Item>
            <Descriptions.Item label="关联订单">{detail.orderNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="描述">{detail.description}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag kind="report" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="奖励状态"><StatusTag kind="reportReward" value={detail.rewardStatus} /> {detail.rewardAmountFen !== '0' && <MoneyText fen={detail.rewardAmountFen} />}</Descriptions.Item>
            <Descriptions.Item label="核查说明">{detail.handleNote ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="核查人">{detail.handlerName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="核查时间">{fmtTime(detail.handledAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      <Modal
        title={`核查举报 ${handleTarget?.reportNo ?? ''}`}
        open={!!handleTarget}
        onOk={submit}
        onCancel={() => setHandleTarget(null)}
        confirmLoading={busy}
        okText="确认核查"
        okButtonProps={{ danger: action === REPORT_ACTION.SUBSTANTIATED.value }}
      >
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="属实将：发放举报奖励券 + 陪聊员信用分 −20 + 保证金罚扣清退流程。" />
        <Form layout="vertical">
          <Form.Item label="核查结论">
            <Select
              value={action}
              onChange={(v) => setAction(v)}
              options={[
                { value: 'SUBSTANTIATED', label: '属实（IM 记录/支付流水坐实）' },
                { value: 'UNFOUNDED', label: '不属实（未发现违规记录）' },
              ]}
            />
          </Form.Item>
          <Form.Item label="核查说明" required extra="如：IM 记录核实存在线下报价，属实">
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
