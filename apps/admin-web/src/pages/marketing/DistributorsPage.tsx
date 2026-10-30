// ============================================================================
// 社区团长：列表 + 佣金流水 + 结算/打款（契约缺口，前端补充端点）
// ============================================================================
import { Alert, Button, Input, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { ConfirmButton } from '@/components/ConfirmButton';
import { useTable } from '@/hooks/useTable';
import { distributorApi, commissionApi } from '@/api/marketing';
import type { Commission, Distributor } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { COMMISSION_STATUS, COMMISSION_TYPE, commission_status, enumLabel } from '@/shared/enums';

const DIST_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '合作中', color: 'green' },
  FROZEN: { label: '已冻结', color: 'red' },
};

export function DistributorsPage() {
  const table = useTable<Distributor, { status?: string; keyword?: string }>({
    fetcher: (params) => distributorApi.list(params),
    initialFilters: {},
  });
  const [commTarget, setCommTarget] = useState<Distributor | null>(null);
  const commTable = useTable<Commission, { status?: string }>({
    fetcher: (params) =>
      commTarget ? commissionApi.list({ ...params, distributorId: commTarget.id }) : Promise.resolve({ list: [], total: 0, page: 1, pageSize: 20 }),
    initialFilters: {},
    deps: [commTarget?.id],
  });
  const [busy, setBusy] = useState(false);

  const settleAll = async (d: Distributor) => {
    setBusy(true);
    try {
      const res = await distributorApi.settleAll(d.id);
      Modal.success({ content: `已结算并打款 ${res.settledCount} 笔，合计 ¥${Number(res.settledAmountFen) / 100}` });
      table.refresh();
      commTable.refresh();
    } finally {
      setBusy(false);
    }
  };

  const settleOne = async (c: Commission) => {
    setBusy(true);
    try {
      await commissionApi.settle(c.id);
      commTable.refresh();
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '团长编号', dataIndex: 'distributorNo', width: 100 },
    { title: '姓名', dataIndex: 'name', width: 90 },
    { title: '手机号', dataIndex: 'phoneMasked', width: 130 },
    { title: '社区', dataIndex: 'communityName', ellipsis: true },
    { title: '邀请码', dataIndex: 'inviteCode', width: 100 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={DIST_STATUS[v]?.color}>{DIST_STATUS[v]?.label ?? v}</Tag> },
    { title: '累计佣金', dataIndex: 'totalCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '已结算', dataIndex: 'settledCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '待结算', dataIndex: 'pendingCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} strong /> },
    { title: '入驻时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 150,
      fixed: 'right' as const,
      render: (_: unknown, r: Distributor) => (
        <span>
          <Button type="link" size="small" onClick={() => setCommTarget(r)}>佣金流水</Button>
          <ConfirmButton
            title={`确认结算并打款 ${r.name} 的全部待结算佣金？`}
            description={`合计待结算 ¥${Number(r.pendingCommissionFen) / 100}，打款后不可撤销`}
            onConfirm={() => settleAll(r)}
          >
            <PermissionButton perm="marketing:*" size="small" type="link" disabled={Number(r.pendingCommissionFen) <= 0} loading={busy}>
              一键结算
            </PermissionButton>
          </ConfirmButton>
        </span>
      ),
    },
  ];

  const commColumns = [
    { title: '流水号', dataIndex: 'commissionNo', width: 120 },
    { title: '类型', dataIndex: 'type', width: 120, render: (v: string) => enumLabel(COMMISSION_TYPE, v) },
    { title: '关联订单', dataIndex: 'orderNo', width: 160, render: (v?: string) => v ?? '-' },
    { title: '关联用户', dataIndex: 'relatedUserNameMasked', width: 100 },
    { title: '金额', dataIndex: 'amountFen', width: 100, render: (v: string) => <MoneyText fen={v} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <StatusTag kind="commission" value={v} /> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: Commission) =>
        r.status === commission_status.PENDING ? (
          <PermissionButton perm="marketing:*" size="small" type="link" loading={busy} onClick={() => settleOne(r)}>结算</PermissionButton>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <PageContainer title="社区团长" desc="团长邀请下单分佣 + 邀请奖励；支持单笔结算与一键结算打款">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="佣金结算走微信商户转账；结算动作写 audit_logs，金额以分为单位整数运算。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.entries(DIST_STATUS).map(([value, v]) => ({ value, label: v.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input.Search
          allowClear
          placeholder="姓名 / 社区 / 邀请码"
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
        scroll={{ x: 1300 }}
      />
      <Modal
        title={`佣金流水 · ${commTarget?.name ?? ''}（${commTarget?.communityName ?? ''}）`}
        width={860}
        open={!!commTarget}
        onCancel={() => setCommTarget(null)}
        footer={null}
      >
        <div className="filter-bar">
          <Select
            allowClear
            placeholder="结算状态"
            style={{ width: 140 }}
            options={Object.values(COMMISSION_STATUS).map((s) => ({ value: s.value, label: s.label }))}
            onChange={(v) => commTable.search({ status: v })}
          />
        </div>
        <DataTable
          rowKey="id"
          size="small"
          columns={commColumns}
          dataSource={commTable.list}
          loading={commTable.loading}
          total={commTable.total}
          page={commTable.page}
          pageSize={commTable.pageSize}
          onPageChange={commTable.changePage}
        />
      </Modal>
    </PageContainer>
  );
}
