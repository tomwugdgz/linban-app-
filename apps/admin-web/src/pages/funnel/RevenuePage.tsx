// ============================================================================
// 订阅营收（契约 §13.6 GET /admin/activity/revenue，权限 revenue:read）
// ----------------------------------------------------------------------------
// 🔴 **Q8 账务隔离 —— 本页最重要的设计约束**
//   订阅收入是**独立科目**，不进陪聊分账池。
//   本页的数字与「分账流水 / 佣金 / 提现」**不可相加**——
//   分账池的钱是陪聊员可提现的收入，订阅收入是平台自收的订阅费，
//   相加会让财务对账时看到一个不存在的数。
//
//   落地成三条硬规则（主理人裁定「要落成设计约束」）：
//     ① 页面上**不存在**任何「总收入」聚合卡片 —— 一旦有，运营就会去加它；
//     ② `accountingNote` **原样展示**，不前端改写（服务端原文即隔离声明）；
//     ③ 视觉语言与分账页**刻意不同**（蓝色系 / 顶部常驻隔离条），
//        运营扫一眼就知道这是另一个科目。
//
// **摊分口径（承钧 2026-10 定稿）**：累计比例差分法，**不是「整段一次确认」**。
//   年费用户每月都有确认收入（¥490/365≈1.34分/天），不是首月一次性入账 ¥490。
//   所以「本月入账」不会因为来了个年费单就突然跳 49000 分。
//   前端**不做任何摊分推算**，只展示服务端给的 `proratedFen`——
//   自己算就是第二份口径，而两份口径必然漂移。
//
// **本页不提供「按档位排序」**：服务端按 FREE/PRO/INSTITUTIONAL 固定序返回
//   （运营看同比要能对齐行），前端排序会让「本期 vs 上期」的行对不上。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Radio,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  BankOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import dayjs, { type Dayjs } from 'dayjs';
import { PageContainer } from '@/components/PageContainer';
import { StatCard } from '@/components/StatCard';
import { MoneyText } from '@/components/MoneyText';
import { activityApi } from '@/api';
import type {
  ActivityRevenue,
  RevenueDetailRow,
  RevenueExcludeReason,
  RevenueTier,
  RevenueTierRow,
} from '@/shared/types';
import { fenToYuanNumber } from '@/shared/format';
import { REVENUE_DETAIL_LIMIT } from '@/shared/types';

/** 档位中文名（与服务端 schema enum activity_subscription_tier 一致） */
const TIER_LABEL: Record<RevenueTier, string> = {
  FREE: '免费档',
  PRO: '个人付费档',
  INSTITUTIONAL: '机构订阅档',
};

/** 档位色标 class（与 global.css 的 .revenue-tier-dot 对应） */
const TIER_DOT_CLASS: Record<RevenueTier, string> = {
  FREE: 'tier-free',
  PRO: 'tier-pro',
  INSTITUTIONAL: 'tier-institutional',
};

/**
 * 未计入原因的中文文案。
 *
 * 键与服务端 domain/revenue.ts 的 RevenueExcludeReason **逐字一致**。
 * 这里**不得新增或改名** —— 每新增一个原因，就等于报表与在册数之间多一个
 * 无法解释的口子（而「差额可解释」是这页的核心审计要求）。
 */
const REASON_LABEL: Record<RevenueExcludeReason, string> = {
  COUNTED: '已计入',
  STATUS_NOT_CONFIRMABLE: '状态不可确认（未生效 / 已暂停）',
  FREE_TIER_ZERO_PRICE: '免费档（零成本）',
  ZERO_PRICE: '订阅价为 0',
  NO_OVERLAP: '与统计窗口无重叠',
  INVALID_SPAN: '订阅区间非法（结束 ≤ 开始）',
};

/** 状态中文名 */
const STATUS_LABEL: Record<string, string> = {
  PENDING: '待生效',
  ACTIVE: '生效中',
  EXPIRED: '已到期',
  CANCELLED: '已取消',
  SUSPENDED: '已暂停',
};

/** 明细表分页大小（前端展示层分片，与服务端上限无关） */
const DETAIL_PAGE_SIZE = 20;

/**
 * 季度起始日（手算，避开 dayjs 的 quarterOfYear 插件依赖）。
 * 季度月：3、6、9、12 月起（自然季，与财务账期口径一致）。
 */
function quarterStart(d: Dayjs): Dayjs {
  const qStartMonth = Math.floor(d.month() / 3) * 3;
  return d.month(qStartMonth).startOf('month');
}

export function RevenuePage() {
  const [data, setData] = useState<ActivityRevenue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [months, setMonths] = useState<number>(6);
  const [detailPage, setDetailPage] = useState(1);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInst = useRef<echarts.ECharts | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { start?: string; end?: string; months?: number } = { months };
      if (range) {
        params.start = range[0].format('YYYY-MM-DD');
        params.end = range[1].format('YYYY-MM-DD');
      }
      setData(await activityApi.revenue(params));
      setDetailPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [range, months]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- 月度趋势图（单轴柱状：订阅收入是「每月确认多少」，不是 GMV 双轴）----
  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInst.current) chartInst.current = echarts.init(chartRef.current);
    const inst = chartInst.current;
    const onResize = () => inst.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!chartInst.current || !data) return;
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        // ⚠️ series.data 已经是「元」（拼图时已 fenToYuanNumber 除过 100），
        // 这里**不能再用 fenToYuan**（它收「分」，再除一次就差 100 倍）。
        valueFormatter: (v) => `¥${Number(v).toLocaleString('zh-CN')}`,
      },
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: data.trend.map((t) => t.month),
        axisLabel: { color: 'rgba(0,0,0,0.45)' },
      },
      yAxis: {
        type: 'value',
        name: '确认收入（元）',
        nameTextStyle: { color: 'rgba(0,0,0,0.45)' },
        axisLabel: {
          color: 'rgba(0,0,0,0.45)',
          // ECharts 的 value 已是「元」（数据在拼图时已除 100），这里只做展示格式化。
          // 不用 fenToYuan —— 它收「分」，而这里的单位是「元」，再除一次就错了。
          formatter: (v: number) =>
            `¥${Math.round(v).toLocaleString('zh-CN')}`,
        },
        splitLine: { lineStyle: { color: '#f0f0f0' } },
      },
      series: [
        {
          type: 'bar',
          name: '订阅确认收入',
          // 蓝色系：与分账页（红/橙主色）刻意区分，降低「两个科目是一回事」的误读
          itemStyle: { color: '#1677ff' },
          data: data.trend.map((t) => fenToYuanNumber(t.amountFen)),
        },
      ],
    };
    chartInst.current.setOption(option, true);
  }, [data]);

  // 组件卸载时销毁图表实例
  useEffect(
    () => () => {
      chartInst.current?.dispose();
      chartInst.current = null;
    },
    [],
  );

  const tierRows: RevenueTierRow[] = data?.byTier ?? [];

  /**
   * 付费转化率 = 确认的付费笔数 / 付费档在册笔数。
   * 分母为 0 时显示「-」而非 0%——「没有可转化的样本」与「转化率是 0」是两件事。
   */
  const paidConversion = useMemo(() => {
    if (!data) return null;
    const paidTotal = tierRows
      .filter((t) => t.tier !== 'FREE')
      .reduce((s, t) => s + t.totalCount, 0);
    if (paidTotal === 0) return null;
    return (data.summary.paidCount / paidTotal) * 100;
  }, [data, tierRows]);

  const detailColumns = [
    { title: '订阅号', dataIndex: 'subscriptionNo', width: 170 },
    {
      title: '档位',
      dataIndex: 'tier',
      width: 110,
      render: (v: RevenueTier) => (
        <span className="revenue-tier-row">
          <span className={`revenue-tier-dot ${TIER_DOT_CLASS[v]}`} />
          {TIER_LABEL[v] ?? v}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <Tag color={v === 'ACTIVE' ? 'blue' : 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '订阅价',
      dataIndex: 'priceFen',
      width: 100,
      render: (v: string) => <MoneyText fen={v} />,
    },
    {
      title: '本期摊分',
      dataIndex: 'proratedFen',
      width: 110,
      render: (v: string, r: RevenueDetailRow) =>
        r.counted ? <MoneyText fen={v} strong /> : <span style={{ color: 'rgba(0,0,0,0.35)' }}>未计入</span>,
    },
    {
      title: '计入 / 原因',
      dataIndex: 'reason',
      width: 180,
      render: (v: RevenueExcludeReason, r: RevenueDetailRow) =>
        r.counted ? (
          <Tag color="green">计入</Tag>
        ) : (
          <Tooltip title={r.reason}>
            <Tag color="default">{REASON_LABEL[v] ?? v}</Tag>
          </Tooltip>
        ),
    },
    {
      title: '区间 / 重叠',
      dataIndex: 'overlapDays',
      width: 120,
      render: (_: unknown, r: RevenueDetailRow) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {r.totalDays} 天 / {r.overlapDays} 天
        </span>
      ),
    },
  ];

  return (
    <PageContainer
      title="订阅营收"
      desc="家庭订阅收入报表（独立科目）"
      extra={
        <Space>
          <Radio.Group
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
            options={[
              { value: 3, label: '近 3 月' },
              { value: 6, label: '近 6 月' },
              { value: 12, label: '近 12 月' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      {/* ① 科目隔离条：常驻不可关闭。Q8 的第一道视觉防线。 */}
      <div className="revenue-isolation-bar">
        <SafetyCertificateOutlined className="revenue-isolation-icon" />
        <div>
          <strong>独立科目：订阅收入不进陪聊分账池。</strong>
          <span className="revenue-isolation-note">
            本页金额<strong>不可</strong>与「分账流水 / 佣金 / 提现」相加 —— 两套数字分别对账。
          </span>
          {data && (
            <div style={{ marginTop: 4, color: '#0958d9' }}>
              服务端声明：{data.accountingNote}
            </div>
          )}
        </div>
      </div>

      {/* ② 窗口筛选：默认「本自然月」（服务端口径，与财务账期对齐） */}
      <div className="filter-bar">
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
          allowEmpty={[true, true]}
          placeholder={['窗口起（含）', '窗口止（含）']}
          presets={[
            { label: '本自然月', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
            { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            // ⚠️ 季度起点**手算**而非 dayjs().startOf('quarter')：
            // 后者需要 quarterOfYear 插件，而本项目只 extend 了 utc/timezone，
            // 用了会得到 Invalid Date（静默错，不报错）。不引新依赖。
            { label: '本季', value: [quarterStart(dayjs()), dayjs().endOf('month')] },
          ]}
        />
        <Button type="primary" onClick={() => void load()} loading={loading}>
          查询
        </Button>
        <div className="filter-actions">
          {data && (
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              统计窗口 {data.windowStart.slice(0, 10)} ~ {data.windowEnd.slice(0, 10)}（{data.windowDays} 天）
            </span>
          )}
        </div>
      </div>

      {error && (
        <Alert type="error" showIcon message="订阅营收加载失败" description={error} style={{ marginBottom: 16 }} />
      )}

      {loading && !data ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !data ? (
        <Empty description="暂无数据" />
      ) : (
        <>
          {/* ③ 汇总卡：**刻意没有「总收入」卡片**。
              页面上一旦出现「总收入」，运营必然会把它和分账流水相加 —— 那是一个不存在的数。 */}
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <StatCard
              label="本期订阅确认收入"
              value={<MoneyText fen={data.summary.totalAmountFen} strong />}
              extra={`${data.summary.paidCount} 笔付费订阅确认`}
              icon={<BankOutlined style={{ color: '#1677ff' }} />}
            />
            <StatCard
              label="客单价"
              value={
                data.summary.avgPriceFen === null ? (
                  <span style={{ color: 'rgba(0,0,0,0.35)' }}>—</span>
                ) : (
                  <MoneyText fen={data.summary.avgPriceFen} strong />
                )
              }
              extra={
                data.summary.avgPriceFen === null
                  ? '本期无付费用户（**不等于**客单价 0 元）'
                  : '按本期确认收入 / 付费笔数'
              }
            />
            <StatCard
              label="付费档在册"
              value={data.summary.paidCount}
              extra={
                paidConversion === null
                  ? '本期无付费档在册样本'
                  : `确认转化 ${paidConversion.toFixed(1)}%（在册 ${tierRows.filter((t) => t.tier !== 'FREE').reduce((s, t) => s + t.totalCount, 0)} 笔）`
              }
            />
            <StatCard
              label="未计入本期"
              value={data.summary.excludedCount}
              extra="见下方「排除原因」与明细灰底行"
              icon={<InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
            />
          </div>

          {/* ④ 分档结构：固定行序，服务端返回什么顺序就显示什么顺序（不排序） */}
          <Card
            size="small"
            title={
              <Space>
                <span>分档结构</span>
                <Tooltip title="行序固定为 免费档 / 个人付费档 / 机构订阅档，不按金额排序 —— 运营看同比时要能对齐行。">
                  <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                </Tooltip>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Table
              rowKey="tier"
              size="small"
              pagination={false}
              dataSource={tierRows}
              columns={[
                {
                  title: '档位',
                  dataIndex: 'tier',
                  render: (v: RevenueTier) => (
                    <span className="revenue-tier-row">
                      <span className={`revenue-tier-dot ${TIER_DOT_CLASS[v]}`} />
                      {TIER_LABEL[v] ?? v}
                    </span>
                  ),
                },
                {
                  title: '本期确认收入',
                  dataIndex: 'amountFen',
                  width: 140,
                  render: (v: string) => <MoneyText fen={v} strong />,
                },
                { title: '确认笔数', dataIndex: 'countedCount', width: 90 },
                { title: '在册笔数', dataIndex: 'totalCount', width: 90 },
                {
                  title: '未计入',
                  width: 90,
                  render: (_: unknown, r: RevenueTierRow) => r.totalCount - r.countedCount,
                },
              ]}
            />
          </Card>

          {/* ⑤ 月度趋势：单轴柱状（订阅确认收入） */}
          <Card size="small" title="月度确认收入" style={{ marginBottom: 16 }}>
            {data.trend.length === 0 ? (
              <Empty description="暂无趋势数据" />
            ) : (
              <>
                <div ref={chartRef} style={{ height: 260, width: '100%' }} />
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={
                    <span>
                      <strong>摊分口径：累计比例差分，不是「整段一次确认」。</strong>
                      年费订阅每月都在确认收入（≈¥490/365 每天），<strong>不是</strong>首月一次性入账 ¥490 ——
                      所以本月入账数不会因为来了一个年费单而突然跳到 ¥490。
                    </span>
                  }
                />
              </>
            )}
          </Card>

          {/* ⑥ 排除原因分布：报表数与在册数差额可解释（这页的核心审计要求） */}
          {data.excludedReasons.length > 0 && (
            <Card size="small" title="未计入原因分布" style={{ marginBottom: 16 }}>
              <Space wrap>
                {data.excludedReasons.map((r) => (
                  <Tag key={r.reason} color="default">
                    {REASON_LABEL[r.reason] ?? r.reason}：{r.count} 笔
                  </Tag>
                ))}
              </Space>
            </Card>
          )}

          {/* ⑦ 明细：供财务逐笔复核。未计入的行整行灰底，避免被加进汇总。 */}
          <Card
            size="small"
            title={
              <Space>
                <span>订阅明细（逐笔复核）</span>
                <Tag color="blue">{data.details.length} 笔</Tag>{/*
                  🔴 明细上限提示：服务端 `revenue.service.ts:85` 有 DETAIL_LIMIT=500，
                  超限 slice 后**当前并未回 truncated 标记**（已报承钧，契约侧也要补）。
                  在标记补上之前，前端只能自己判「正好 500 条 = 可能被截」——
                  这是**兜底**不是正确做法：真截断时恰好 500 条会被误报，
                  但漏报（截断了却没提示）会让财务以为明细就是全量，故仍须兜。
                */}
                {data.details.length >= REVENUE_DETAIL_LIMIT && (
                  <Tooltip title={`服务端明细上限 ${REVENUE_DETAIL_LIMIT} 条，本表可能未显示全部订阅。汇总卡与分档表不受影响（它们是全量聚合）。`}>
                    <Tag color="orange" icon={<WarningOutlined />}>
                      可能已截断
                    </Tag>
                  </Tooltip>
                )}
              </Space>
            }
            extra={
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled
                title="导出待后端提供导出端点后启用（契约未登记导出端点，不自行发明）"
              >
                导出
              </Button>
            }
          >
            {data.details.length === 0 ? (
              <Empty description="本窗口无订阅记录" />
            ) : (
              <Table
                rowKey="subscriptionNo"
                size="small"
                dataSource={data.details}
                columns={detailColumns}
                rowClassName={(r) => (r.counted ? '' : 'row-not-counted')}
                pagination={{
                  current: detailPage,
                  pageSize: DETAIL_PAGE_SIZE,
                  total: data.details.length,
                  onChange: setDetailPage,
                  showSizeChanger: false,
                }}
                scroll={{ x: 900 }}
              />
            )}
          </Card>
        </>
      )}
    </PageContainer>
  );
}
