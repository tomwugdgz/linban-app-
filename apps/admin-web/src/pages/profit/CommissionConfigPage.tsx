// ============================================================================
// 抽成配置：system_configs 可视化编辑（commission_rate bp 编辑 + 生效记录）
// 契约红线：配置热更新双落（Redis 失效 + audit_logs）；金额类配置一律「分」。
// ============================================================================
import { Alert, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PermissionButton } from '@/components/PermissionButton';
import { configApi } from '@/api/profit';
import type { ConfigChangeLog, SystemConfig } from '@/shared/types';
import { bpToDecimal, bpToPercent, decimalToBp, fenToYuan, fmtTime } from '@/shared/format';
import { CONFIG_VALUE_TYPE } from '@/shared/enums';
import { MoneyText } from '@/components/MoneyText';
import { BP_CONFIGS, FEN_CONFIGS, configGroupOf } from '@/shared/config-meta';

/**
 * 变更历史里的配置值展示：**必须按配置键的单位类型格式化**，
 * 不能直接打印字符串——`report_reward` 的 before/after 是「分」，
 * 直接显示 1000 会被误读成 ¥1000，实际是 ¥10。
 * 与 ConfigChangelogPage 共用 config-meta 的 FEN/BP 判定，避免两处漂移。
 */
function renderLogValue(configKey: string, value: string) {
  if (FEN_CONFIGS.has(configKey)) return <MoneyText fen={value} />;
  if (BP_CONFIGS.has(configKey)) return <>{value} bp（{bpToPercent(Number(value))}）</>;
  if (value === 'true' || value === 'false') {
    return <Tag color={value === 'true' ? 'success' : 'default'}>{value === 'true' ? '开启' : '关闭'}</Tag>;
  }
  return <code style={{ fontSize: 12 }}>{value}</code>;
}

export function CommissionConfigPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [logs, setLogs] = useState<ConfigChangeLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SystemConfig | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, logRes] = await Promise.all([configApi.list(), configApi.changeLogs({ page: 1, pageSize: 20 })]);
      setConfigs(list);
      setLogs(logRes.list);
      setLogsTotal(logRes.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openEdit = (c: SystemConfig) => {
    setEditing(c);
    // 抽成比例用 bp 编辑更直观（500 = 5%）
    setEditValue(c.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? String(decimalToBp(c.configValue)) : c.configValue);
  };

  const save = async () => {
    if (!editing) return;
    if (!editValue.trim()) {
      Modal.error({ content: '配置值不能为空' });
      return;
    }
    setSaving(true);
    try {
      // DECIMAL 存字符串比率；编辑用 bp，提交时按 1bp = 0.0001 转字符串（整数运算，不用 toFixed）
      const value = editing.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? bpToDecimal(editValue) : editValue.trim();
      await configApi.update(editing.configKey, value);
      Modal.success({ content: `配置 ${editing.configKey} 已热更新（Redis 缓存已失效，操作已记审计）` });
      setEditing(null);
      void load();
    } finally {
      setSaving(false);
    }
  };

  const renderValue = (c: SystemConfig) => {
    if (c.valueType === CONFIG_VALUE_TYPE.BOOL.value) {
      return <Tag color={c.configValue === 'true' ? 'success' : 'default'}>{c.configValue === 'true' ? '开启' : '关闭'}</Tag>;
    }
    // 金额铁律：分→元走 fenToYuan（整数除 + 取余拼串），不用 toFixed 浮点换算
    if (FEN_CONFIGS.has(c.configKey)) {
      return (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fenToYuan(c.configValue)}
          <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>（{c.configValue} 分）</span>
        </span>
      );
    }
    if (c.valueType === CONFIG_VALUE_TYPE.DECIMAL.value) {
      return <>{c.configValue}（{bpToPercent(decimalToBp(c.configValue))}）</>;
    }
    return <>{c.configValue}</>;
  };

  const columns = [
    { title: '配置键', dataIndex: 'configKey', width: 240, render: (v: string) => <code>{v}</code> },
    { title: '分组', key: 'group', width: 110, render: (_: unknown, c: SystemConfig) => configGroupOf(c.configKey) },
    { title: '当前值', key: 'value', width: 200, render: (_: unknown, c: SystemConfig) => renderValue(c) },
    { title: '类型', dataIndex: 'valueType', width: 80 },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    { title: '最近更新', dataIndex: 'updatedAt', width: 170, render: (v?: string) => fmtTime(v) },
    { title: '更新人', dataIndex: 'updatedBy', width: 90 },
    {
      title: '操作',
      width: 90,
      fixed: 'right' as const,
      render: (_: unknown, c: SystemConfig) => (
        <PermissionButton perm="config:read" size="small" type="link" onClick={() => openEdit(c)}>
          编辑
        </PermissionButton>
      ),
    },
  ];

  // 字段名对齐契约 §5.7.7：beforeValue / afterValue / operator / changedAt。
  // 曾写成oldValue/newValue/operatorName/createdAt —— 接口已按契约返回新名，
  // 导致这四列全空白，而且不会报错。
  const logColumns = [
    { title: '时间', dataIndex: 'changedAt', width: 180, render: (v: string) => fmtTime(v) },
    { title: '配置键', dataIndex: 'configKey', width: 200 },
    { title: '变更前', dataIndex: 'beforeValue', width: 140, render: (v: string, r: ConfigChangeLog) => renderLogValue(r.configKey, v) },
    { title: '变更后', dataIndex: 'afterValue', width: 140, render: (v: string, r: ConfigChangeLog) => renderLogValue(r.configKey, v) },
    { title: '操作人', dataIndex: 'operator', width: 100 },
  ];

  return (
    <PageContainer title="抽成与系统配置" desc="commission_rate 等全量配置可视化编辑；修改即时生效并写入审计日志">
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="配置读取链路：cache:config（Redis，5min + 主动失效）。抽成比例以基点 bp 编辑（500 = 5%，范围 500–1000）。"
      />
      <Table
        rowKey="configKey"
        columns={columns}
        dataSource={configs}
        loading={loading}
        pagination={false}
        size="middle"
        scroll={{ x: 1100 }}
      />
      <h3 style={{ margin: '24px 0 12px' }}>生效记录（最近 20 条 / 共 {logsTotal} 条）</h3>
      <Table rowKey="id" columns={logColumns} dataSource={logs} pagination={false} size="small" />
      <Modal
        title={`编辑配置 ${editing?.configKey ?? ''}`}
        open={!!editing}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        okText="保存并热更新"
      >
        {editing && (
          <Form layout="vertical">
            <p style={{ color: 'rgba(0,0,0,0.45)' }}>{editing.description}</p>
            {editing.valueType === CONFIG_VALUE_TYPE.BOOL.value ? (
              <Switch checked={editValue === 'true'} onChange={(v) => setEditValue(String(v))} checkedChildren="开启" unCheckedChildren="关闭" />
            ) : editing.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? (
              <InputNumber
                style={{ width: '100%' }}
                // 抽成比例限定 5%–10%（500–1000bp，架构 §7.3；MVP 单费率无阶梯）
                min={editing.configKey === 'commission_rate' ? 500 : 0}
                max={editing.configKey === 'commission_rate' ? 1000 : 10000}
                value={Number(editValue)}
                onChange={(v) => setEditValue(String(v ?? 0))}
                addonAfter="bp"
              />
            ) : (
              <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} addonAfter={FEN_CONFIGS.has(editing.configKey) ? '分' : undefined} />
            )}
          </Form>
        )}
      </Modal>
    </PageContainer>
  );
}
