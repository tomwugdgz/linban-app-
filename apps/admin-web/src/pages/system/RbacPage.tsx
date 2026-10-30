// ============================================================================
// 管理员与 RBAC：管理员账号管理 + 角色权限矩阵（契约缺口，前端补充端点）
// 权限键以 API-CONTRACT §5 为单一事实源；admin 角色权限不可改。
// ============================================================================
import { Alert, Checkbox, Form, Input, Modal, Popconfirm, Select, Table, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { adminAccountApi, roleApi } from '@/api/system';
import { PERMISSION_GROUPS } from '@/shared/permissions';

type PermGroup = (typeof PERMISSION_GROUPS)[number];
import type { AdminAccount, RoleItem } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { ADMIN_STATUS, admin_status, enumLabel } from '@/shared/enums';

export function RbacPage() {
  return (
    <PageContainer title="管理员与角色" desc="RBAC 四角色 admin/ops/finance/cs；权限键与 API-CONTRACT §5 服务端映射一致">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="超管令牌独享 '*'；角色权限保存后即时生效（真实实现写 role_permissions 关联表并双写 seed）。" />
      <Tabs
        items={[
          { key: 'admins', label: '管理员账号', children: <AdminsTab /> },
          { key: 'roles', label: '角色权限矩阵', children: <RolesTab /> },
        ]}
      />
    </PageContainer>
  );
}

function AdminsTab() {
  const table = useTable<AdminAccount, { keyword?: string }>({
    fetcher: (params) => adminAccountApi.list(params),
    initialFilters: {},
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ username: '', realName: '', phone: '', roleId: '4' });
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    roleApi.list().then(setRoles).catch(() => setRoles([]));
  }, []);

  const create = async () => {
    if (!form.username.trim() || !form.realName.trim()) {
      Modal.error({ content: '用户名与姓名必填' });
      return;
    }
    setBusy(true);
    try {
      await adminAccountApi.create(form);
      Modal.success({ content: '管理员已创建，初始密码将通过短信下发' });
      setCreateOpen(false);
      setForm({ username: '', realName: '', phone: '', roleId: '4' });
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '姓名', dataIndex: 'realName', width: 100 },
    { title: '手机号', dataIndex: 'phoneMasked', width: 130 },
    { title: '角色', dataIndex: 'roleName', width: 120, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={ADMIN_STATUS[v]?.color}>{enumLabel(ADMIN_STATUS, v)}</Tag> },
    { title: '最近登录', dataIndex: 'lastLoginAt', width: 170, render: (v?: string) => fmtTime(v) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 100,
      fixed: 'right' as const,
      render: (_: unknown, r: AdminAccount) =>
        r.status === admin_status.ACTIVE ? (
          <Popconfirm title="确认冻结该管理员？" okButtonProps={{ danger: true }} onConfirm={() => void adminAccountApi.freeze(r.id).then(() => table.refresh())}>
            <PermissionButton perm="*" size="small" type="link" danger>冻结</PermissionButton>
          </Popconfirm>
        ) : (
          <PermissionButton perm="*" size="small" type="link" onClick={() => void adminAccountApi.unfreeze(r.id).then(() => table.refresh())}>解冻</PermissionButton>
        ),
    },
  ];

  return (
    <>
      <div className="filter-bar">
        <Input.Search allowClear placeholder="用户名 / 姓名" style={{ width: 220 }} onSearch={(v) => table.search({ keyword: v || undefined })} />
        <div className="filter-actions">
          <PermissionButton perm="*" type="primary" onClick={() => setCreateOpen(true)}>新建管理员</PermissionButton>
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
      />
      <Modal title="新建管理员" open={createOpen} onOk={create} onCancel={() => setCreateOpen(false)} confirmLoading={busy} okText="创建">
        <Form layout="vertical">
          <Form.Item label="用户名" required>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="登录账号，如 ops03" />
          </Form.Item>
          <Form.Item label="姓名" required>
            <Input value={form.realName} onChange={(e) => setForm({ ...form, realName: e.target.value })} />
          </Form.Item>
          <Form.Item label="手机号">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="用于登录告警与二次验证" maxLength={11} />
          </Form.Item>
          <Form.Item label="角色">
            <Select value={form.roleId} onChange={(v) => setForm({ ...form, roleId: v })} options={roles.map((r) => ({ value: r.id, label: `${r.name}（${r.roleKey}）` }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function RolesTab() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await roleApi.list();
      setRoles(list);
      const d: Record<string, string[]> = {};
      list.forEach((r) => (d[r.id] = [...r.permissions]));
      setDraft(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (roleId: string) => {
    setSaving(true);
    try {
      await roleApi.savePermissions(roleId, draft[roleId] ?? []);
      Modal.success({ content: '角色权限已保存' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = (roleId: string, permKey: string, checked: boolean) => {
    setDraft((prev) => {
      const cur = prev[roleId] ?? [];
      return {
        ...prev,
        [roleId]: checked ? [...new Set([...cur, permKey])] : cur.filter((k) => k !== permKey),
      };
    });
  };

  const columns = [
    { title: '权限域', width: 160, render: (_: unknown, g: PermGroup) => <b>{g.moduleName}</b> },
    { title: '权限键', width: 120, render: (_: unknown, g: PermGroup) => <code>{g.items[0].permKey}</code> },
    { title: '覆盖范围', render: (_: unknown, g: PermGroup) => <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{g.items[0].scope}</span> },
    ...roles.map((r) => ({
      title: `${r.name}${r.roleKey === 'admin' ? '（锁定）' : ''}`,
      width: 110,
      align: 'center' as const,
      render: (_: unknown, g: (typeof PERMISSION_GROUPS)[number]) => {
        const key = g.items[0].permKey;
        const checked = (draft[r.id] ?? []).includes(key) || (draft[r.id] ?? []).includes('*');
        return (
          <Checkbox
            checked={checked}
            disabled={r.roleKey === 'admin'}
            onChange={(e) => toggle(r.id, key, e.target.checked)}
          />
        );
      },
    })),
  ];

  return (
    <>
      <Table
        rowKey="module"
        loading={loading}
        columns={columns}
        dataSource={PERMISSION_GROUPS}
        pagination={false}
        bordered
        size="middle"
      />
      <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
        {roles
          .filter((r) => r.roleKey !== 'admin')
          .map((r) => (
            <PermissionButton key={r.id} perm="*" type="primary" loading={saving} onClick={() => save(r.id)}>
              保存「{r.name}」权限
            </PermissionButton>
          ))}
      </div>
    </>
  );
}
