// ============================================================================
// 客服工作台：派单超时候补工单 / 回访任务 / 挂起订单裁决入口
// 契约 5.5：dispatch-timeout / revisits 登录即可；orders decide 需 order:*
// ============================================================================
import { Alert, Button, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { MoneyText } from '@/components/MoneyText';
import { orderApi, csApi } from '@/api/index';
import type { DispatchTimeoutItem, Order, RevisitItem } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { enumLabel, ORDER_STATUS, REVISIT_STATUS } from '@/shared/enums';

export function CsWorkbenchPage() {
  const navigate = useNavigate();
  const [timeouts, setTimeouts] = useState<DispatchTimeoutItem[]>([]);
  const [revisits, setRevisits] = useState<RevisitItem[]>([]);
  const [suspended, setSuspended] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, r, s] = await Promise.all([
        csApi.dispatchTimeouts({ page: 1, pageSize: 50 }),
        csApi.revisits({ page: 1, pageSize: 50 }),
        orderApi.list({ status: 'SUSPENDED', page: 1, pageSize: 50 }),
      ]);
      setTimeouts(t.list);
      setRevisits(r.list);
      setSuspended(s.list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageContainer title="客服工作台" desc="派单超时无人接单转人工、服务完成后回访、投诉挂起订单裁决">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} action={<Button size="small" onClick={() => void load()}>重试</Button>} />}
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="派单超时阈值取 system_configs.dispatch_timeout_min（默认 30 分钟）；超时后客服人工指派或改约。" />
      <Tabs
        items={[
          {
            key: 'timeout',
            label: `派单超时候补（${timeouts.length}）`,
            children: (
              <DataTable
                rowKey="id"
                loading={loading}
                pagination={false}
                dataSource={timeouts}
                emptyKind="clean"
                emptyText={<>当前无超时订单<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>派单均在 SLA 内</span></>}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo', width: 160 },
                  { title: '老人（脱敏）', dataIndex: 'elderNameMasked', width: 110 },
                  { title: '服务日期', dataIndex: 'serviceDate', width: 110 },
                  { title: '开始时段', dataIndex: 'slotStart', width: 170, render: (v: string) => fmtTime(v, 'HH:mm') },
                  { title: '已等待', dataIndex: 'waitMinutes', width: 100, render: (v: number) => <Tag color="red">{v} 分钟</Tag> },
                  { title: '下单时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
                  {
                    title: '操作',
                    width: 100,
                    render: (_: unknown, r) => (
                      <Button type="link" size="small" onClick={() => navigate(`/orders/${r.id}`)}>处理</Button>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'suspended',
            label: `挂起待裁决（${suspended.length}）`,
            children: (
              <DataTable
                rowKey="id"
                loading={loading}
                pagination={false}
                dataSource={suspended}
                emptyKind="clean"
                emptyText={<>当前无挂起订单<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>没有待裁决的争议</span></>}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo', width: 160 },
                  { title: '老人（脱敏）', dataIndex: 'elderNameMasked', width: 110 },
                  { title: '实付', dataIndex: 'totalAmountFen', width: 100, render: (v: string) => <MoneyText fen={v} /> },
                  { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => <Tag color="red">{ORDER_STATUS[v]?.label ?? v}</Tag> },
                  {
                    title: '操作',
                    width: 100,
                    render: (_: unknown, r) => (
                      <Button type="link" size="small" onClick={() => navigate(`/orders/${r.id}`)}>裁决</Button>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'revisit',
            label: `回访任务（${revisits.length}）`,
            children: (
              <DataTable
                rowKey="id"
                loading={loading}
                pagination={false}
                dataSource={revisits}
                emptyKind="clean"
                emptyText={<>当前无回访任务<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>回访均已完成</span></>}
                columns={[
                  { title: '订单号', dataIndex: 'orderNo', width: 160 },
                  { title: '老人（脱敏）', dataIndex: 'elderNameMasked', width: 110 },
                  { title: '完成时间', dataIndex: 'completedAt', width: 170, render: (v: string) => fmtTime(v) },
                  {
                    title: '回访状态',
                    dataIndex: 'revisitStatus',
                    width: 100,
                    render: (v: string) => <Tag color={REVISIT_STATUS[v]?.color}>{enumLabel(REVISIT_STATUS, v)}</Tag>,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
