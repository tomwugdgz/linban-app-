// ============================================================================
// 系统配置：system_configs 全量项分组查看 + 编辑（契约 5.1）
// 与 /profit/config（抽成专项）互补：本页覆盖 DATABASE.md §8 全部 12 项。
// ============================================================================
import { Alert, Form, Input, InputNumber, Modal, Switch, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';
import { PermissionButton } from '@/components/PermissionButton';
import { configApi } from '@/api/profit';
import type { SystemConfig } from '@/shared/types';
import { bpToDecimal, bpToPercent, decimalToBp, fenToYuan, fmtTime } from '@/shared/format';
import { CONFIG_VALUE_TYPE } from '@/shared/enums';
// 分组 / 单位类型抽到共享模块：变更历史页也要用同一套，避免两处漂移
import { BP_CONFIGS, CONFIG_GROUPS as GROUPS, FEN_CONFIGS } from '@/shared/config-meta';

export function ConfigsPage() {
  const nav = useNavigate();
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SystemConfig | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setConfigs(await configApi.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!editing || !editValue.trim()) return;
    setSaving(true);
    try {
      // DECIMAL 存字符串比率；编辑用 bp，提交按 1bp = 0.0001 换算（整数运算，避免浮点）
      const value = editing.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? bpToDecimal(editValue) : editValue.trim();
      await configApi.update(editing.configKey, value);
      Modal.success({ content: `${editing.configKey} 已热更新（Redis 失效 + 审计留痕）` });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const renderValue = (c: SystemConfig) => {
    if (c.valueType === CONFIG_VALUE_TYPE.BOOL.value) return <Tag color={c.configValue === 'true' ? 'success' : 'default'}>{c.configValue === 'true' ? '开启' : '关闭'}</Tag>;
    // 金额铁律：分→元走 fenToYuan（整数除+ 取余拼串），不用 toFixed 浮点换算
    if (FEN_CONFIGS.has(c.configKey)) {
      return (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {fenToYuan(c.configValue)}
          <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>（{c.configValue} 分）</span>
        </span>
      );
    }
    // 基点 → 百分比同样是整数运算
    if (BP_CONFIGS.has(c.configKey)) {
      const bp = Number(c.configValue);
      return (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.floor(bp / 100)}.{String(bp % 100).padStart(2, '0')}%
          <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>（{c.configValue} bp）</span>
        </span>
      );
    }
    if (c.valueType === CONFIG_VALUE_TYPE.DECIMAL.value) return <>{c.configValue}（{bpToPercent(decimalToBp(c.configValue))}）</>;
    return <>{c.configValue}</>;
  };

  const columns = [
    { title: '配置键', dataIndex: 'configKey', width: 240, render: (v: string) => <code>{v}</code> },
    { title: '当前值', key: 'v', width: 200, render: (_: unknown, c: SystemConfig) => renderValue(c) },
    { title: '类型', dataIndex: 'valueType', width: 80 },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    { title: '最近更新', dataIndex: 'updatedAt', width: 170, render: (v?: string) => fmtTime(v) },
    { title: '更新人', dataIndex: 'updatedBy', width: 90 },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, c: SystemConfig) => (
        <PermissionButton
          perm="config:read"
          size="small"
          type="link"
          onClick={() => {
            setEditing(c);
            // DECIMAL 配置（如抽成比例）以 bp 编辑，避免浮点误差
            setEditValue(c.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? String(decimalToBp(c.configValue)) : c.configValue);
          }}
        >
          编辑
        </PermissionButton>
      ),
    },
  ];

  return (
    <PageContainer title="系统配置" desc="system_configs 全量项（DATABASE.md §8 种子 12 项）；金额类单位为分，展示层换算">
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="配置读取：cache:config（Redis 5min + 主动失效）；修改动作双落 audit_logs（before/after）。"
        action={
          // 配置能热改就必须能查改了什么，否则「谁把抽成从 5% 调到 8%」永远查不到
          <a onClick={() => nav('/system/config-changelog')} style={{ fontSize: 13 }}>查看变更历史</a>
        }
      />
      {Object.entries(GROUPS).map(([group, keys]) => {
        const rows = configs.filter((c) => keys.includes(c.configKey));
        return (
          <div key={group} style={{ marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 10px' }}>{group}</h3>
            <Table rowKey="configKey" loading={loading} columns={columns} dataSource={rows} pagination={false} size="middle" scroll={{ x: 1000 }} />
          </div>
        );
      })}
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
            ) : BP_CONFIGS.has(editing.configKey) ? (
              <InputNumber style={{ width: '100%' }} min={0} max={10000} value={Number(editValue)} onChange={(v) => setEditValue(String(v ?? 0))} addonAfter="bp" />
            ) : editing.valueType === CONFIG_VALUE_TYPE.DECIMAL.value ? (
              <InputNumber style={{ width: '100%' }} min={0} max={10000} value={Number(editValue)} onChange={(v) => setEditValue(String(v ?? 0))} addonAfter="bp" />
            ) : (
              <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} addonAfter={FEN_CONFIGS.has(editing.configKey) ? '分' : undefined} />
            )}
          </Form>
        )}
      </Modal>
    </PageContainer>
  );
}
