// ============================================================================
// 引流漏斗（契约 §13.6 GET /admin/activity/funnel + §13.9 引流触发器与归因）
// ----------------------------------------------------------------------------
// 七层：INSTALL → ACTIVATION → CONSENT_GRANTED → DATA_AVAILABLE
//       → ALERT_RAISED → FIRST_ORDER → REORDER
//
// 这页刻意不做成「通用漏斗图」，因为业务上它有三个特殊点，通用模板会全丢掉：
//   1) 每层对应一个**可落地的运营动作**——运营要的是「这层该做什么」，不是一条曲线；
//   2) CONSENT_GRANTED（双层同意）是**隐私合规核心指标**，掉了是合规风险而非转化问题，
//      绝不能埋在漏斗中间当一格，必须单独高亮；
//   3) 样本不足时显示「数据不足」而非 0%——0%（没人做到）和「样本太少看不出来」
//      在业务上是两件事，混淆会让运营做错决策。
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Progress,
  Radio,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  DollarOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ShoppingOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { PageContainer } from '@/components/PageContainer';
import { StatCard } from '@/components/StatCard';
import { activityApi } from '@/api';
import type {
  ActivityFunnel,
  ActivityFunnelChannel,
  ActivityFunnelStage,
  OfflineTouchpointAttribution,
} from '@/shared/types';
import { fenToYuan } from '@/shared/format';
import { enumLabel, ACTIVITY_TOUCHPOINT_TYPE } from '@/shared/enums';

/**
 * 维度可选项。
 * 前三维是 team-lead 指定的小区/活动类型/时间；第四维 touchpoint 是本轮追加的
 * **线下触点归因**——把 PRD 护城河里的亲邻社区媒体（门禁/单元门/开门 App）显式标注出来，
 * 让运营看到「哪个触点带来了多少安装与下单」。
 *
 * 口径要点（team-lead 已采纳）：线下触点是**渠道维度**，不是第 8 个漏斗层级。
 * 漏斗答「同一个人从安装到复购的转化路径」，触点答「他从哪个入口来」，两者正交。
 */
const DIMENSIONS = [
  { value: 'community', label: '按小区' },
  { value: 'trigger', label: '按活动类型' },
  { value: 'touchpoint', label: '按线下触点' },
  { value: 'date', label: '按时间' },
] as const;

type Dimension = (typeof DIMENSIONS)[number]['value'];

/** 维度中文短名（表格列头与卡片副标题复用） */
const DIM_LABEL: Record<Dimension, string> = {
  community: '小区',
  trigger: '触发器',
  touchpoint: '线下触点',
  date: '日期',
};

const DAY_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

/** 同意层单独标识：合规核心指标，视觉上从漏斗序列里「跳出来」 */
const CONSENT_STAGE = 'CONSENT_GRANTED';

/** 样本不足时的统一呈现（不显示 0%） */
function Insufficient() {
  return (
    <Tooltip title="样本量不足以支撑百分比结论。0% 表示「确实没人做到」，数据不足表示「看不出来」——两者不能混。">
      <Tag color="warning">数据不足</Tag>
    </Tooltip>
  );
}

/** 转化率单元格：样本不足显式提示，不渲染 0% */
function RateCell({ rate, sufficient }: { rate: number; sufficient: boolean }) {
  if (!sufficient) return <Insufficient />;
  const color = rate >= 70 ? '#52c41a' : rate >= 40 ? '#faad14' : '#d4380d';
  return (
    <span style={{ color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{rate.toFixed(1)}%</span>
  );
}

export function FunnelPage() {
  const [dimension, setDimension] = useState<Dimension>('community');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ActivityFunnel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await activityApi.funnel({ dimension, days }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dimension, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = data?.stages ?? [];
  const consentStage = stages.find((s) => s.touchpoint === CONSENT_STAGE);
  const churnStage = stages.find((s) => s.biggestChurn);

  return (
    <PageContainer
      title="引流漏斗"
      desc="装机 → 激活 → 双层同意 → 数据可用 → 告警触达 → 首次下单 → 复购（契约 §13.6 七触点口径）"
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      {/* 筛选区 */}
      <div className="filter-bar">
        <Segmented
          value={dimension}
          onChange={(v) => setDimension(v as typeof dimension)}
          options={DIMENSIONS.map((d) => ({ value: d.value, label: d.label }))}
        />
        <Radio.Group
          value={days}
          onChange={(e) => setDays(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={DAY_OPTIONS}
        />
        <div className="filter-actions">
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            {dimension === 'community' && '小区维度含 7 个试点社区'}
            {dimension === 'trigger' && '活动类型维度按契约 §13.9 三触发器拆分'}
            {dimension === 'touchpoint' && '线下触点维度对应 PRD 亲邻社区媒体（门禁/单元门/开门 App）'}
            {dimension === 'date' && '时间维度按近 7 日逐日展开，最易看出趋势拐点'}
          </span>
        </div>
      </div>

      {/*🔴 归因截断警示（P0）。
          **原筛选项里那句「尾部社区样本偏小」已被删除** —— 它是假数据的最佳托辞：
          服务端 `take: 5000` 的 orderBy 只到 `community_code`，同一份数据两次查询
          可能返回**不同的** 5000 条，所以截断时每个社区的 count 偏小且**不可复现**。
          留着那句话，运营会把真截断读成「小社区本来就人少」，据此做投放决策。

          ⚠️ **当前服务端尚未提供该字段**（`admin.service.ts:418` 无truncated 标记，
          已派霍承钧），所以本分支现在走不到 —— 这是**已知未对齐**，不是恒真无害：
          smoke.mjs 有交叉断言绑住「服务端出参确实提供该字段」，他落盘后断言才能转绿。
          那条断言现在**故意是红的**（主理人裁定：恒真即假绿，必须显式暴露）。 */}
      {data?.attributionTruncated && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message="归因数据不完整，各维度数字不可直接用于投放决策"
          description={
            <Space direction="vertical" size={4}>
              <span>
                服务端归因取数有候选集上限（5000 条触点），当前样本<b>已被截断且不可复现</b>——
                各渠道/社区的 count 偏小，重复查询可能返回不同的数字。
              </span>
              <span style={{ color: 'rgba(0,0,0,0.45)' }}>
                请缩小统计窗口（近 7 日）后重试，或按小区/触点分别下钻核对。
              </span>
            </Space>
          }
        />
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="漏斗数据加载失败"
          description={error}
          action={<Button size="small" onClick={() => void load()}>重试</Button>}
        />
      )}

      {/* 总量卡 */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        {loading && !data ? (
          [0, 1, 2, 3].map((i) => (
            <div className="stat-card" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={{ width: '40%' }} />
            </div>
          ))
        ) : (
          <>
            <StatCard
              label="触达（装机）"
              value={data?.totals.reach ?? 0}
              icon={<TeamOutlined />}
              extra={`近 ${data?.days ?? days} 天 · ${DIM_LABEL[dimension]}维度汇总`}
            />
            <StatCard
              label="完成双层同意"
              value={data?.totals.consentGranted ?? 0}
              icon={<SafetyCertificateOutlined />}
              extra={
                data && data.totals.reach > 0
                  ? `占触达 ${((data.totals.consentGranted / data.totals.reach) * 100).toFixed(1)}%（合规核心指标）`
                  : '—'
              }
            />
            <StatCard
              label="首次下单"
              value={data?.totals.firstOrder ?? 0}
              icon={<ShoppingOutlined />}
              extra={
                data && data.totals.consentGranted > 0
                  ? `同意 → 首单 ${((data.totals.firstOrder / data.totals.consentGranted) * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <StatCard
              label="复购"
              value={data?.totals.reorder ?? 0}
              icon={<DollarOutlined />}
              extra={data?.cacPerOrderFen ? `单均带新成本 ${fenToYuan(data.cacPerOrderFen)}` : '单均带新成本 —'}
            />
          </>
        )}
      </div>

      {/* 同意层单独高亮：合规核心指标，不能埋在漏斗中间 */}
      {consentStage && (
        <Alert
          type={consentStage.dataSufficient ? (consentStage.stepRate < 70 ? 'warning' : 'success') : 'info'}
          showIcon
          icon={<SafetyCertificateOutlined />}
          style={{ marginBottom: 16 }}
          message={
            <Space size={8} wrap>
              <span style={{ fontWeight: 600 }}>双层同意率（合规核心指标）</span>
              <RateCell rate={consentStage.stepRate} sufficient={consentStage.dataSufficient} />
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {consentStage.converted} / 上一层 {stages[stages.indexOf(consentStage) - 1]?.converted ?? 0} 人
              </span>
            </Space>
          }
          description={
            <Space direction="vertical" size={4}>
              <span>{consentStage.action}</span>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                同意率掉了不只是转化损失，更是<b>隐私合规风险</b>——授权是采集的前置门闩（契约 §13.1：未授权直接 22001拒绝采集）。
                刻意做高门槛会掩盖老人的真实意愿，因此该层单列监控，不与普通转化层混看。
              </span>
            </Space>
          }
        />
      )}

      {/* 漏斗主体 */}
      <SectionCard title="七层转化明细" desc="每层给出：转化数 / 相对上层转化率 / 相对首层总转化率 / 流失数，以及该层对应的运营动作">
        {!loading && stages.length === 0 && !error ? (
          <Alert type="info" showIcon message="暂无漏斗数据" description="所选维度与时间窗口内没有触点记录，请放宽筛选条件或等待数据积累（感知数据需 3–7 天）。" />
        ) : (
          <Table<ActivityFunnelStage>
            rowKey="touchpoint"
            size="middle"
            loading={loading ? { spinning: true } : false}
            dataSource={stages}
            pagination={false}
            locale={{ emptyText: loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null }}
            columns={[
              {
                title: '漏斗层',
                dataIndex: 'touchpoint',
                width: 190,
                fixed: 'left',
                render: (v: string, r) => (
                  <Space direction="vertical" size={0}>
                    <Space size={6}>
                      <span style={{ fontWeight: 600 }}>{enumLabel(ACTIVITY_TOUCHPOINT_TYPE, v)}</span>
                      {v === CONSENT_STAGE && (
                        <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>
                          合规核心
                        </Tag>
                      )}
                      {r.biggestChurn && (
                        <Tag color="error" style={{ fontSize: 11, margin: 0 }}>
                          最大流失
                        </Tag>
                      )}
                    </Space>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{v}</span>
                  </Space>
                ),
              },
              {
                title: '转化数',
                dataIndex: 'converted',
                width: 100,
                align: 'right',
                render: (v: number) => <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{v}</span>,
              },
              {
                title: '相对上层转化率',
                dataIndex: 'stepRate',
                width: 140,
                align: 'right',
                render: (v: number, r) => <RateCell rate={v} sufficient={r.dataSufficient} />,
              },
              {
                title: '相对首层总转化率',
                dataIndex: 'overallRate',
                width: 140,
                align: 'right',
                render: (v: number, r) => <RateCell rate={v} sufficient={r.dataSufficient} />,
              },
              {
                title: '流失数',
                dataIndex: 'churned',
                width: 130,
                align: 'right',
                render: (v: number, r) => (
                  <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: v > 0 ? '#d4380d' : 'rgba(0,0,0,0.45)' }}>
                      {v > 0 ? v : '-'}
                    </span>
                    {r.biggestChurn && v > 0 && (
                      <span style={{ fontSize: 11, color: '#d4380d' }}>优先优化</span>
                    )}
                  </Space>
                ),
              },
              {
                title: '总转化进度',
                dataIndex: 'overallRate',
                width: 150,
                render: (v: number, r) =>
                  r.dataSufficient ? (
                    <Progress percent={Number(v.toFixed(0))} size="small" showInfo={false} strokeColor={r.biggestChurn ? '#d4380d' : '#0958d9'} />
                  ) : (
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>—</span>
                  ),
              },
              {
                title: '该层运营动作',
                dataIndex: 'action',
                width: 300,
                render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
              },
            ]}
            rowClassName={(r) => (r.touchpoint === CONSENT_STAGE ? 'row-consent' : r.biggestChurn ? 'row-churn' : '')}
            scroll={{ x: 1200 }}
          />
        )}
      </SectionCard>

      {/* 最大流失环节建议：说清卡在哪、怎么改 */}
      {churnStage && (
        <SectionCard title="最大流失环节与优化建议" desc="按流失绝对量判定（能救回的人最多），不是按相对转化率">
          <Alert
            type="error"
            showIcon
            icon={<AimOutlined />}
            message={
              <Space size={8} wrap>
                <span style={{ fontWeight: 600 }}>
                  瓶颈层：{enumLabel(ACTIVITY_TOUCHPOINT_TYPE, churnStage.touchpoint)}
                </span>
                <span style={{ fontSize: 13 }}>
                  流失 <b style={{ fontVariantNumeric: 'tabular-nums' }}>{churnStage.churned}</b> 人
                  {churnStage.dataSufficient && (
                    <span style={{ color: 'rgba(0,0,0,0.45)' }}>
                      ，相对上层 <RateCell rate={churnStage.stepRate} sufficient={churnStage.dataSufficient} />
                    </span>
                  )}
                </span>
              </Space>
            }
            description={churnStage.advice}
          />
        </SectionCard>
      )}

      {/* 分渠道明细 */}
      <SectionCard
        title="分渠道明细"
        desc="下钻到具体社区 / 触发器 / 日期，看各渠道在哪一层断掉"
      >
        <ChannelTable data={data} loading={loading} stages={stages} dimension={dimension} />
      </SectionCard>

      {/* 线下触点归因（PRD 护城河）：与漏斗正交的渠道维度，独立呈现不占层级 */}
      {data?.offlineTouchpoints && data.offlineTouchpoints.length > 0 && (
        <SectionCard
          title="线下触点归因（亲邻社区媒体）"
          desc="广告门 / 单元门 / 团长地推 / 开门 App —— 回答「哪个触点带来了多少安装与下单」，与上方七层漏斗正交"
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="线下触点是渠道维度，不是漏斗层级"
            description="七层漏斗回答「同一个人从安装到复购的转化路径」；触点回答「他从哪个线下入口来」。两者正交，故独立成表而非叠进漏斗。触点值落 activity_touchpoints.metadata.channel（schema 已留 Json 字段），不进共享枚举。"
          />
          <Table<OfflineTouchpointAttribution>
            rowKey="key"
            size="small"
            loading={loading ? { spinning: true } : false}
            dataSource={data.offlineTouchpoints}
            pagination={false}
            columns={[
              {
                title: '触点',
                dataIndex: 'label',
                width: 150,
                fixed: 'left',
                render: (v: string, r) => (
                  <Space direction="vertical" size={0}>
                    <span style={{ fontWeight: 600 }}>{v}</span>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{r.desc}</span>
                  </Space>
                ),
              },
              {
                title: '触达（装机）',
                dataIndex: 'reach',
                width: 110,
                align: 'right',
                render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{v}</span>,
              },
              {
                title: '完成双层同意',
                dataIndex: 'consent',
                width: 120,
                align: 'right',
                render: (v: number, r) => (
                  <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
                    <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                      {r.reach > 0 && r.dataSufficient ? `${((v / r.reach) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </Space>
                ),
              },
              {
                title: '首次下单',
                dataIndex: 'firstOrder',
                width: 100,
                align: 'right',
                render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>,
              },
              {
                title: '复购',
                dataIndex: 'reorder',
                width: 90,
                align: 'right',
                render: (v: number) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>,
              },
              {
                title: '装机 → 首单',
                dataIndex: 'reachToOrderRate',
                width: 110,
                align: 'right',
                render: (v: number, r) => (r.dataSufficient ? <RateCell rate={v} sufficient /> : <Insufficient />),
              },
              {
                title: '该触点瓶颈与现场动作',
                dataIndex: 'bottleneck',
                render: (b: OfflineTouchpointAttribution['bottleneck']) => (
                  <Space direction="vertical" size={0}>
                    <Space size={6}>
                      <Tag color="warning" style={{ fontSize: 11, margin: 0 }}>
                        {enumLabel(ACTIVITY_TOUCHPOINT_TYPE, b.touchpoint)} 流失 {b.churned}
                      </Tag>
                    </Space>
                    <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)' }}>{b.onsiteAdvice}</span>
                  </Space>
                ),
              },
            ]}
            scroll={{ x: 1100 }}
          />
        </SectionCard>
      )}

      {/* 触发器归因 */}
      {data && data.triggerBreakdown.length > 0 && (
        <SectionCard title="引流触发器归因" desc="契约 §13.9 三触发器：决定「谁在什么时候被触达」，是漏斗上游的原因解释">
          <div className="stat-grid">
            {data.triggerBreakdown.map((t) => (
              <div className="stat-card" key={t.trigger}>
                <div className="stat-label">{t.label}</div>
                <div className="stat-value">{t.count}</div>
                <div className="stat-extra">
                  占触达 {data.totals.reach > 0 ? ((t.count / data.totals.reach) * 100).toFixed(1) : '—'}%
                  <br />
                  依据码 <span style={{ fontFamily: 'monospace' }}>{t.trigger}</span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* 数据来源标注 */}
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16 }}
        message="数据来源与口径"
        description={
          <Descriptions column={1} size="small" style={{ marginTop: 8 }}>
            <Descriptions.Item label="接口路径">
              <code>GET /api/v1/admin/activity/funnel</code>（契约 §13.6）
            </Descriptions.Item>
            <Descriptions.Item label="可见范围">
              当前权限键 <code>risk:read</code> —— <b>风控 / 运营 / 财务可见</b>。
              契约 §13.6 明确 W-MVP 复用风控权限点、不新增 <code>activity:*</code>（新增权限点须同步
              <code>prisma/seed.ts</code> + <code>middlewares/auth.ts</code> + admin-web 三处，W-MVP 扩三处不值）。
              <br />
              W+1 将随订阅营收页拆分为 <code>activity:read</code> / <code>activity:funnel:read</code> /
              <code>activity:alert:handle</code>，届时 <code>revenue:read</code> 保持独立（Q8 账务隔离）。
              <b>需要调整可见范围时，请找主理人（岑执衡）</b>——权限点须三处同步，不能只改后台。
            </Descriptions.Item>
            <Descriptions.Item label="当前数据">
              <b>全部为 mock 数据</b>（<code>src/api/mock/server.ts</code> + <code>src/api/mock/db-activity.ts</code>）。
              切真实后端只需改 <code>src/api/activity.ts</code> 的 <code>activityApi.funnel</code>，页面无需改动。
            </Descriptions.Item>
            <Descriptions.Item label="mock 量级">
              30 日窗口 7 个试点社区、装机 1,860 → 首单 341 → 复购 214；转化曲线按各层真实衰减建模，非均匀等分
            </Descriptions.Item>
            <Descriptions.Item label="待确认">
              ①<code>days</code> 取值范围契约未约束（前端按 7/30/90 归一）；② 分渠道维度字段名（<code>channels[].channelKey</code>）
              契约未列明；③ 单均带新成本为前端按 <code>activity_lead_incentive_newinstall × 发放量÷ 首单数</code> 推导，非服务端字段
            </Descriptions.Item>
            <Descriptions.Item label="口径约束">
              {data?.disclaimer ?? '参考指标，非医疗诊断；漏斗为聚合口径，不含实时轨迹。'}
            </Descriptions.Item>
          </Descriptions>
        }
      />
    </PageContainer>
  );
}

/** 页面内分区卡片（与 HealthBoardPage 的 page-card 视觉一致） */
function SectionCard({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div
      className="page-card"
      style={{ background: '#fff', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0', marginBottom: 16 }}
    >
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {desc && (
          <span style={{ marginLeft: 8, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{desc}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** 分渠道明细表：每行一个渠道，横向看各层转化，定位断点 */
function ChannelTable({
  data,
  loading,
  stages,
  dimension,
}: {
  data: ActivityFunnel | null;
  loading: boolean;
  stages: ActivityFunnelStage[];
  dimension: Dimension;
}) {
  const columns = [
    {
      title: DIM_LABEL[dimension],
      dataIndex: 'channelLabel',
      width: 170,
      fixed: 'left' as const,
      render: (v: string, r: ActivityFunnelChannel) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          {!r.dataSufficient && (
            <Tooltip title="该渠道装机样本不足 30，转化率不可靠">
              <Tag color="warning" style={{ fontSize: 11, margin: 0 }}>
                样本不足
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    ...stages.map((s, i) => ({
      title: enumLabel(ACTIVITY_TOUCHPOINT_TYPE, s.touchpoint),
      dataIndex: `c${i}`,
      width: 92,
      align: 'right' as const,
      render: (_: unknown, r: ActivityFunnelChannel) => {
        const v = r.counts[i] ?? 0;
        const color = ACTIVITY_TOUCHPOINT_HEX[s.touchpoint] ?? '#8c8c8c';
        return (
          <span style={{ fontVariantNumeric: 'tabular-nums', color: v > 0 ? color : 'rgba(0,0,0,0.25)', fontWeight: 500 }}>
            {v}
          </span>
        );
      },
    })),
    {
      title: '首单转化率',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, r: ActivityFunnelChannel) => {
        const base = r.counts[0] ?? 0;
        if (!r.dataSufficient) return <Insufficient />;
        return (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {base > 0 ? ((r.counts[5] ?? 0) / base * 100).toFixed(1) : 0}%
          </span>
        );
      },
    },
  ];

  return (
    <Table<ActivityFunnelChannel>
      rowKey="channelKey"
      size="small"
      loading={loading ? { spinning: true } : false}
      dataSource={data?.channels ?? []}
      pagination={false}
      columns={columns}
      locale={{ emptyText: loading ? <Skeleton active paragraph={{ rows: 4 }} /> : null }}
      scroll={{ x: 1000 }}
    />
  );
}

/** 触点配色：与 ACTIVITY_STATUS_HEX 同一视觉语言（漏斗层用蓝紫渐进，区分于老人状态色） */
const ACTIVITY_TOUCHPOINT_HEX: Record<string, string> = {
  INSTALL: '#0958d9',
  ACTIVATION: '#1677ff',
  CONSENT_GRANTED: '#722ed1',
  DATA_AVAILABLE: '#13c2c2',
  ALERT_RAISED: '#fa8c16',
  FIRST_ORDER: '#389e0d',
  REORDER: '#d4380d',
};