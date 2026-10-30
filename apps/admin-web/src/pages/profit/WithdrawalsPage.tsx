// ============================================================================
// 提现审核：T+1 审核流（通过/驳回 + 原因）；契约 5.3 POST /admin/withdrawals/:no/review
// ============================================================================
import { Alert, Button, Descriptions, Form, Input, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { withdrawalApi } from '@/api/withdrawal';
import type { Withdrawal } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { WITHDRAWAL_STATUS, withdrawal_status } from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
}

export function WithdrawalsPage() {
  const table = useTable<Withdrawal, Filters>({
    fetcher: (params) => withdrawalApi.list(params),
    initialFilters: { status: 'PENDING_REVIEW' },
  });
  const [rejectTarget, setRejectTarget] = useState<Withdrawal | null>(null);
  const [detail, setDetail] = useState<Withdrawal | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const approve = async (w: Withdrawal) => {
    setBusy(true);
    try {
      await withdrawalApi.review(w.withdrawalNo, 'APPROVE');
      Modal.success({ content: `提现单 ${w.withdrawalNo} 审核通过，将进入微信批量转账` });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget) return;
    if (!reason.trim()) {
      Modal.error({ content: '驳回必须填写原因（将同步给陪聊员）' });
      return;
    }
    setBusy(true);
    try {
      await withdrawalApi.review(rejectTarget.withdrawalNo, 'REJECT', reason.trim());
      Modal.success({ content: `提现单 ${rejectTarget.withdrawalNo} 已驳回` });
      setRejectTarget(null);
      setReason('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '提现单号', dataIndex: 'withdrawalNo', width: 180 },
    { title: '陪聊员', dataIndex: 'companionName', width: 90 },
    { title: '提现金额', dataIndex: 'amountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '手续费', dataIndex: 'feeFen', width: 80, render: (v: string) => <MoneyText fen={v} /> },
    { title: '到账金额', dataIndex: 'actualAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} strong /> },
    { title: '收款账户', dataIndex: 'bankAccountMasked', width: 200 },
    { title: '开户行', dataIndex: 'bankName', width: 100 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => <StatusTag kind="withdrawal" value={v} />,
    },
    {
      title: '二次验证',
      width: 110,
      render: (_: unknown, r: Withdrawal) => (
        <span>
          <Tag color={r.faceVerified ? 'green' : 'default'}>{r.faceVerified ? '人脸✓' : '人脸-'}</Tag>
          <Tag color={r.smsVerified ? 'green' : 'default'}>{r.smsVerified ? '短信✓' : '短信-'}</Tag>
        </span>
      ),
    },
    { title: '申请时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 170,
      fixed: 'right' as const,
      render: (_: unknown, r: Withdrawal) =>
        r.status === withdrawal_status.PENDING_REVIEW ? (
          <span>
            <PermissionButton perm="withdrawal:*" size="small" type="primary" loading={busy} onClick={() => approve(r)}>
              通过
            </PermissionButton>
            <PermissionButton perm="withdrawal:*" size="small" danger style={{ marginLeft: 8 }} onClick={() => { setRejectTarget(r); setReason(''); }}>
              驳回
            </PermissionButton>
          </span>
        ) : (
          <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
        ),
    },
  ];

  return (
    <PageContainer title="提现审核" desc="陪聊员提现 T+1 人工审核；驳回原因将同步给陪聊员端">
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="审核要点：到账金额 = 提现金额 − 手续费；户名与实名不一致、人脸/短信验证缺失、保证金未缴清的应驳回"
      />
      <div className="filter-bar">
        <Select
          placeholder="审核状态"
          style={{ width: 160 }}
          allowClear
          options={Object.values(WITHDRAWAL_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input.Search
          allowClear
          placeholder="提现单号 / 陪聊员"
          style={{ width: 240 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
      </div>
      <DataTable
        emptyKind="clean"
        emptyText={<>当前无待审提现<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>系统运行正常</span></>}
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
      <Modal
        title={`驳回提现单 ${rejectTarget?.withdrawalNo ?? ''}`}
        open={!!rejectTarget}
        onOk={reject}
        onCancel={() => setRejectTarget(null)}
        confirmLoading={busy}
        okButtonProps={{ danger: true }}
        okText="确认驳回"
      >
        {rejectTarget && (
          <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="陪聊员">{rejectTarget.companionName}</Descriptions.Item>
            <Descriptions.Item label="提现金额"><MoneyText fen={rejectTarget.amountFen} /></Descriptions.Item>
            <Descriptions.Item label="收款账户">{rejectTarget.bankAccountMasked}（{rejectTarget.accountNameMasked}）</Descriptions.Item>
          </Descriptions>
        )}
        <Form layout="vertical">
          <Form.Item label="驳回原因" required>
            <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：银行卡户名与实名信息不一致" maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={`提现单详情 ${detail?.withdrawalNo ?? ''}`} open={!!detail} footer={null} onCancel={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="状态"><StatusTag kind="withdrawal" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="驳回原因">{detail.rejectReason ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="微信批次号">{detail.wxBatchNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="审核时间">{fmtTime(detail.reviewedAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </PageContainer>
  );
}
