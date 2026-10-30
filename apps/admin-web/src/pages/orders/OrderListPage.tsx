// ============================================================================
// 订单列表：多维筛选（状态/关键词/日期/夜间单）；双方信息脱敏展示
// ============================================================================
import { Button, DatePicker, Input, Select, Tag } from 'antd';
import { useState } from 'react';
import type { Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { useTable } from '@/hooks/useTable';
import { orderApi } from '@/api/order';
import type { Order } from '@/shared/types';
import { fmtDuration, fmtTime } from '@/shared/format';
import { ORDER_STATUS, SERVICE_TYPE } from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  nightOrder?: boolean;
}

export function OrderListPage() {
  const table = useTable<Order, Filters>({
    fetcher: (params) => orderApi.list(params),
    initialFilters: {},
  });
  const [dates, setDates] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  const onSearch = () => {
    table.search({
      status: table.filters.status,
      keyword: keyword.trim() || undefined,
      startDate: dates[0]?.format('YYYY-MM-DD'),
      endDate: dates[1]?.format('YYYY-MM-DD'),
      nightOrder: table.filters.nightOrder,
    });
  };

  const columns = [
    { title: '订单号', dataIndex: 'orderNo', width: 160 },
    { title: '状态', dataIndex: 'status', width: 130, render: (v: string) => <StatusTag kind="order" value={v} /> },
    { title: '服务类型', dataIndex: 'serviceType', width: 90, render: (v: string) => SERVICE_TYPE[v]?.label ?? v },
    { title: '时长', dataIndex: 'durationMinutes', width: 80, render: (v: number) => fmtDuration(v) },
    { title: '服务日期', dataIndex: 'serviceDate', width: 110 },
    { title: '老人（脱敏）', dataIndex: 'elderNameMasked', width: 110 },
    { title: '陪聊员（脱敏）', dataIndex: 'companionNameMasked', width: 120 },
    { title: '实付', dataIndex: 'totalAmountFen', width: 100, render: (v: string) => <MoneyText fen={v} strong /> },
    {
      title: '优惠/卡券抵扣',
      width: 130,
      render: (_: unknown, r: Order) => (
        <span style={{ fontSize: 12 }}>
          券 <MoneyText fen={r.couponDeductFen} /> / 卡 <MoneyText fen={r.giftCardDeductFen} />
        </span>
      ),
    },
    {
      title: '夜间单',
      dataIndex: 'nightOrder',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="purple">夜间</Tag> : '-'),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, r: Order) => (
        <Button type="link" size="small" onClick={() => navigate(`/orders/${r.id}`)}>详情</Button>
      ),
    },
  ];

  return (
    <PageContainer title="订单列表" desc="订单 12 态状态机（契约 §8）；双方姓名/手机号/地址均按架构 §10 脱敏展示">
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="订单状态"
          style={{ width: 180 }}
          options={Object.values(ORDER_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v, keyword: keyword.trim() || undefined })}
        />
        <Input
          allowClear
          placeholder="订单号 / 老人姓名 / 手机号"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={onSearch}
        />
        <Select
          allowClear
          placeholder="夜间单"
          style={{ width: 120 }}
          options={[{ value: 'true', label: '仅夜间单' }]}
          value={table.filters.nightOrder ? 'true' : undefined}
          onChange={(v) => table.search({ nightOrder: v === 'true' })}
        />
        <DatePicker.RangePicker
          value={dates}
          onChange={(v) => setDates(v as [Dayjs | null, Dayjs | null])}
          placeholder={['创建起', '创建止']}
        />
        <div className="filter-actions">
          <Button type="primary" onClick={onSearch}>查询</Button>
          <Button onClick={() => { table.reset(); setDates([null, null]); setKeyword(''); }}>重置</Button>
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
    </PageContainer>
  );
}
