// ============================================================================
// 老带新奖励规则：邀请人/被邀请人奖励配置（契约缺口，前端补充端点）
// ============================================================================
import { Alert, Button, Form, Input, Modal, Table, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { PermissionButton } from '@/components/PermissionButton';
import { inviteRuleApi } from '@/api/marketing';
import type { InviteRule } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { fenToYuan } from '@/shared/format';
import { INVITE_REWARD_TYPE } from '@/shared/enums';

export function InviteRulesPage() {
  const [rules, setRules] = useState<InviteRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InviteRule | null>(null);
  const [rewardValue, setRewardValue] = useState('');
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRules(await inviteRuleApi.list());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await inviteRuleApi.update(editing.id, { rewardValue, inviteeCondition: condition });
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (r: InviteRule) => {
    setBusy(true);
    try {
      await inviteRuleApi.update(r.id, { enabled: !r.enabled });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '规则', dataIndex: 'name', width: 220 },
    {
      title: '奖励类型',
      dataIndex: 'rewardType',
      width: 100,
      render: (v: string) => <Tag color={INVITE_REWARD_TYPE[v]?.color}>{INVITE_REWARD_TYPE[v]?.label ?? v}</Tag>,
    },
    {
      title: '奖励值',
      dataIndex: 'rewardValue',
      width: 160,
      render: (v: string, r: InviteRule) => (r.rewardType === INVITE_REWARD_TYPE.BALANCE.value ? `${fenToYuan(v)}（${v} 分）` : `券模板 #${v}`),
    },
    { title: '触发条件', dataIndex: 'inviteeCondition', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (v?: string) => fmtTime(v) },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, r: InviteRule) => (
        <span>
          <PermissionButton
            perm="marketing:*"
            size="small"
            type="link"
            onClick={() => {
              setEditing(r);
              setRewardValue(r.rewardValue);
              setCondition(r.inviteeCondition);
            }}
          >
            编辑
          </PermissionButton>
          <PermissionButton perm="marketing:*" size="small" type="link" loading={busy} onClick={() => toggle(r)}>
            {r.enabled ? '停用' : '启用'}
          </PermissionButton>
        </span>
      ),
    },
  ];

  return (
    <PageContainer title="老带新奖励规则" desc="邀请人/被邀请人双向奖励；团长邀请奖励走佣金账本（契约缺口，前端补充端点）">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="奖励发放条件：被邀请人完成首单且订单实收达门槛；同设备/同支付账号视为同一邀请人（防刷）。" />
      <Table rowKey="id" loading={loading} columns={columns} dataSource={rules} pagination={false} />
      <Button style={{ marginTop: 12 }} onClick={() => void load()}>刷新</Button>
      <InviteRuleEditModal
        rule={editing}
        rewardValue={rewardValue}
        condition={condition}
        busy={busy}
        onRewardValueChange={setRewardValue}
        onConditionChange={setCondition}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    </PageContainer>
  );
}

function InviteRuleEditModal(props: {
  rule: InviteRule | null;
  rewardValue: string;
  condition: string;
  busy: boolean;
  onRewardValueChange: (v: string) => void;
  onConditionChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { rule, rewardValue, condition, busy, onRewardValueChange, onConditionChange, onSave, onCancel } = props;
  return (
    <Modal title={`编辑规则 ${rule?.name ?? ''}`} open={!!rule} onOk={onSave} onCancel={onCancel} confirmLoading={busy} okText="保存">
      {rule && (
        <Form layout="vertical">
          <Form.Item label={rule.rewardType === INVITE_REWARD_TYPE.BALANCE.value ? '奖励金额（分）' : '奖励券模板 ID'}>
            <Input value={rewardValue} onChange={(e) => onRewardValueChange(e.target.value)} />
          </Form.Item>
          <Form.Item label="触发条件">
            <Input.TextArea rows={2} value={condition} onChange={(e) => onConditionChange(e.target.value)} maxLength={100} showCount />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
