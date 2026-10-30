// ============================================================================
// 配置变更历史页（契约 §5.7.7；落 audit_logs 过滤视图，不新建表）
// ----------------------------------------------------------------------------
// 为什么这页必须有：配置项能在后台热改（PUT /admin/configs/:key），但没有留痕就
// 无法回答「谁在什么时候把抽成从 5% 改成 8%」——财务对账与合规审计都卡在这里。
//
// 落位口径（已核实 schema）：**没有 config_change_logs 表**，配置变更与其它后台操作
// 统一落 audit_logs（module=system / action=update，before_json / after_json）。
// 故正式端点应是 audit_logs 的过滤视图，不是新表。待霍承钧实现时按此口径。
//
// 金额铁律：配置值一律「字符串原值」入参，**不做任何浮点运算**。
// 单位由配置键决定（FEN_CONFIGS=分 / BP_CONFIGS=基点 / 其余按valueType），
// 展示前先查单位再格式化，绝不假设所有值都是数字。
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Descriptions, Drawer, Input, Select, Space, Tag, Tooltip } from 'antd';
import { FileProtectOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { configApi } from '@/api/profit';
import type { ConfigChangeLog, TruncatedPageResult } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { configGroupOf, configLabel, CONFIG_GROUPS, FEN_CONFIGS, BP_CONFIGS } from '@/shared/config-meta';

interface Filters {
  configKey?: string;
  operator?: string;
  group?: string;
  keyword?: string;
}

/**
 * 配置值展示：按配置键的单位类型格式化，**不做浮点运算**。
 * - 分（FEN）：整数除 100 手工拼「¥x.yy」，不用 parseFloat/toFixed（避免精度与四舍五入争议）
 * - 基点（BP）：整数除 100 拼百分比
 * - BOOL：true/false 转中文开关语义
 * - 其余：原样字符串（可能是枚举串如 split_mode）
 */
function ConfigValue({ configKey, value }: { configKey: string; value: string }) {
  if (FEN_CONFIGS.has(configKey)) {
    // 分 → 元：整数运算，避免浮点误差（大额配置下toFixed 会丢精度）
    const fen = Number(value);
    if (!Number.isFinite(fen)) return <code>{value}</code>;
    const abs = Math.abs(fen);
    const yuan = Math.floor(abs / 100);
    const cent = String(abs % 100).padStart(2, '0');
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {fen < 0 ? '-' : ''}¥{yuan.toLocaleString('zh-CN')}.{cent}
        <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>（{value} 分）</span>
      </span>
    );
  }
  if (BP_CONFIGS.has(configKey)) {
    const bp = Number(value);
    if (!Number.isFinite(bp)) return <code>{value}</code>;
    // 基点 → 百分比：同样整数运算
    const percentInt = Math.floor(bp / 100);
    const percentFrac = String(bp % 100).padStart(2, '0');
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {percentInt}.{percentFrac}%
        <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>（{value} bp）</span>
      </span>
    );
  }
  if (value === 'true' || value === 'false') {
    return <Tag color={value === 'true' ? 'success' : 'default'}>{value === 'true' ? '开启' : '关闭'}</Tag>;
  }
  return <code style={{ fontSize: 12 }}>{value}</code>;
}

/** 变更方向：仅用于视觉提示，业务判断仍以前后值对照为准 */
function changedHint(oldV: string, newV: string) {
  if (oldV === newV) return <Tag color="default">无变化</Tag>;
  return null;
}

export function ConfigChangelogPage() {
  const [list, setList] = useState<ConfigChangeLog[]>([]);
  const [total, setTotal] = useState(0);
  /**
   * 🔴 候选集是否被服务端截断（契约 §5.7.7）。
   * 为true 时 `total` 是**候选集条数**（上限 500），不是全库条数——
   * 契约明文禁止把它当 total 展示，否则运营会以为全库只有这么多条变更。
   */
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [filters, setFilters] = useState<Filters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConfigChangeLog | null>(null);

  const load = useCallback(async (p: number, s: number, f: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const res: TruncatedPageResult<ConfigChangeLog> = await configApi.changeLogs({ page: p, pageSize: s, ...f });
      setList(res.list);
      setTotal(res.total);
      setTruncated(res.truncated);
      setPage(res.page);
      setSize(res.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setList([]);
      setTotal(0);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, size, filters);
  }, [filters, size, load]);

  // 操作人下拉：从已加载数据里取（配置项少，这样比另开接口轻）
  const operators = useMemo(() => Array.from(new Set(list.map((c) => c.operator))), [list]);

  const columns = [
    {
      title: '配置项',
      dataIndex: 'configKey',
      width: 210,
      fixed: 'left' as const,
      render: (v: string) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{configLabel(v)}</span>
          <Space size={6}>
            <Tag style={{ fontSize: 11, margin: 0 }}>{configGroupOf(v)}</Tag>
            <code style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{v}</code>
          </Space>
        </Space>
      ),
    },
    {
      title: '变更前 → 变更后',
      dataIndex: 'beforeValue',
      width: 300,
      render: (oldV: string, r: ConfigChangeLog) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Space size={8} wrap>
            <span style={{ color: 'rgba(0,0,0,0.45)', textDecoration: 'line-through' }}>
              <ConfigValue configKey={r.configKey} value={oldV} />
            </span>
            <span style={{ color: 'rgba(0,0,0,0.25)' }}>→</span>
            <span style={{ fontWeight: 600 }}>
              <ConfigValue configKey={r.configKey} value={r.afterValue} />
            </span>
            {changedHint(oldV, r.afterValue)}
          </Space>
        </Space>
      ),
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      width: 110,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '变更时间',
      dataIndex: 'changedAt',
      width: 170,
      render: (v: string) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 13 }}>{fmtTime(v)}</span>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{fmtTime(v, 'YYYY-MM-DD')}</span>
        </Space>
      ),
    },
    {
      title: '来源 IP',
      dataIndex: 'ip',
      width: 130,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: 'requestId',
      dataIndex: 'requestId',
      width: 120,
      render: (v: string) => (
        <Tooltip title="按 requestId 可回溯服务端日志，排查问题时必带">
          <code style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', cursor: 'help' }}>{v}</code>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, r: ConfigChangeLog) => (
        <a onClick={() => setDetail(r)} style={{ fontSize: 13 }}>详情</a>
      ),
    },
  ];

  return (
    <PageContainer
      title="配置变更历史"
      desc="系统配置热更新留痕 · 配置可后台改就得有变更记录，否则「谁把佣金从 5% 改成 8%」查不到"
      extra={
        <a onClick={() => void load(page, size, filters)} style={{ fontSize: 13 }}>
          <ReloadOutlined /> 刷新
        </a>
      }
    >
      <Alert
        type="info"
        showIcon
        icon={<FileProtectOutlined />}
        style={{ marginBottom: 16 }}
        message="留痕口径"
        description="配置变更与其它后台操作统一落 audit_logs（module=system / action=update，变更前快照在 before_json、变更后在 after_json）——schema 未单设 config_change_logs 表。本页是该数据的配置域视图，requestId 可回溯服务端日志。"
      />

      {truncated && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="候选集已截断，请收紧筛选条件"
          description={
            <>
              「操作人 / 关键词」只能应用层筛选（audit_logs 无对应列），服务端候选集上限 500 条。
              当前 <strong>{total}</strong> 条是**候选集条数，不是全库变更条数**——请按配置项或配置域收窄后再查。
            </>
          }
        />
      )}

      <div className="filter-bar">
        <Select
          allowClear
          placeholder="配置域"
          style={{ width: 160 }}
          value={filters.group}
          onChange={(v) => setFilters((p) => ({ ...p, group: v }))}
          options={Object.keys(CONFIG_GROUPS).map((g) => ({ value: g, label: g }))}
        />
        <Select
          allowClear
          showSearch
          placeholder="配置项"
          style={{ width: 210 }}
          value={filters.configKey}
          onChange={(v) => setFilters((p) => ({ ...p, configKey: v }))}
          options={Object.values(CONFIG_GROUPS)
            .flat()
            .map((k) => ({ value: k, label: `${configLabel(k)}（${k}）` }))}
        />
        <Select
          allowClear
          placeholder="操作人"
          style={{ width: 130 }}
          value={filters.operator}
          onChange={(v) => setFilters((p) => ({ ...p, operator: v }))}
          options={operators.map((o: string) => ({ value: o, label: o }))}
        />
        <Input.Search
          allowClear
          placeholder="配置键 / 操作人 / requestId"
          style={{ width: 230 }}
          onSearch={(v) => setFilters((p) => ({ ...p, keyword: v }))}
        />
        <div className="filter-actions">
          <a onClick={() => setFilters({})} style={{ fontSize: 13 }}>重置</a>
        </div>
      </div>

      <DataTable<ConfigChangeLog>
        emptyKind="filtered"
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        error={error}
        onRetry={() => void load(page, size, filters)}
        total={total}
        // 截断时 total 是候选集条数，文案必须随之变化——默认「共 N 条」等于
        // 精确地告诉运营「全库只有 N 条变更」，这正是契约 §5.7.7 禁止的行为。
        totalText={
          truncated
            ? (t) => `候选集 ${t} 条（已截断，非全库条数）`
            : undefined
        }
        page={page}
        pageSize={size}
        onPageChange={(p, s) => {
          setSize(s);
          void load(p, s, filters);
        }}
        scroll={{ x: 1250 }}
      />

      <Drawer
        title={`配置变更详情${detail ? ` · ${configLabel(detail.configKey)}` : ''}`}
        width={520}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="配置项">{configLabel(detail.configKey)}</Descriptions.Item>
            <Descriptions.Item label="配置键">
              <code>{detail.configKey}</code>
            </Descriptions.Item>
            <Descriptions.Item label="所属配置域">{configGroupOf(detail.configKey)}</Descriptions.Item>
            <Descriptions.Item label="变更前">
              <ConfigValue configKey={detail.configKey} value={detail.beforeValue} />
            </Descriptions.Item>
            <Descriptions.Item label="变更后">
              <ConfigValue configKey={detail.configKey} value={detail.afterValue} />
            </Descriptions.Item>
            <Descriptions.Item label="变化量">
              {(() => {
                const o = Number(detail.beforeValue);
                const n = Number(detail.afterValue);
                if (!Number.isFinite(o) || !Number.isFinite(n)) return '非数值变更';
                const diff = n - o;
                const sign = diff > 0 ? '+' : '';
                return (
                  <span style={{ color: diff === 0 ? 'rgba(0,0,0,0.45)' : diff > 0 ? '#d4380d' : '#52c41a' }}>
                    {sign}
                    {diff}（{FEN_CONFIGS.has(detail.configKey) ? '分' : BP_CONFIGS.has(detail.configKey) ? 'bp' : '原始单位'}）
                  </span>
                );
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="操作人">{detail.operator}</Descriptions.Item>
            <Descriptions.Item label="变更时间">{fmtTime(detail.changedAt)}</Descriptions.Item>
            <Descriptions.Item label="来源 IP">
              <code>{detail.ip}</code>
            </Descriptions.Item>
            <Descriptions.Item label="requestId">
              <code>{detail.requestId}</code>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </PageContainer>
  );
}