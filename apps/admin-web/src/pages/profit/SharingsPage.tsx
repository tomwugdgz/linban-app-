// ============================================================================
// 分账流水：筛选（状态/关键词/日期区间）+ 导出 + 明细
// ============================================================================
import { Button, DatePicker, Descriptions, Drawer, Input, Select } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { profitApi } from '@/api/profit';
import type { ProfitSharingRecord } from '@/shared/types';
import { fmtTime, bpToPercent } from '@/shared/format';
import { PROFIT_SHARING_STATUS } from '@/shared/enums';
import type { Dayjs } from 'dayjs';

interface Filters {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

export function SharingsPage() {
  const table = useTable<ProfitSharingRecord, Filters>({
    fetcher: (params) => profitApi.list(params),
    initialFilters: {},
  });
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [detail, setDetail] = useState<ProfitSharingRecord | null>(null);

  const onSearch = () => {
    table.search({
      status: table.filters.status,
      keyword: (document.getElementById('sharing-kw') as HTMLInputElement | null)?.value?.trim() || undefined,
      startDate: dates[0]?.format('YYYY-MM-DD'),
      endDate: dates[1]?.format('YYYY-MM-DD'),
    });
  };

  const columns = [
    { title: '分账单号', dataIndex: 'sharingNo', width: 190 },
    { title: '订单号', dataIndex: 'orderNo', width: 150 },
    { title: '陪聊员', dataIndex: 'companionName', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (v: string) => <StatusTag kind="sharing" value={v} />,
    },
    { title: '冻结金额', dataIndex: 'frozenAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '平台抽成', dataIndex: 'platformCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} strong /> },
    { title: '陪聊员应收', dataIndex: 'companionIncomeFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '抽成比例', dataIndex: 'commissionRateBp', width: 90, render: (v: number) => bpToPercent(v) },
    { title: '微信交易单号', dataIndex: 'wxTransactionId', width: 200, ellipsis: true },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, r: ProfitSharingRecord) => (
        <Button type="link" size="small" onClick={() => setDetail(r)}>明细</Button>
      ),
    },
  ];

  return (
    <PageContainer
      title="分账流水"
      desc="自动分账全量流水（冻结 → 已分账 → 已回退）；金额单位为元，库内以分存储"
      extra={
        <PermissionButton perm="payment:*" onClick={() => void profitApi.export(table.filters as Record<string, unknown>)}>
          导出 CSV
        </PermissionButton>
      }
    >
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="分账状态"
          style={{ width: 160 }}
          options={Object.values(PROFIT_SHARING_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input id="sharing-kw" allowClear placeholder="订单号 / 分账单号 / 陪聊员" style={{ width: 240 }} onPressEnter={onSearch} />
        <DatePicker.RangePicker
          value={dates}
          onChange={(v) => setDates(v as [Dayjs | null, Dayjs | null])}
          placeholder={['开始日期', '结束日期']}
        />
        <div className="filter-actions">
          <Button type="primary" onClick={onSearch}>查询</Button>
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
        scroll={{ x: 1500 }}
      />
      <Drawer
        title={`分账明细 ${detail?.sharingNo ?? ''}`}
        width={560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="关联订单">{detail.orderNo}</Descriptions.Item>
            <Descriptions.Item label="状态"><StatusTag kind="sharing" value={detail.status} /></Descriptions.Item>
            <Descriptions.Item label="冻结金额"><MoneyText fen={detail.frozenAmountFen} /></Descriptions.Item>
            <Descriptions.Item label="平台抽成"><MoneyText fen={detail.platformCommissionFen} /></Descriptions.Item>
            <Descriptions.Item label="陪聊员应收"><MoneyText fen={detail.companionIncomeFen} /></Descriptions.Item>
            <Descriptions.Item label="抽成比例">{bpToPercent(detail.commissionRateBp)}（{detail.commissionRateBp} bp）</Descriptions.Item>
            <Descriptions.Item label="微信分账单号">{detail.wxSharingOrderNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="分账时间">{fmtTime(detail.sharedAt)}</Descriptions.Item>
            <Descriptions.Item label="回退金额"><MoneyText fen={detail.returnAmountFen} /></Descriptions.Item>
            <Descriptions.Item label="回退原因">{detail.returnReason ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="重试次数">{detail.retryCount} 次{detail.lastError ? `（最近错误：${detail.lastError}）` : ''}</Descriptions.Item>
            <Descriptions.Item label="人工工单号">{detail.manualTicketNo ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{fmtTime(detail.createdAt)}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </PageContainer>
  );
}
