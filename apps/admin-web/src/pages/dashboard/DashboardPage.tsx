// ============================================================================
// Dashboard：核心指标卡 + 趋势图 + 近期待办（契约 5.1 GET /admin/dashboard）
// ============================================================================
import { useEffect, useState } from 'react';
import { Button, Card, Col, List, Row, Skeleton, Statistic, Tag } from 'antd';
import {
  AlertOutlined,
  AuditOutlined,
  CommentOutlined,
  DashboardOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@/components/PageContainer';
import { StatCard } from '@/components/StatCard';
import { TrendChart } from '@/components/TrendChart';
import { dashboardApi } from '@/api/dashboard';
import type { DashboardMetrics, DashboardTodo, TrendPoint } from '@/shared/types';
import { fenToYuan } from '@/shared/format';
import { useNavigate } from 'react-router-dom';

export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [todos, setTodos] = useState<DashboardTodo | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([dashboardApi.metrics(), dashboardApi.todos(), dashboardApi.trend(30)])
      .then(([m, t, tr]) => {
        setMetrics(m);
        setTodos(t);
        setTrend(tr);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const todoItems = [
    { key: 'applications', label: '待审核入驻（四审队列）', count: todos?.pendingApplications ?? 0, path: '/companion/applications', icon: <AuditOutlined /> },
    { key: 'withdrawals', label: '待审核提现', count: todos?.pendingWithdrawals ?? 0, path: '/profit/withdrawals', icon: <WalletOutlined /> },
    { key: 'complaints', label: '待处理投诉', count: todos?.pendingComplaints ?? 0, path: '/risk/complaints', icon: <CommentOutlined /> },
    { key: 'reports', label: '待核查举报（飞单）', count: todos?.pendingReports ?? 0, path: '/risk/reports', icon: <AlertOutlined /> },
    { key: 'riskEvents', label: '待处置风控事件', count: todos?.pendingRiskEvents ?? 0, path: '/risk/events', icon: <AlertOutlined /> },
  ];

  return (
    <PageContainer title="数据看板" desc="经营核心指标 · 近 30 日趋势 · 近期待办（数据每 5 分钟聚合）">
      {error && <Card><Tag color="error">看板加载失败：{error}</Tag></Card>}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="GMV（订单实收）"
            icon={<DashboardOutlined />}
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 120 }} /> : fenToYuan(metrics.gmvFen)}
            extra="已排除取消单"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="订单量"
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 80 }} /> : metrics.orderCount}
            extra="全状态累计"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="平台分账收入"
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 110 }} /> : fenToYuan(metrics.profitIncomeFen)}
            extra="抽成（bp 快照）"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="活跃陪聊员"
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 60 }} /> : metrics.activeCompanions}
            extra="状态 ACTIVE"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="核销通过率"
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 80 }} /> : `${metrics.verificationPassRate}%`}
            extra="三关：动态码/人脸/GPS"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={4}>
          <StatCard
            label="待处置风控事件"
            value={loading || !metrics ? <Skeleton.Button active size="small" style={{ width: 60 }} /> : metrics.riskEventCount}
            extra="CRITICAL 优先"
          />
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={16}>
          <Card title="近 30 日趋势（GMV / 平台抽成 / 订单量）" loading={loading} extra={<Tag color="blue">分账冻结额 {metrics ? fenToYuan(metrics.frozenSharingFen) : '-'}</Tag>}>
            <TrendChart data={trend} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="近期待办" loading={loading}>
            <List
              dataSource={todoItems}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="go" type="link" size="small" onClick={() => navigate(item.path)}>
                      去处理
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={item.icon}
                    title={item.label}
                    description={item.count > 0 ? `${item.count} 项待处理` : '已清零'}
                  />
                  {item.count > 0 && <Tag color="warning">{item.count}</Tag>}
                </List.Item>
              )}
            />
            <div style={{ marginTop: 12, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
              <Statistic title="分账冻结总额（待分账）" value={metrics ? fenToYuan(metrics.frozenSharingFen) : '-'} valueStyle={{ fontSize: 16 }} />
            </div>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
}
