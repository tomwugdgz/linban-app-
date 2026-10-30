// ============================================================================
// 孝心时长卡：发行 / 绑定 / 核销台账（契约缺口，前端补充端点）
// ============================================================================
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { giftCardApi } from '@/api/marketing';
import type { GiftCard } from '@/shared/types';
import { fmtDuration, fmtTime } from '@/shared/format';
import { GIFT_CARD_STATUS } from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
}

/** 发行面值档位（分）：¥200 / ¥500 / ¥1000，对应 2h / 5h / 10h */
const FACE_PRESETS = [
  { faceAmountFen: 20000, durationMinutes: 120 },
  { faceAmountFen: 50000, durationMinutes: 300 },
  { faceAmountFen: 100000, durationMinutes: 600 },
];

export function GiftCardsPage() {
  const table = useTable<GiftCard, Filters>({
    fetcher: (params) => giftCardApi.list(params),
    initialFilters: {},
  });
  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState({ faceAmountFen: 50000, durationMinutes: 300, buyerName: '', recipientName: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<GiftCard | null>(null);

  const issue = async () => {
    setBusy(true);
    try {
      await giftCardApi.issue({
        faceAmountFen: form.faceAmountFen,
        durationMinutes: form.durationMinutes,
        buyerName: form.buyerName,
        recipientName: form.recipientName,
        message: form.message,
      });
      Modal.success({ content: '时长卡发行成功' });
      setIssueOpen(false);
      setForm({ faceAmountFen: 50000, durationMinutes: 300, buyerName: '', recipientName: '', message: '' });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '卡号', dataIndex: 'cardNo', width: 180 },
    { title: '购买人（脱敏）', dataIndex: 'buyerNameMasked', width: 110 },
    { title: '受赠人（脱敏）', dataIndex: 'recipientNameMasked', width: 110 },
    { title: '绑定用户', dataIndex: 'boundUserNameMasked', width: 110, render: (v?: string) => v ?? <Tag>未绑定</Tag> },
    { title: '面值', dataIndex: 'faceAmountFen', width: 100, render: (v: string) => <MoneyText fen={v} /> },
    { title: '时长', dataIndex: 'durationMinutes', width: 100, render: (v: number) => fmtDuration(v) },
    { title: '余额', dataIndex: 'balanceAmountFen', width: 100, render: (v: string) => <MoneyText fen={v} /> },
    { title: '剩余时长', dataIndex: 'balanceDurationMinutes', width: 100, render: (v: number) => fmtDuration(v) },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <StatusTag kind="giftCard" value={v} /> },
    { title: '到期时间', dataIndex: 'expiresAt', width: 120, render: (v?: string) => (v ? fmtTime(v, 'YYYY-MM-DD') : '永久') },
    { title: '购买时间', dataIndex: 'purchasedAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, r: GiftCard) => (
        <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
      ),
    },
  ];

  return (
    <PageContainer
      title="孝心时长卡"
      desc="子女代购赠送老人；绑定后按订单抵扣时长，核销记录关联订单流水"
      extra={
        <PermissionButton perm="marketing:*" type="primary" onClick={() => setIssueOpen(true)}>
          发行时长卡
        </PermissionButton>
      }
    >
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="面值档位：¥200=2 小时 / ¥500=5 小时 / ¥1000=10 小时；卡内余额与时长双账本，核销按订单时长扣减。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.values(GIFT_CARD_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input.Search
          allowClear
          placeholder="卡号 / 购买人 / 受赠人"
          style={{ width: 240 }}
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
        scroll={{ x: 1400 }}
      />
      <Modal title="发行孝心时长卡" open={issueOpen} onOk={issue} onCancel={() => setIssueOpen(false)} confirmLoading={busy} okText="确认发行">
        <Form layout="vertical">
          <Form.Item label="面值档位">
            <Select
              value={form.faceAmountFen}
              onChange={(v) => {
                const preset = FACE_PRESETS.find((p) => p.faceAmountFen === v)!;
                setForm({ ...form, faceAmountFen: preset.faceAmountFen, durationMinutes: preset.durationMinutes });
              }}
              options={FACE_PRESETS.map((p) => ({ value: p.faceAmountFen, label: `¥${p.faceAmountFen / 100} = ${fmtDuration(p.durationMinutes)}` }))}
            />
          </Form.Item>
          <Form.Item label="面值金额（分）">
            <InputNumber style={{ width: '100%' }} min={100} value={form.faceAmountFen} onChange={(v) => setForm({ ...form, faceAmountFen: v ?? 0 })} addonAfter="分" />
          </Form.Item>
          <Form.Item label="时长（分钟）">
            <InputNumber style={{ width: '100%' }} min={10} value={form.durationMinutes} onChange={(v) => setForm({ ...form, durationMinutes: v ?? 0 })} addonAfter="分钟" />
          </Form.Item>
          <Form.Item label="购买人姓名">
            <Input value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} placeholder="后台发行可留空" />
          </Form.Item>
          <Form.Item label="受赠人姓名">
            <Input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} placeholder="后台发行可留空" />
          </Form.Item>
          <Form.Item label="祝福语">
            <Input.TextArea rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={100} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={`时长卡详情 ${detail?.cardNo ?? ''}`} open={!!detail} footer={null} onCancel={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="状态"><StatusTag kind="giftCard" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="购买人（脱敏）">{detail.buyerNameMasked}</Descriptions.Item>
            <Descriptions.Item label="受赠人（脱敏）">{detail.recipientNameMasked}</Descriptions.Item>
            <Descriptions.Item label="绑定用户">{detail.boundUserNameMasked ?? '未绑定'}</Descriptions.Item>
            <Descriptions.Item label="绑定时间">{fmtTime(detail.boundAt)}</Descriptions.Item>
            <Descriptions.Item label="祝福语">{detail.message ?? '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </PageContainer>
  );
}
