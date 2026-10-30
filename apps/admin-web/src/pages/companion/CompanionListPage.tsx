// ============================================================================
// 陪聊员列表：信用分/等级/保证金/封禁管理（契约 5.2 credit / status）
// ============================================================================
import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { companionApi } from '@/api/companion';
import type { Companion } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { COMPANION_STATUS, companion_status } from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
  creditSort?: 'asc' | 'desc';
}

/** 信用分阈值（§8.3 配置化）：<60 限流派单，<40 冻结接单 */
const creditTag = (score: number) => {
  if (score < 40) return <Tag color="red">{score}（冻结）</Tag>;
  if (score < 60) return <Tag color="orange">{score}（限流）</Tag>;
  return <Tag color="green">{score}</Tag>;
};

export function CompanionListPage() {
  const table = useTable<Companion, Filters>({
    fetcher: (params) => companionApi.list(params),
    initialFilters: {},
  });
  const [detail, setDetail] = useState<Companion | null>(null);
  const [statusTarget, setStatusTarget] = useState<{ c: Companion; to: 'SUSPENDED' | 'BANNED' | 'ACTIVE' } | null>(null);
  const [reason, setReason] = useState('');
  const [creditTarget, setCreditTarget] = useState<Companion | null>(null);
  const [creditDelta, setCreditDelta] = useState<number>(5);
  const [creditReason, setCreditReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submitStatus = async () => {
    if (!statusTarget) return;
    if (!reason.trim()) {
      Modal.error({ content: '必须填写操作原因（留痕 credit_logs / audit_logs）' });
      return;
    }
    setBusy(true);
    try {
      await companionApi.updateStatus(statusTarget.c.id, statusTarget.to, reason.trim());
      Modal.success({ content: `已将 ${statusTarget.c.nameMasked} 状态更新为 ${COMPANION_STATUS[statusTarget.to].label}` });
      setStatusTarget(null);
      setReason('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const submitCredit = async () => {
    if (!creditTarget) return;
    if (!creditReason.trim()) {
      Modal.error({ content: '必须填写调整原因' });
      return;
    }
    setBusy(true);
    try {
      await companionApi.adjustCredit(creditTarget.id, creditDelta, creditReason.trim());
      Modal.success({ content: `信用分已调整为 ${creditDelta > 0 ? '+' : ''}${creditDelta}，留痕 credit_logs` });
      setCreditTarget(null);
      setCreditReason('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '姓名', dataIndex: 'nameMasked', width: 90 },
    { title: '手机号', dataIndex: 'phoneMasked', width: 130 },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <StatusTag kind="companion" value={v} /> },
    { title: '等级', dataIndex: 'level', width: 60, render: (v: number) => `L${v}` },
    { title: '信用分', dataIndex: 'creditScore', width: 100, render: (v: number) => creditTag(v) },
    { title: '时薪', dataIndex: 'hourlyRateFen', width: 90, render: (v: string) => <MoneyText fen={v} /> },
    { title: '保证金', dataIndex: 'depositBalanceFen', width: 90, render: (v: string) => <MoneyText fen={v} /> },
    { title: '评分', dataIndex: 'ratingAvg', width: 80, render: (v: number, r: Companion) => `${v}（${r.ratingCount}）` },
    { title: '成单/取消', width: 110, render: (_: unknown, r: Companion) => `${r.completedOrders} / ${r.cancelledOrders}` },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 160,
      render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>),
    },
    { title: '入驻时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: unknown, r: Companion) => (
        <span>
          <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
          <PermissionButton perm="companion:*" size="small" type="link" onClick={() => { setCreditTarget(r); setCreditDelta(5); setCreditReason(''); }}>调信用分</PermissionButton>
          {r.status === companion_status.BANNED ? (
            <PermissionButton perm="companion:*" size="small" type="link" onClick={() => { setStatusTarget({ c: r, to: companion_status.ACTIVE }); setReason(''); }}>解封</PermissionButton>
          ) : (
            <PermissionButton perm="companion:*" size="small" type="link" danger onClick={() => { setStatusTarget({ c: r, to: companion_status.BANNED }); setReason(''); }}>封禁</PermissionButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer title="陪聊员列表" desc="信用分阈值：&lt;60 限流派单，&lt;40 冻结接单（§8.3，system_configs 化）">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="封禁将联动黑名单建议与保证金罚扣流程；解封后信用分恢复至 60。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.values(COMPANION_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Select
          allowClear
          placeholder="信用分排序"
          style={{ width: 140 }}
          options={[{ value: 'asc', label: '信用分升序' }, { value: 'desc', label: '信用分降序' }]}
          value={table.filters.creditSort}
          onChange={(v) => table.search({ creditSort: v })}
        />
        <Input.Search
          allowClear
          placeholder="姓名 / ID"
          style={{ width: 200 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
        <div className="filter-actions">
          <Button onClick={() => table.reset()}>重置</Button>
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
        scroll={{ x: 1500 }}
      />
      <Drawer title={`陪聊员详情 ${detail?.nameMasked ?? ''}`} width={480} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="手机号">{detail.phoneMasked}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag kind="companion" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="等级">L{detail.level}</Descriptions.Item>
            <Descriptions.Item label="信用分">{creditTag(detail.creditScore)}</Descriptions.Item>
            <Descriptions.Item label="时薪"><MoneyText fen={detail.hourlyRateFen} /> / 小时</Descriptions.Item>
            <Descriptions.Item label="服务半径">{detail.serviceRadiusM} 米</Descriptions.Item>
            <Descriptions.Item label="保证金余额"><MoneyText fen={detail.depositBalanceFen} /></Descriptions.Item>
            <Descriptions.Item label="成单 / 取消">{detail.completedOrders} / {detail.cancelledOrders}</Descriptions.Item>
            <Descriptions.Item label="评分">{detail.ratingAvg}（{detail.ratingCount} 次评价）</Descriptions.Item>
            <Descriptions.Item label="标签">{detail.tags.join('、')}</Descriptions.Item>
            <Descriptions.Item label="入驻时间">{fmtTime(detail.createdAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      <Modal
        title={`${statusTarget?.to === companion_status.ACTIVE ? '解封' : '封禁'} ${statusTarget?.c.nameMasked ?? ''}`}
        open={!!statusTarget}
        onOk={submitStatus}
        onCancel={() => setStatusTarget(null)}
        confirmLoading={busy}
        okButtonProps={{ danger: statusTarget?.to !== companion_status.ACTIVE }}
      >
        <Form layout="vertical">
          <Form.Item label="操作原因" required extra="原因将写入 audit_logs 与 credit_logs">
            <Input.TextArea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={statusTarget?.to === companion_status.BANNED ? '如：飞单坐实，保证金罚扣并清退' : '如：申诉成立，恢复接单资格'} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`调整信用分 ${creditTarget?.nameMasked ?? ''}（当前 ${creditTarget?.creditScore ?? '-'}）`}
        open={!!creditTarget}
        onOk={submitCredit}
        onCancel={() => setCreditTarget(null)}
        confirmLoading={busy}
      >
        <Form layout="vertical">
          <Form.Item label="调整值" extra="范围 -20 ~ +20，调整后自动校验 0–100">
            <InputNumber style={{ width: '100%' }} min={-20} max={20} value={creditDelta} onChange={(v) => setCreditDelta(v ?? 0)} />
          </Form.Item>
          <Form.Item label="调整原因" required>
            <Input.TextArea rows={2} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="如：投诉属实扣 10 分" maxLength={200} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
