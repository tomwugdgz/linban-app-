// ============================================================================
// 健康活动看板（契约 §13.6 GET /admin/activity/dashboard + /elders + /alerts）
// ----------------------------------------------------------------------------
// 三块可下钻：概览卡 → 老人活动列表 → 告警队列。
//
// 隐私红线的页面侧落法（本页最容易出错的地方，务必保持）：
//   1) UNKNOWN 老人**单独视觉分区**并标原因，禁止与正常状态混排成一列普通标签
//      ——运营把「没采到数据」读成「老人没事」是本模块最严重的误判风险；
//   2) 信号超 activity_signal_ttl 一律标「数据过期」，同样不与新鲜数据混排；
//   3) 依据码（explain_code）展示中文释义 + 判定依据，英文码仅作审计回溯副文本；
//   4) 页面全程不出现任何原始特征（SSID/BSSID/MAC/逐分钟序列），只有日聚合。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Space,
  Spin,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import {
  ApiOutlined,
  DisconnectOutlined,
  HeartOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@/components/PageContainer';
import { StatCard } from '@/components/StatCard';
import { Sparkline } from '@/components/Sparkline';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { PermissionButton } from '@/components/PermissionButton';
import { activityApi } from '@/api';
import type { ActivityDashboard, ActivityElderRow, ActivityTrendPoint, HealthAlertRow, PageResult } from '@/shared/types';
import { fmtDuration, fmtRelative, fmtTime } from '@/shared/format';
import {
  activity_status,
  ACTIVITY_EXPLAIN_LABEL,
  ACTIVITY_STATUS_HEX,
  enumLabel,
  health_alert_status,
  HEALTH_ALERT_STATUS,
  HEALTH_ALERT_TYPE,
} from '@/shared/enums';
// ⚠️ 仅在社区端点补齐前作占位：下拉选项取自 mock 常量（`src/api/mock/db-activity`）。
// **页面直接 import mock 数据源模块是本轮核出的反模式**——它不发起任何请求，
// 所以生产环境也会静默显示这 7 条硬编码社区，运营看不出来它是假的；
// 等`GET /admin/activity/communities` 落地后，本行必须改成走接口，否则第 8 个社区永远出不来。
import { ACTIVITY_COMMUNITIES } from '@/api/mock/db-activity';

// ---- 老人列表筛选 ----
/**
 * 🔴 字段名必须与服务端 zod 逐字一致（`activity.routes.ts` elders schema）。
 * 多传的键会被 zod **静默 strip**：请求 200 但筛选不生效，运营无从判断。
 * `stale` 曾被前端自造为 `staleOnly`，导致「数据新鲜度」筛选恒不命中（2026-10 修）。
 *
 * `community` / `keyword` **刻意不在此处**：契约承诺的社区筛选服务端尚未实现，
 * 现在传出去也只是被 strip。控件在服务端补齐前会被禁用并挂 tooltip 说明——
 * **宁可灰着，也不能给「筛选生效了」的错觉**。
 */
interface ElderFilters {
  status?: string;
  stale?: string;
  community?: string;
  keyword?: string;
}

/** 近 7 日活跃趋势（ECharts 走动态 import，与 TrendChart 同构但不在首屏包内） */

export function HealthBoardPage() {
  const [dash, setDash] = useState<ActivityDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [dashError, setDashError] = useState<string | null>(null);

  const loadDash = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      setDash(await activityApi.dashboard());
    } catch (e) {
      setDashError(e instanceof Error ? e.message : '加载失败');
      setDash(null);
    } finally {
      setDashLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDash();
  }, [loadDash]);

  return (
    <PageContainer
      title="健康活动看板"
      desc="老人活动状态感知（Wi-Fi 无感）· 参考指标非医疗诊断 · 数据不出户、不含实时轨迹"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => void loadDash()} loading={dashLoading}>
          刷新
        </Button>
      }
    >
      {dashError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="看板数据加载失败"
          description={dashError}
          action={<Button size="small" onClick={() => void loadDash()}>重试</Button>}
        />
      )}
      <OverviewSection dash={dash} loading={dashLoading && !dashError} />
      {dashLoading && !dash && !dashError && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" tip="加载中…">
            <div style={{ height: 120 }} />
          </Spin>
        </div>
      )}
      {(dash || dashError) && (
        <>
          <TrendSection dash={dash} loading={dashLoading} />
          <ElderSection communities={ACTIVITY_COMMUNITIES} />
          <AlertSection onChanged={loadDash} />
        </>
      )}
    </PageContainer>
  );
}

// ============================================================================
// 一、概览卡
// ============================================================================
function OverviewSection({ dash, loading }: { dash: ActivityDashboard | null; loading: boolean }) {
  if (!dash) {
    // 首屏未就绪：骨架占位，避免卡片区塌陷后布局跳动
    return loading ? (
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <div className="stat-card" key={i}>
            <Skeleton active paragraph={{ rows: 1 }} title={{ width: '40%' }} />
          </div>
        ))}
      </div>
    ) : null;
  }
  const probeTotal = dash.probeOnlineCount + dash.probeOfflineCount + dash.probePendingCount;
  return (
    <>
      {dash.urgentUnhandledCount > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`有 ${dash.urgentUnhandledCount} 条紧急（URGENT）告警尚未处置`}
          description="紧急告警须完成交叉验证后人工确认，等同 P0 处理（与 SOS 同出口）。若交叉验证不通过，系统不会允许对外追责——这是 PRD 隐私红线，请勿绕过。"
        />
      )}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard
          label="在管老人"
          value={dash.managedElderCount}
          icon={<UserOutlined />}
          extra="已授权感知且探针在册"
        />
        <StatCard
          label="探针在线 / 离线"
          value={
            <span>
              <span style={{ color: '#52c41a' }}>{dash.probeOnlineCount}</span>
              <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 16 }}> / </span>
              <span style={{ color: '#8c8c8c' }}>{dash.probeOfflineCount}</span>
            </span>
          }
          icon={<ApiOutlined />}
          extra={`待首次心跳 ${dash.probePendingCount} 台 · 在册 ${probeTotal} 台 · 在线率 ${dash.deviceOnlineRate}%`}
        />
        <StatCard
          label="今日告警（未处置 / 已处置）"
          value={
            <span>
              <span style={{ color: dash.todayAlertUnhandled > 0 ? '#d4380d' : '#52c41a' }}>{dash.todayAlertUnhandled}</span>
              <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 16 }}> / </span>
              <span style={{ color: '#52c41a' }}>{dash.todayAlertHandled}</span>
            </span>
          }
          icon={<WarningOutlined />}
          extra={`其中误报 ${dash.todayAlertDismissed} 条 · 平均首次响应 ${fmtDuration(dash.avgHandleMinutes)}`}
        />
        <StatCard
          label="近 7 日活跃趋势"
          value={
            <span style={{ fontSize: 20 }}>
              {dash.trend.length ? dash.trend[dash.trend.length - 1]!.activeCount : 0}
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', fontWeight: 400 }}> 人活跃</span>
            </span>
          }
          icon={<HeartOutlined />}
          extra={
            dash.trend.length >= 2 ? (
              <TrendDelta trend={dash.trend} />
            ) : (
              '数据积累中（需 3–7 天）'
            )
          }
        />
      </div>
    </>
  );
}

/** 7 日活跃趋势的环比（用颜色表达方向，不用箭头图标避免误读为「越高越好」） */
function TrendDelta({ trend }: { trend: ActivityTrendPoint[] }) {
  const first = trend[0]!.activeCount;
  const last = trend[trend.length - 1]!.activeCount;
  const delta = first > 0 ? Math.round(((last - first) / first) * 100) : 0;
  const color = delta > 0 ? '#52c41a' : delta < 0 ? '#d4380d' : 'rgba(0,0,0,0.45)';
  return (
    <span style={{ color }}>
      较 7 日前 {delta > 0 ? '+' : ''}
      {delta}%
    </span>
  );
}

// ============================================================================
// 二、趋势区：状态构成 + 活跃时段分布
// ============================================================================
function TrendSection({ dash, loading }: { dash: ActivityDashboard | null; loading: boolean }) {
  const [dim, setDim] = useState<'status' | 'slot'>('status');
  return (
    <div className="page-card" style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>活跃趋势</span>
          <span style={{ marginLeft: 8, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
            状态构成用于发现「我们其实不知道」的老人规模；时段分布用于判断派单窗口
          </span>
        </div>
        <Segmented
          size="small"
          value={dim}
          onChange={(v) => setDim(v as 'status' | 'slot')}
          options={[
            { label: '近 7 日状态构成', value: 'status' },
            { label: '24 小时活跃分布', value: 'slot' },
          ]}
        />
      </div>
      {!dash ? (
        <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : dim === 'status' ? (
        <StatusTrendChart data={dash.trend} loading={loading} />
      ) : (
        <SlotChart data={dash.activeSlots} loading={loading} />
      )}
    </div>
  );
}

/**
 * 图表容器 hook：动态 import echarts，仅本页按需加载（不拖慢首屏）。
 * 用 ref 对象直接交给 div，effect 在 DOM commit 后读 ref.current，初始化时机安全。
 */
function useECharts<T>(buildOption: () => T, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let chart: { setOption: (o: T, notMerge?: boolean) => void; resize: () => void; dispose: () => void } | null = null;
    void import('echarts').then((echarts) => {
      if (disposed) return;
      chart = echarts.init(el);
      chart.setOption(buildOption(), true);
    });
    const onResize = () => chart?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      chart?.dispose();
      chart = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function buildTrendOption(data: ActivityTrendPoint[]) {
  const dates = data.map((d) => d.date.slice(5));
  const seriesOf = (name: string, key: keyof ActivityTrendPoint, color: string) => ({
    name,
    type: 'line' as const,
    stack: 'total',
    areaStyle: { opacity: 0.85 },
    smooth: true,
    symbol: 'none',
    itemStyle: { color },
    data: data.map((d) => d[key] as number),
  });
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃', '低活跃', '久静', '外出/离线', '数据不足'], top: 0 },
    grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: 'category' as const, data: dates, axisTick: { alignWithLabel: true } },
    yAxis: { type: 'value' as const, name: '老人数', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' as const } } },
    series: [
      seriesOf('活跃', 'activeCount', '#52c41a'),
      seriesOf('低活跃', 'lowCount', '#faad14'),
      seriesOf('久静', 'stillCount', '#fa541c'),
      seriesOf('外出/离线', 'awayCount', '#bfbfbf'),
      seriesOf('数据不足', 'unknownCount', '#434343'),
    ],
  };
}

function StatusTrendChart({ data, loading }: { data: ActivityTrendPoint[]; loading: boolean }) {
  const ref = useECharts(() => buildTrendOption(data), [data]);
  if (loading) return <div style={{ height: 260 }} />;
  return <div ref={ref} style={{ width: '100%', height: 260 }} />;
}

function SlotChart({ data, loading }: { data: { hour: number; activeElderCount: number }[]; loading: boolean }) {
  const ref = useECharts(
    () => ({
      tooltip: { trigger: 'axis', formatter: '{b}:00 · 在线 {c} 人' },
      grid: { left: 8, right: 8, top: 20, bottom: 8, containLabel: true },
      xAxis: { type: 'category' as const, data: data.map((d) => `${d.hour}时`), axisTick: { interval: 1 } },
      yAxis: { type: 'value' as const, name: '在线老人数', minInterval: 1, splitLine: { lineStyle: { type: 'dashed' as const } } },
      series: [
        {
          type: 'bar' as const,
          data: data.map((d) => d.activeElderCount),
          itemStyle: { color: '#13c2c2', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 18,
        },
      ],
    }),
    [data],
  );
  if (loading) return <div style={{ height: 260 }} />;
  return <div ref={ref} style={{ width: '100%', height: 260 }} />;
}

// ============================================================================
// 三、老人活动列表
// ============================================================================
function ElderSection({ communities }: { communities: string[] }) {
  const [list, setList] = useState<ActivityElderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [filters, setFilters] = useState<ElderFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActivityElderRow | null>(null);

  const load = useCallback(
    async (p: number, s: number, f: ElderFilters) => {
      setLoading(true);
      setError(null);
      try {
        const res: PageResult<ActivityElderRow> = await activityApi.elders({ page: p, pageSize: s, ...f });
        setList(res.list);
        setTotal(res.total);
        setPage(res.page);
        setSize(res.pageSize);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
        setList([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(1, size, filters);
  }, [filters, size, load]);

  const columns = [
    {
      title: '老人（脱敏）',
      dataIndex: 'elderNameMasked',
      width: 140,
      fixed: 'left' as const,
      render: (v: string, r: ActivityElderRow) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          <CommunityCell community={r.community} />
        </Space>
      ),
    },
    {
      title: '最近状态',
      dataIndex: 'status',
      width: 150,
      render: (v: string, r: ActivityElderRow) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Space size={6}>
            <Badge color={ACTIVITY_STATUS_HEX[v] ?? '#8c8c8c'} />
            <span style={{ fontWeight: 500 }}>{statusText(v)}</span>
          </Space>
          <Space size={4}>
            <Tooltip title={`置信度 ${(r.confidence * 100).toFixed(0)}%（单通道上限 60%）`}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>置信 {(r.confidence * 100).toFixed(0)}%</span>
            </Tooltip>
            {r.stale && (
              <Tag color="default" style={{ fontSize: 11, lineHeight: '16px', margin: 0 }}>
                数据过期
              </Tag>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: '判定依据（explain_code）',
      dataIndex: 'explainCode',
      width: 210,
      render: (v: string) => {
        const e = ACTIVITY_EXPLAIN_LABEL[v];
        return (
          <Space direction="vertical" size={0}>
            <span>{e?.label ?? v}</span>
            <Tooltip title={e?.reason ?? '服务端未给出释义'}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', cursor: 'help' }}>{e?.reason ?? v}</span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '最近信号',
      dataIndex: 'lastSignalAt',
      width: 150,
      render: (v: string | undefined, r: ActivityElderRow) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 13 }}>{fmtRelative(v)}</span>
          <span style={{ fontSize: 12, color: r.stale ? '#d4380d' : 'rgba(0,0,0,0.45)' }}>
            {r.stale ? `已超 6h 有效期（${fmtDuration(Math.floor(r.freshnessSec / 60))}前）` : fmtTime(v, 'MM-DD HH:mm')}
          </span>
        </Space>
      ),
    },
    {
      title: '近 7 日活跃（分钟）',
      dataIndex: 'sparkline',
      width: 140,
      render: (v: number[], r: ActivityElderRow) => (
        <Tooltip
          title={
            r.status === activity_status.UNKNOWN
              ? '数据不足，未产出活跃分钟（不做插值估算）'
              : `7 日活跃分钟合计 ${v.reduce((a, b) => a + b, 0)} 分钟`
          }
        >
          <span>
            <Sparkline data={v} color={ACTIVITY_STATUS_HEX[r.status] ?? '#8c8c8c'} />
          </span>
        </Tooltip>
      ),
    },
    {
      title: '探针 / 授权',
      dataIndex: 'deviceStatus',
      width: 150,
      render: (_: string, r: ActivityElderRow) => (
        <Space direction="vertical" size={2}>
          <StatusTag kind="wifiDevice" value={r.deviceStatus} />
          <Space size={4}>
            <StatusTag kind="consentStatus" value={r.consentStatus} />
            <StatusTag kind="consentScope" value={r.consentScopeLevel} />
          </Space>
        </Space>
      ),
    },
    {
      title: '30 日陪聊下单',
      dataIndex: 'orderCount30d',
      width: 100,
      align: 'right' as const,
      render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>,
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right' as const,
      render: (_: unknown, r: ActivityElderRow) => (
        <Button type="link" size="small" onClick={() => setDetail(r)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page-card" style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0', marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>老人活动列表</span>
        <span style={{ marginLeft: 8, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
          共 {total} 位在管老人 · 已按「需介入程度」排序（久静 → 数据不足 → 低活跃 → 活跃 → 外出）
        </span>
      </div>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="「数据不足」不是「正常」"
        description="UNKNOWN 表示探针离线 / 信号过期 / 样本不足，系统按规则不做任何健康推断。这部分老人我们其实不知道，运营不得据此判断老人安全——这是隐私红线，运营看到的就是老人端可见的。"
      />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="活动状态"
          style={{ width: 140 }}
          value={filters.status}
          onChange={(v) => setFilters((p) => ({ ...p, status: v }))}
          options={[
            { value: 'ACTIVE', label: '活跃' },
            { value: 'LOW', label: '低活跃' },
            { value: 'STILL', label: '久静' },
            { value: 'AWAY', label: '外出/离线' },
            { value: 'UNKNOWN', label: '数据不足' },
          ]}
        />
        <Tooltip title="服务端 elders 接口尚未实现 community 筛选入参（zod 会静默丢弃，传了也不生效）。补齐后本控件自动启用。">
          <span style={{ display: 'inline-block' }}>
            <Select
              allowClear
              disabled
              placeholder="所属社区（待服务端支持）"
              style={{ width: 180 }}
              value={filters.community}
              options={communities.map((c) => ({ value: c, label: c }))}
            />
          </span>
        </Tooltip>
        <Select
          allowClear
          placeholder="数据新鲜度"
          style={{ width: 160 }}
          value={filters.stale}
          onChange={(v) => setFilters((p) => ({ ...p, stale: v }))}
          options={[
            { value: 'true', label: '仅看数据不足/过期' },
            { value: 'false', label: '仅看数据新鲜' },
          ]}
        />
        <Tooltip title="keyword 筛选契约未承诺、服务端未实现（传了也会被静默丢弃）。已报服务端，待裁定后二选一：实现 or 删控件。">
          <span style={{ display: 'inline-block' }}>
            <Input.Search
              allowClear
              disabled
              placeholder="老人昵称 / 社区（待服务端支持）"
              style={{ width: 200 }}
              onSearch={() => undefined}
            />
          </span>
        </Tooltip>
        <div className="filter-actions">
          <Button onClick={() => setFilters({})} icon={<ReloadOutlined />}>
            重置
          </Button>
        </div>
      </div>
      <DataTable<ActivityElderRow>
        emptyKind="filtered"
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        error={error}
        onRetry={() => void load(page, size, filters)}
        total={total}
        page={page}
        pageSize={size}
        onPageChange={(p, s) => {
          setSize(s);
          void load(p, s, filters);
        }}
        scroll={{ x: 1400 }}
        rowClassName={(r) => (r.status === activity_status.UNKNOWN || r.stale ? 'row-unknown' : '')}
      />
      <Drawer title={`老人活动详情 ${detail?.elderNameMasked ?? ''}`} width={560} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <Alert
              type={detail.status === activity_status.STILL ? 'warning' : detail.status === activity_status.UNKNOWN ? 'info' : 'success'}
              showIcon
              style={{ marginBottom: 16 }}
              message={statusText(detail.status)}
              description={
                detail.status === activity_status.UNKNOWN
                  ? detail.unknownReason
                  : `${ACTIVITY_EXPLAIN_LABEL[detail.explainCode]?.label ?? detail.explainCode}：${ACTIVITY_EXPLAIN_LABEL[detail.explainCode]?.reason ?? '-'}`
              }
            />
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="老人（脱敏）">{detail.elderNameMasked}</Descriptions.Item>
              <Descriptions.Item label="所属社区">
                {detail.community ?? <span style={{ color: 'rgba(0,0,0,0.25)' }}>未关联社区</span>}
              </Descriptions.Item>
              <Descriptions.Item label="活动状态">
                <Space>
                  <Badge color={ACTIVITY_STATUS_HEX[detail.status] ?? '#8c8c8c'} />
                  <span>{statusText(detail.status)}</span>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="置信度">
                <Space size={8}>
                  <Progress percent={Math.round(detail.confidence * 100)} size="small" style={{ width: 120 }} />
                  <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                    单通道上限 60%（PRD 红线：单通道不得直接下健康结论）
                  </span>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="依据码（审计）">{detail.explainCode}</Descriptions.Item>
              <Descriptions.Item label="判定依据">{ACTIVITY_EXPLAIN_LABEL[detail.explainCode]?.reason ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="最近信号时间">{fmtTime(detail.lastSignalAt)}</Descriptions.Item>
              <Descriptions.Item label="数据新鲜度">
                {fmtDuration(Math.floor(detail.freshnessSec / 60))}前
                {detail.stale && (
                  <Tag color="error" style={{ marginLeft: 8 }}>
                    已过期（超 activity_signal_ttl 6h）
                  </Tag>
                )}
              </Descriptions.Item>
              {detail.unknownReason && <Descriptions.Item label="数据不足原因">{detail.unknownReason}</Descriptions.Item>}
              <Descriptions.Item label="探针状态">
                <StatusTag kind="wifiDevice" value={detail.deviceStatus} />
              </Descriptions.Item>
              <Descriptions.Item label="本人授权">
                <StatusTag kind="consentStatus" value={detail.consentStatus} />
              </Descriptions.Item>
              <Descriptions.Item label="子女可见范围">
                <StatusTag kind="consentScope" value={detail.consentScopeLevel} />
              </Descriptions.Item>
              <Descriptions.Item label="近 7 日活跃分钟">
                <Space direction="vertical" size={4}>
                  <Sparkline data={detail.sparkline} width={260} height={40} color={ACTIVITY_STATUS_HEX[detail.status]} />
                  <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                    {detail.status === activity_status.UNKNOWN
                      ? '数据不足，未产出活跃分钟'
                      : detail.sparkline.join(' / ') + ' 分钟'}
                  </span>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="30 日陪聊下单">{detail.orderCount30d} 单</Descriptions.Item>
            </Descriptions>
            <Alert
              style={{ marginTop: 16 }}
              type="info"
              showIcon
              icon={<InfoCircleOutlined />}
              message="本页不展示任何原始特征"
              description="SSID / BSSID / MAC 仅以 HMAC 形式落库且无对外读端点，无摄像头、无麦克风、无实时轨迹回放（契约 §13.1 红线①②③⑦）。"
            />
          </>
        )}
      </Drawer>
    </div>
  );
}

function statusText(v: string): string {
  return (
    { ACTIVE: '活跃', LOW: '低活跃', STILL: '久静', AWAY: '外出/离线', UNKNOWN: '数据不足' }[v] ?? v
  );
}

/**
 * 社区单元格（A7 社区字段）。
 *
 * 关键语义区分（两者都是「拿不到信息」但性质完全不同，不能混为一谈）：
 *   · community === null → **档案未关联社区**。这是正常业务态——老人档案确实可能没填社区，
 *     后端读`elder_profiles.community_id` JOIN `communities` 拿不到就是 null。
 *     故用中性灰 + 常规提示，**不用红色/告警色**，否则运营会以为数据出错去排查；
 *   · status === UNKNOWN → **信号不可判读**（探针离线/信号过期/样本不足）。
 *     这个由 row-unknown 底色 + 独立分区承载，与社区字段无关。
 *
 * 一句话：null 是「档案没填」，UNKNOWN 是「判读不出」。前者不该触发后者那套视觉。
 */
function CommunityCell({ community }: { community: string | null }) {
  if (!community) {
    return (
      <Tooltip title="老人档案未关联社区（A7：社区字段取自 elder_profiles.community_id）。这是正常业务态，不影响活动状态判读。">
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.25)' }}>未关联社区</span>
      </Tooltip>
    );
  }
  return <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{community}</span>;
}

// ============================================================================
// 四、告警队列（处置调 24xxx 接口）
// ============================================================================
function AlertSection({ onChanged }: { onChanged: () => void }) {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [list, setList] = useState<HealthAlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [filters, setFilters] = useState<{ status?: string; level?: string; type?: string; keyword?: string }>({ status: 'OPEN' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HealthAlertRow | null>(null);
  const [ackTarget, setAckTarget] = useState<HealthAlertRow | null>(null);
  const [resolveTarget, setResolveTarget] = useState<HealthAlertRow | null>(null);
  const [escalateTarget, setEscalateTarget] = useState<HealthAlertRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolveResult, setResolveResult] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED');
  const [note, setNote] = useState('');
  const [crossConfirmed, setCrossConfirmed] = useState(false);

  const load = useCallback(async (p: number, s: number, f: typeof filters) => {
    setLoading(true);
    setError(null);
    try {
      const res: PageResult<HealthAlertRow> = await activityApi.alerts({ page: p, pageSize: s, ...f });
      setList(res.list);
      setTotal(res.total);
      setPage(res.page);
      setSize(res.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, size, filters);
  }, [filters, size, load]);

  // 切 tab 时同步筛选：待处置 = OPEN（人工尚未确认的队列）
  const switchTab = (v: 'pending' | 'all') => {
    setTab(v);
    setPage(1);
    setFilters(v === 'pending' ? { status: 'OPEN' } : {});
  };

  const doAck = async () => {
    if (!ackTarget) return;
    setBusy(true);
    try {
      await activityApi.ack(ackTarget.id, note.trim() || undefined);
      Modal.success({ content: '已确认知晓，告警转入处置流程' });
      setAckTarget(null);
      setNote('');
      void load(page, size, filters);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const doResolve = async () => {
    if (!resolveTarget) return;
    setBusy(true);
    try {
      await activityApi.resolve(resolveTarget.id, { result: resolveResult, note: note.trim() || undefined });
      Modal.success({ content: resolveResult === health_alert_status.DISMISSED ? '已标记为误报，将纳入阈值调优统计' : '告警已处置闭环' });
      setResolveTarget(null);
      setNote('');
      void load(page, size, filters);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const doEscalate = async () => {
    if (!escalateTarget) return;
    setBusy(true);
    try {
      const res = await activityApi.escalate(escalateTarget.id, { note: note.trim(), crossVerifyConfirmed: crossConfirmed });
      Modal.success({ content: `已升级并落工单 ${res.complaintNo ?? ''}，走 SOS 出口通知紧急联系人` });
      setEscalateTarget(null);
      setNote('');
      setCrossConfirmed(false);
      void load(page, size, filters);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      title: '告警号',
      dataIndex: 'alertNo',
      width: 120,
      render: (v: string, r: HealthAlertRow) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          <CommunityCell community={r.community} />
        </Space>
      ),
    },
    {
      title: '老人（脱敏）',
      dataIndex: 'elderNameMasked',
      width: 130,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '级别',
      dataIndex: 'level',
      width: 80,
      render: (v: string) => <StatusTag kind="alertLevel" value={v} />,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (v: string) => <span>{enumLabel(HEALTH_ALERT_TYPE, v)}</span>,
    },
    {
      title: '判定依据（中文释义）',
      dataIndex: 'explainCode',
      width: 230,
      render: (v: string, r: HealthAlertRow) => {
        const e = ACTIVITY_EXPLAIN_LABEL[v];
        return (
          <Space direction="vertical" size={0}>
            <Space size={6}>
              <span style={{ fontWeight: 500 }}>{e?.label ?? v}</span>
              {/* 静默时长是久静告警的第一依据，直接跟在释义后面，运营不必开抽屉 */}
              {r.stillMinutes !== undefined && (
                <Tag color="orange" style={{ fontSize: 11, margin: 0 }}>
                  静默 {fmtDuration(r.stillMinutes)}
                </Tag>
              )}
              <Tooltip title={`审计码：${v}`}>
                <Tag style={{ fontSize: 11, margin: 0 }}>{v}</Tag>
              </Tooltip>
            </Space>
            <Tooltip title={e?.reason ?? '-'}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', cursor: 'help' }}>{e?.reason ?? '-'}</span>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '交叉验证',
      dataIndex: 'crossVerifySatisfied',
      width: 110,
      render: (v: boolean) =>
        v ? (
          <Tag color="success">已通过</Tag>
        ) : (
          <Tooltip title="单通道数据不得直接下结论（PRD 红线①）；升级对外追责将被拒绝（24004）">
            <Tag color="warning">不足</Tag>
          </Tooltip>
        ),
    },
    {
      title: '触发时状态',
      dataIndex: 'triggeredStatus',
      width: 100,
      render: (v: string) => (
        <Space size={6}>
          <Badge color={ACTIVITY_STATUS_HEX[v] ?? '#8c8c8c'} />
          <span style={{ fontSize: 13 }}>{statusText(v)}</span>
        </Space>
      ),
    },
    {
      title: '触发时间',
      dataIndex: 'triggeredAt',
      width: 150,
      render: (v: string) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 13 }}>{fmtRelative(v)}</span>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{fmtTime(v, 'MM-DD HH:mm')}</span>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <StatusTag kind="alertStatus" value={v} />,
    },
    {
      title: '操作',
      width: 190,
      fixed: 'right' as const,
      render: (_: unknown, r: HealthAlertRow) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setDetail(r)}>
            详情
          </Button>
          {r.status === health_alert_status.OPEN && (
            <PermissionButton perm="risk:*" type="link" size="small" onClick={() => { setAckTarget(r); setNote(''); }}>
              确认
            </PermissionButton>
          )}
          {[health_alert_status.OPEN, health_alert_status.ACKNOWLEDGED, health_alert_status.PROCESSING].some((s) => s === r.status) && (
            <PermissionButton perm="risk:*" type="link" size="small" onClick={() => { setResolveTarget(r); setResolveResult('RESOLVED'); setNote(''); }}>
              处置
            </PermissionButton>
          )}
          {[health_alert_status.OPEN, health_alert_status.ACKNOWLEDGED, health_alert_status.PROCESSING].some((s) => s === r.status) && (
            <PermissionButton perm="risk:*" type="link" size="small" danger onClick={() => { setEscalateTarget(r); setNote(''); setCrossConfirmed(false); }}>
              升级
            </PermissionButton>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-card" style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0' }}>
      <Tabs
        activeKey={tab}
        onChange={(k) => switchTab(k as 'pending' | 'all')}
        items={[
          { key: 'pending', label: '待处置告警' },
          { key: 'all', label: '全部告警' },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="告警状态自闭环"
        description="OPEN → ACKNOWLEDGED → PROCESSING → RESOLVED / DISMISSED（误报）/ ESCALATED。仅升级（escalate）才落投诉工单（complaint_no），复用 SOS 出口通知紧急联系人；误报必须填原因，用于阈值调优统计。"
      />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="处置状态"
          style={{ width: 130 }}
          value={filters.status}
          onChange={(v) => setFilters((p) => ({ ...p, status: v }))}
          options={Object.values(HEALTH_ALERT_STATUS).map((s) => ({ value: s.value, label: s.label }))}
        />
        <Select
          allowClear
          placeholder="级别"
          style={{ width: 110 }}
          value={filters.level}
          onChange={(v) => setFilters((p) => ({ ...p, level: v }))}
          options={[
            { value: 'URGENT', label: '紧急' },
            { value: 'WARN', label: '预警' },
            { value: 'REMIND', label: '提醒' },
          ]}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 160 }}
          value={filters.type}
          onChange={(v) => setFilters((p) => ({ ...p, type: v }))}
          options={Object.values(HEALTH_ALERT_TYPE).map((s) => ({ value: s.value, label: s.label }))}
        />
        <Input.Search
          allowClear
          placeholder="告警号 / 老人 / 社区"
          style={{ width: 220 }}
          onSearch={(v) => setFilters((p) => ({ ...p, keyword: v }))}
        />
      </div>
      <DataTable<HealthAlertRow>
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        error={error}
        onRetry={() => void load(page, size, filters)}
        total={total}
        page={page}
        pageSize={size}
        onPageChange={(p, s) => {
          setSize(s);
          void load(p, s, filters);
        }}
        scroll={{ x: 1600 }}
      />

      {/* 详情抽屉 */}
      <Drawer title={`健康告警 ${detail?.alertNo ?? ''}`} width={560} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="级别"><StatusTag kind="alertLevel" value={detail.level} /></Descriptions.Item>
              <Descriptions.Item label="类型">{enumLabel(HEALTH_ALERT_TYPE, detail.type)}</Descriptions.Item>
              <Descriptions.Item label="老人（脱敏）">
                {detail.elderNameMasked}
                {' · '}
                {detail.community ?? <span style={{ color: 'rgba(0,0,0,0.25)' }}>未关联社区</span>}
              </Descriptions.Item>
              <Descriptions.Item label="触发时活动状态">
                <Space>
                  <Badge color={ACTIVITY_STATUS_HEX[detail.triggeredStatus] ?? '#8c8c8c'} />
                  <span>{statusText(detail.triggeredStatus)}</span>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="置信度">{(detail.confidence * 100).toFixed(0)}%</Descriptions.Item>
              <Descriptions.Item label="依据码">{detail.explainCode}</Descriptions.Item>
              <Descriptions.Item label="判定依据">{ACTIVITY_EXPLAIN_LABEL[detail.explainCode]?.reason ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="交叉验证">
                {detail.crossVerifySatisfied ? (
                  <Tag color="success">已通过（双通道）</Tag>
                ) : (
                  <Tag color="warning">不足（单通道，不得下结论）</Tag>
                )}
              </Descriptions.Item>
              {detail.stillMinutes && <Descriptions.Item label="连续静默">{fmtDuration(detail.stillMinutes)}</Descriptions.Item>}
              <Descriptions.Item label="触发时间">{fmtTime(detail.triggeredAt)}</Descriptions.Item>
              <Descriptions.Item label="状态"><StatusTag kind="alertStatus" value={detail.status} /></Descriptions.Item>
              <Descriptions.Item label="首次确认">{detail.ackBy ? `${detail.ackBy} · ${fmtTime(detail.ackAt)}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="处置人">{detail.resolvedBy ? `${detail.resolvedBy} · ${fmtTime(detail.resolvedAt)}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="处置结论">{detail.resolveNote ?? '-'}</Descriptions.Item>
              {detail.complaintNo && <Descriptions.Item label="关联工单">{detail.complaintNo}</Descriptions.Item>}
              {detail.orderNo && <Descriptions.Item label="关联订单">{detail.orderNo}</Descriptions.Item>}
            </Descriptions>
            <Alert
              style={{ marginTop: 16 }}
              type="warning"
              showIcon
              icon={<DisconnectOutlined />}
              message="误报不是失败，是阈值调优的输入"
              description="标记误报必须写原因：老人外出、探针断网、阈值过敏感都对应不同的优化动作（activity_still_alert_min / activity_alert_suppress_min 可在系统配置页热调）。"
            />
          </>
        )}
      </Drawer>

      {/* 确认已知晓 */}
      <Modal
        title={`确认告警 ${ackTarget?.alertNo ?? ''}`}
        open={!!ackTarget}
        onOk={doAck}
        onCancel={() => setAckTarget(null)}
        confirmLoading={busy}
        okText="确认知晓"
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="确认仅代表「已知晓并开始处理」，不代表老人安全；结论请在处置中落。" />
        <Form layout="vertical">
          <Form.Item label="备注（可选）">
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：已电话联系子女，子女将上门查看" maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* 处置闭环 */}
      <Modal
        title={`处置告警 ${resolveTarget?.alertNo ?? ''}`}
        open={!!resolveTarget}
        onOk={doResolve}
        onCancel={() => setResolveTarget(null)}
        confirmLoading={busy}
        okText="提交处置"
      >
        <Form layout="vertical">
          <Form.Item label="处置结论">
            <Select
              value={resolveResult}
              onChange={setResolveResult}
              options={[
                { value: 'RESOLVED', label: '已处置（已核实老人平安 / 问题已解决）' },
                { value: 'DISMISSED', label: '误报（用于阈值调优统计，必须填原因）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="处置说明"
            required={resolveResult === health_alert_status.DISMISSED}
            extra={resolveResult === health_alert_status.DISMISSED ? '误报必填：外出/断网/阈值敏感等原因将对应不同的阈值优化动作' : undefined}
          >
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：已电话联系家属确认老人平安，探针已重新联网" maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* 升级对外追责 */}
      <Modal
        title={`升级告警 ${escalateTarget?.alertNo ?? ''}`}
        open={!!escalateTarget}
        onOk={doEscalate}
        onCancel={() => setEscalateTarget(null)}
        confirmLoading={busy}
        okText="确认升级"
        okButtonProps={{ danger: true }}
      >
        {escalateTarget && !escalateTarget.crossVerifySatisfied && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="交叉验证不足，无法升级"
            description="当前仅有单通道数据，按 PRD 隐私红线不得对外下健康结论。系统会拒绝本次升级（24004）。请等待第二通道数据，或改走线下人工核实 + 社区网格员路径。"
          />
        )}
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="升级后果"
          description="升级将落投诉工单（complaint_no 记系统服务账号）并复用 SOS 出口：紧急联系人短信 + 绑定子女 IM + 到岗态订单走 suspendOrderForSafety 挂起。全程写 audit_logs 留痕（Q11）。"
        />
        <Form layout="vertical">
          <Form.Item label="人工核实结论" required>
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：已联系紧急联系人核实，老人确为久卧，随即上门" maxLength={300} showCount />
          </Form.Item>
          <Form.Item>
            <Space align="start">
              <input type="checkbox" checked={crossConfirmed} onChange={(e) => setCrossConfirmed(e.target.checked)} />
              <span>我已完成人工交叉核实（电话/上门/家属确认），确认可以对外追责</span>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}