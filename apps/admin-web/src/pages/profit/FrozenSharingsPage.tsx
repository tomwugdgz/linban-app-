// ============================================================================
// 冻结分账：待分账/重试中列表 + 手动结算（兜底）+ 僵死清理
// 契约红线：manual-settle 仅在 manual_settlement_fallback 或微信通道故障时使用，
//           操作写 audit_logs（before/after）。
// ============================================================================
import { Alert, Input, Modal, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { profitApi } from '@/api/profit';
import type { ProfitSharingRecord } from '@/shared/types';
import { fmtTime, bpToPercent } from '@/shared/format';

interface Filters {
  keyword?: string;
}

export function FrozenSharingsPage() {
  const table = useTable<ProfitSharingRecord, Filters>({
    fetcher: (params) => profitApi.frozenList(params),
    initialFilters: {},
  });
  const [splitMode, setSplitMode] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // 分账模式决定手动结算是否合规（契约红线）
  useEffect(() => {
    profitApi.splitMode().then(setSplitMode).catch(() => setSplitMode('unknown'));
  }, []);

  const manualSettle = async (r: ProfitSharingRecord) => {
    setBusy(true);
    try {
      await profitApi.manualSettle(r.sharingNo);
      Modal.success({ content: `分账单 ${r.sharingNo} 已手动结算，操作已留审计` });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const sweepStale = async () => {
    setBusy(true);
    try {
      const res = await profitApi.sweepStale();
      Modal.success({ content: `已清理僵死分账 ${res.sweptCount} 笔，合计 ${Number(res.sweptAmountFen) / 100} 元` });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '分账单号', dataIndex: 'sharingNo', width: 190 },
    { title: '订单号', dataIndex: 'orderNo', width: 150 },
    { title: '陪聊员', dataIndex: 'companionName', width: 90 },
    { title: '冻结金额', dataIndex: 'frozenAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
    { title: '平台抽成', dataIndex: 'platformCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} strong /> },
    { title: '抽成比例', dataIndex: 'commissionRateBp', width: 90, render: (v: number) => bpToPercent(v) },
    {
      title: '重试',
      dataIndex: 'retryCount',
      width: 90,
      render: (v: number) => (v >= 3 ? <Tag color="red">{v}（超限）</Tag> : v),
    },
    { title: '最近错误', dataIndex: 'lastError', ellipsis: true, render: (v?: string) => v ?? '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 110,
      fixed: 'right' as const,
      render: (_: unknown, r: ProfitSharingRecord) => (
        <PermissionButton
          perm="payment:*"
          size="small"
          disabled={r.retryCount >= 3}
          onClick={() => manualSettle(r)}
        >
          手动结算
        </PermissionButton>
      ),
    },
  ];

  return (
    <PageContainer
      title="冻结分账"
      desc="订单完成且核销通过后进入冻结，T+1 自动分账；失败重试 <3 次，超限转人工"
      extra={
        <PermissionButton perm="payment:*" loading={busy} onClick={sweepStale}>
          清理僵死分账（&gt;7 天）
        </PermissionButton>
      }
    >
      <Alert
        style={{ marginBottom: 16 }}
        type={splitMode === 'wechat_profit_sharing' ? 'info' : 'warning'}
        showIcon
        message={
          splitMode === 'wechat_profit_sharing'
            ? '当前分账模式：微信分账（wechat_profit_sharing）'
            : splitMode === 'manual_settlement_fallback'
              ? '当前分账模式：人工结算兜底（manual_settlement_fallback）——请谨慎操作并留存工单'
              : '分账模式加载中…'
        }
      />
      <div className="filter-bar">
        <Input.Search
          allowClear
          placeholder="订单号 / 分账单号 / 陪聊员"
          style={{ width: 280 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
      </div>
      <DataTable
        emptyKind="clean"
        emptyText={<>当前无冻结分账单<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>系统运行正常</span></>}
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
    </PageContainer>
  );
}
