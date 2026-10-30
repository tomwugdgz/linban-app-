// ============================================================================
// 黑名单：用户/陪聊员/设备黑名单与解除（契约缺口，前端补充端点）
// ============================================================================
import { Button, Form, Input, Modal, Select, Tag } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { blacklistApi } from '@/api/companion';
import type { BlacklistItem } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { maskDevice } from '@/shared/mask';
import {
  BLACKLIST_STATUS,
  BLACKLIST_TARGET_TYPE,
  blacklist_status,
  blacklist_target_type,
  enumLabel,
  enumOptions,
} from '@/shared/enums';

interface Filters {
  targetType?: string;
  status?: string;
}

const SCOPE_LABEL: Record<string, string> = { PLATFORM: '全平台', ORDER: '下单', IM: 'IM', LOGIN: '登录' };

export function BlacklistPage() {
  const table = useTable<BlacklistItem, Filters>({
    fetcher: (params) => blacklistApi.list(params),
    initialFilters: { status: 'ACTIVE' },
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ targetType: 'USER', targetId: '', targetName: '', reason: '', scope: 'PLATFORM', deviceFingerprint: '' });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!form.targetId.trim() || !form.reason.trim()) {
      Modal.error({ content: '目标 ID 与拉黑原因必填' });
      return;
    }
    setBusy(true);
    try {
      await blacklistApi.create({
        targetType: form.targetType,
        targetId: form.targetId.trim(),
        targetName: form.targetName.trim() || form.targetId.trim(),
        reason: form.reason.trim(),
        scope: form.scope,
        deviceFingerprint: form.deviceFingerprint.trim() || undefined,
      });
      Modal.success({ content: '已加入黑名单' });
      setCreateOpen(false);
      setForm({ targetType: 'USER', targetId: '', targetName: '', reason: '', scope: 'PLATFORM', deviceFingerprint: '' });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const lift = async (r: BlacklistItem) => {
    setBusy(true);
    try {
      await blacklistApi.lift(r.id, '申诉成立，解除黑名单');
      Modal.success({ content: '已解除黑名单' });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '类型', dataIndex: 'targetType', width: 90, render: (v: string) => <Tag color={BLACKLIST_TARGET_TYPE[v]?.color}>{enumLabel(BLACKLIST_TARGET_TYPE, v)}</Tag> },
    { title: '目标', dataIndex: 'targetNameMasked', width: 100 },
    { title: '目标 ID', dataIndex: 'targetId', width: 100 },
    { title: '设备指纹', dataIndex: 'deviceFingerprint', width: 150, render: (v?: string) => maskDevice(v) },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
    { title: '范围', dataIndex: 'scope', width: 80, render: (v: string) => SCOPE_LABEL[v] ?? v },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <Tag color={BLACKLIST_STATUS[v]?.color}>{enumLabel(BLACKLIST_STATUS, v)}</Tag>,
    },
    { title: '到期时间', dataIndex: 'expiresAt', width: 170, render: (v?: string) => (v ? fmtTime(v) : '永久') },
    { title: '拉黑时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 90,
      fixed: 'right' as const,
      render: (_: unknown, r: BlacklistItem) =>
        r.status === blacklist_status.ACTIVE ? (
          <PermissionButton perm="companion:*" size="small" type="link" loading={busy} onClick={() => lift(r)}>解除</PermissionButton>
        ) : (
          <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{fmtTime(r.liftedAt)} 解除</span>
        ),
    },
  ];

  return (
    <PageContainer
      title="黑名单管理"
      desc="用户 / 陪聊员 / 设备维度黑名单；范围支持全平台、下单、IM、登录"
      extra={
        <PermissionButton perm="companion:*" type="primary" onClick={() => setCreateOpen(true)}>
          加入黑名单
        </PermissionButton>
      }
    >
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="目标类型"
          style={{ width: 140 }}
          options={enumOptions(BLACKLIST_TARGET_TYPE)}
          value={table.filters.targetType}
          onChange={(v) => table.search({ targetType: v })}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={enumOptions(BLACKLIST_STATUS)}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <div className="filter-actions">
          <Button onClick={() => table.reset()}>重置</Button>
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
        scroll={{ x: 1300 }}
      />
      <Modal title="加入黑名单" open={createOpen} onOk={create} onCancel={() => setCreateOpen(false)} confirmLoading={busy} okText="确认拉黑" okButtonProps={{ danger: true }}>
        <Form layout="vertical">
          <Form.Item label="目标类型" required>
            <Select
              value={form.targetType}
              onChange={(v) => setForm({ ...form, targetType: v })}
              options={enumOptions(BLACKLIST_TARGET_TYPE)}
            />
          </Form.Item>
          <Form.Item label="目标 ID" required extra="用户 ID / 陪聊员 ID / 设备指纹">
            <Input value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} placeholder="如：1024 或 fp_xxx" />
          </Form.Item>
          <Form.Item label="目标名称（展示脱敏）">
            <Input value={form.targetName} onChange={(e) => setForm({ ...form, targetName: e.target.value })} placeholder="如：张**" />
          </Form.Item>
          <Form.Item label="拉黑原因" required>
            <Input.TextArea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如：飞单坐实" maxLength={200} showCount />
          </Form.Item>
          <Form.Item label="生效范围">
            <Select value={form.scope} onChange={(v) => setForm({ ...form, scope: v })} options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          {form.targetType === blacklist_target_type.DEVICE && (
            <Form.Item label="设备指纹">
              <Input value={form.deviceFingerprint} onChange={(e) => setForm({ ...form, deviceFingerprint: e.target.value })} placeholder="fp_xxxxxxxx" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageContainer>
  );
}
