// ============================================================================
// 风险事件看板：事件队列 + 处置（契约 5.4：GET /admin/risk/events，POST handle）
// ============================================================================
import { Alert, Button, Descriptions, Drawer, Form, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { riskEventApi } from '@/api/risk';
import type { RiskEvent } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { RISK_ACTION_TAKEN, RISK_EVENT_STATUS, RISK_HANDLE_ACTION, RISK_LEVEL, risk_event_status } from '@/shared/enums';

interface Filters {
  status?: string;
  level?: string;
  type?: string;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  SENSITIVE_WORD: '敏感词',
  GPS_DEVIATION: 'GPS 偏差',
  CANCEL_RATE: '取消率异常',
  OFFLINE_SUSPECT: '疑似线下交易',
  SOS: 'SOS 告警',
  ABNORMAL_ORDER: '异常订单',
  // 🔴 系统级告警，**不是用户风险**（霍承钧 2026-10 落 middleware/outbound-cipher-guard.ts）：
  // 出参密文守卫在 production 环境剥离 _cipher/_hmac 字段时自动落一条本类型事件。
  // 文案绝不能按「用户行为异常」那一套写——那是服务端自身的出参泄漏告警，
  // 运营看到「敏感词/异常订单」式的类型会误判成用户有问题。
  OUTBOUND_CIPHER_LEAK: '系统告警：出参密文泄漏',
};

/**
 * 系统级事件类型（主体是接口而非用户）。
 *
 * **为什么要单独分类**：这类事件与「用户风险」在运营动作上完全相反——
 * 用户风险要处置用户（警告/限流/封禁），系统告警要**排查服务**（查是哪个端点漏了脱敏）。
 * 混在一张表里、同一列「当事人」显示，运营会点「处置 → 信用分处罚」，把一个代码缺陷
 * 当成用户违规处理掉，真问题反而被关单。
 */
const SYSTEM_EVENT_TYPES = new Set(['OUTBOUND_CIPHER_LEAK']);

/** 该事件是否为系统级（非用户风险） */
const isSystemEvent = (e: { type?: string; subjectType?: string }): boolean =>
  SYSTEM_EVENT_TYPES.has(e.type ?? '') || e.subjectType === 'API';

const ACTION_TAKEN_LABEL: Record<string, string> = {
  WARN: '警告',
  INTERCEPT: '消息拦截',
  LIMIT: '限流派单',
  PENALTY: '信用分处罚',
  BAN: '封禁清退',
};

/**
 * 处置动作候选（系统级事件不适用「处置用户」类动作）。
 *
 * 系统告警的处置是「修代码」，不是「处置用户」——给它封禁/处罚权限，
 * 等于允许运营用错误动作把一个服务端缺陷关掉。
 */
const USER_ACTION_TAKEN = ['WARN', 'INTERCEPT', 'LIMIT', 'PENALTY', 'BAN'];
const SYSTEM_ACTION_TAKEN = ['WARN'];

export function RiskEventsPage() {
  const table = useTable<RiskEvent, Filters>({
    fetcher: (params) => riskEventApi.list(params),
    initialFilters: { status: 'PENDING' },
  });
  const [detail, setDetail] = useState<RiskEvent | null>(null);
  const [handleTarget, setHandleTarget] = useState<RiskEvent | null>(null);
  const [action, setAction] = useState<'RESOLVED' | 'FALSE_POSITIVE' | 'PROCESSING'>('RESOLVED');
  const [actionTaken, setActionTaken] = useState<string>('WARN');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!handleTarget) return;
    setBusy(true);
    try {
      await riskEventApi.handle(handleTarget.eventNo, { action, actionTaken: action === RISK_HANDLE_ACTION.RESOLVED.value ? actionTaken : undefined, note: note.trim() || undefined });
      Modal.success({ content: '风控事件已处置' });
      setHandleTarget(null);
      setNote('');
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    { title: '事件号', dataIndex: 'eventNo', width: 110 },
    { title: '类型', dataIndex: 'type', width: 160, render: (v: string) => EVENT_TYPE_LABEL[v] ?? v },
    { title: '级别', dataIndex: 'level', width: 80, render: (v: string) => <StatusTag kind="riskLevel" value={v} /> },
    {
      title: '当事人（脱敏）',
      dataIndex: 'subjectNameMasked',
      width: 150,
      // 系统级事件的主体是**接口**不是用户，没有脱敏姓名可显示。
      // 显示 subjectId（= 端点路径）比显示空白有用：运营第一眼要能知道是哪个端点在漏脱敏。
      render: (v: string | undefined, r: RiskEvent) =>
        isSystemEvent(r) ? (r.subjectId ?? '（接口）') : (v ?? '-'),
    },
    { title: '关联订单', dataIndex: 'orderNo', width: 150, render: (v?: string) => v ?? '-' },
    { title: '规则', dataIndex: 'ruleCode', width: 150 },
    { title: '命中详情', dataIndex: 'hitDetail', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <StatusTag kind="riskEvent" value={v} /> },
    { title: '处置动作', dataIndex: 'actionTaken', width: 100, render: (v?: string) => (v ? ACTION_TAKEN_LABEL[v] ?? v : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 110,
      fixed: 'right' as const,
      render: (_: unknown, r: RiskEvent) => (
        <span>
          <Button type="link" size="small" onClick={() => setDetail(r)}>详情</Button>
          {[risk_event_status.PENDING, risk_event_status.PROCESSING].some((s) => s === r.status) && (
            <PermissionButton
              perm="risk:*"
              size="small"
              type="link"
              onClick={() => {
                setHandleTarget(r);
                setAction('RESOLVED');
                setActionTaken(r.type === RISK_ACTION_TAKEN.INTERCEPT.value ? RISK_ACTION_TAKEN.INTERCEPT.value : RISK_ACTION_TAKEN.WARN.value);
                setNote('');
              }}
            >
              处置
            </PermissionButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer title="风险事件看板" desc="风控规则命中队列（CRITICAL 优先）；SOS 为 P0，值守通知即时触达">
      <Alert style={{ marginBottom: 16 }} type="info" showIcon message="处置动作：WARN 警告 / INTERCEPT 拦截 / LIMIT 限流派单 / PENALTY 信用分处罚 / BAN 封禁清退；处置记录留痕 audit_logs。" />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="处置状态"
          style={{ width: 140 }}
          options={Object.values(RISK_EVENT_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Select
          allowClear
          placeholder="级别"
          style={{ width: 120 }}
          options={Object.values(RISK_LEVEL).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.level}
          onChange={(v) => table.search({ level: v })}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          options={Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          value={table.filters.type}
          onChange={(v) => table.search({ type: v })}
        />
      </div>
      <DataTable
        emptyKind="clean"
        emptyText={<>当前无风险事件<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>系统运行正常</span></>}
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
        scroll={{ x: 1500 }}
      />
      <Drawer title={`风控事件 ${detail?.eventNo ?? ''}`} width={520} open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <>
            {isSystemEvent(detail) && (
              <Alert
                style={{ marginBottom: 12 }}
                type="error"
                showIcon
                message="系统级告警：不是用户风险"
                description={
                  <span>
                    本条由**服务端出参密文守卫**自动落库（production 环境剥离 <code>_cipher</code> / <code>_hmac</code> 字段时触发）。
                    处置对象是**代码**，不是某个用户——请按「哪个端点漏了脱敏」排查，
                    切勿用封禁 / 信用分处罚等「处置用户」动作把它关单。
                    <br />
                    命中详情只含**路径与被剥离的键名**，不含任何字段值（告警记录本身不得成为新的泄漏源）。
                  </span>
                }
              />
            )}
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="类型">{EVENT_TYPE_LABEL[detail.type] ?? detail.type}</Descriptions.Item>
              <Descriptions.Item label="级别"><StatusTag kind="riskLevel" value={detail.level} /></Descriptions.Item>
              <Descriptions.Item label="当事人">
                {isSystemEvent(detail) ? (detail.subjectId ?? '（接口）') : (detail.subjectNameMasked ?? '-')}
                （{detail.subjectType}）
              </Descriptions.Item>
              <Descriptions.Item label="关联订单">{detail.orderNo ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="规则编码">{detail.ruleCode}</Descriptions.Item>
              <Descriptions.Item label="命中详情">{detail.hitDetail ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="状态"><StatusTag kind="riskEvent" value={detail.status} /></Descriptions.Item>
              <Descriptions.Item label="处置动作">{detail.actionTaken ? ACTION_TAKEN_LABEL[detail.actionTaken] ?? detail.actionTaken : '-'}</Descriptions.Item>
              <Descriptions.Item label="处置说明">{detail.handleNote ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="处置人">{detail.handlerName ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="处置时间">{fmtTime(detail.handledAt)}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Drawer>
      <Modal
        title={`处置风控事件 ${handleTarget?.eventNo ?? ''}`}
        open={!!handleTarget}
        onOk={submit}
        onCancel={() => setHandleTarget(null)}
        confirmLoading={busy}
        okText="确认处置"
        okButtonProps={{ danger: action === RISK_HANDLE_ACTION.RESOLVED.value }}
      >
        <Form layout="vertical">
          {handleTarget && isSystemEvent(handleTarget) && (
            <Alert
              style={{ marginBottom: 12 }}
              type="warning"
              showIcon
              message="系统级告警：处置对象是代码，不是用户"
              description="本条处置只做「记录 + 通知」，不提供封禁 / 信用分处罚等面向用户的动作——用错动作等于把服务端缺陷当成用户违规关掉。"
            />
          )}
          <Form.Item label="处置结论">
            <Select
              value={action}
              onChange={(v) => setAction(v)}
              options={[
                { value: 'RESOLVED', label: '已处置（需选择处置动作）' },
                { value: 'FALSE_POSITIVE', label: '误报（规则调优）' },
                { value: 'PROCESSING', label: '处理中（转人工跟进）' },
              ]}
            />
          </Form.Item>
          {action === RISK_HANDLE_ACTION.RESOLVED.value && (
            <Form.Item label="处置动作">
              <Select
                value={actionTaken}
                onChange={setActionTaken}
                options={(handleTarget && isSystemEvent(handleTarget) ? SYSTEM_ACTION_TAKEN : USER_ACTION_TAKEN)
                  .map((v) => ({ value: v, label: ACTION_TAKEN_LABEL[v] ?? v }))}
              />
            </Form.Item>
          )}
          <Form.Item label="处置说明">
            <Input.TextArea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                handleTarget && isSystemEvent(handleTarget)
                  ? '如：/admin/xxx 端点出参未剥离 _cipher 字段，已修复并补回归测试'
                  : '如：已警告陪聊员并记录，二次命中将限流派单'
              }
              maxLength={300}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
