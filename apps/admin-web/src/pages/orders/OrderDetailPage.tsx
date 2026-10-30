// ============================================================================
// 订单详情：状态机时间线 / 核销记录 / 分账记录 / 双方信息脱敏
// ============================================================================
import { Alert, Button, Descriptions, Form, Input, Modal, Radio, Space, Table, Tag, Timeline } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { orderApi } from '@/api/order';
import type { OrderDetail, OrderVerification } from '@/shared/types';
import { fmtDuration, fmtTime } from '@/shared/format';
import {
  CODE_MODE,
  enumLabel,
  ORDER_DECISION,
  ORDER_STATUS,
  SERVICE_TYPE,
  order_status,
  VERIFICATION_TYPE,
  VERIFY_RESULT,
} from '@/shared/enums';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decideOpen, setDecideOpen] = useState(false);
  const [decision, setDecision] = useState<string>(ORDER_DECISION.COMPLETE.value);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setOrder(await orderApi.detail(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const decide = async () => {
    if (!note.trim()) {
      Modal.error({ content: '裁决必须填写说明' });
      return;
    }
    setBusy(true);
    try {
      await orderApi.decide(id, decision, note.trim());
      Modal.success({ content: '裁决完成，订单状态与分账已联动更新' });
      setDecideOpen(false);
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <PageContainer title="订单详情">
        <Alert type="error" showIcon message="加载失败" description={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} />
      </PageContainer>
    );
  }
  if (!order) {
    return <PageContainer title="订单详情">{loading ? '加载中…' : '订单不存在'}</PageContainer>;
  }

  return (
    <PageContainer
      title={`订单 ${order.orderNo}`}
      desc="状态机时间线 / 核销记录 / 分账记录 / 双方信息（脱敏）"
      extra={
        <Space>
          <Button onClick={() => navigate('/orders')}>返回列表</Button>
          {order.status === order_status.SUSPENDED && (
            <PermissionButton perm="order:*" type="primary" danger onClick={() => setDecideOpen(true)}>
              客服裁决
            </PermissionButton>
          )}
        </Space>
      }
    >
      <Descriptions column={2} bordered size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="当前状态"><StatusTag kind="order" value={order.status} /></Descriptions.Item>
        <Descriptions.Item label="服务类型">{SERVICE_TYPE[order.serviceType]?.label ?? order.serviceType}</Descriptions.Item>
        <Descriptions.Item label="服务时长">{fmtDuration(order.durationMinutes)}</Descriptions.Item>
        <Descriptions.Item label="服务日期">{order.serviceDate}</Descriptions.Item>
        <Descriptions.Item label="时段">{fmtTime(order.slotStart, 'HH:mm')} – {fmtTime(order.slotEnd, 'HH:mm')}</Descriptions.Item>
        <Descriptions.Item label="夜间单">{order.nightOrder ? <Tag color="purple">是</Tag> : '否'}</Descriptions.Item>
        <Descriptions.Item label="老人（脱敏）">{order.elderNameMasked} ｜ {order.elderPhoneMasked}</Descriptions.Item>
        <Descriptions.Item label="陪聊员（脱敏）">{order.companionNameMasked ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="服务地址（脱敏）" span={2}>{order.addressMasked}</Descriptions.Item>
        <Descriptions.Item label="时薪"><MoneyText fen={order.hourlyRateFen} /> / 小时</Descriptions.Item>
        <Descriptions.Item label="原价"><MoneyText fen={order.originalAmountFen} /></Descriptions.Item>
        <Descriptions.Item label="优惠券抵扣"><MoneyText fen={order.couponDeductFen} /></Descriptions.Item>
        <Descriptions.Item label="时长卡抵扣"><MoneyText fen={order.giftCardDeductFen} /></Descriptions.Item>
        <Descriptions.Item label="实付金额"><MoneyText fen={order.totalAmountFen} strong /></Descriptions.Item>
        <Descriptions.Item label="退款金额"><MoneyText fen={order.refundAmountFen} /></Descriptions.Item>
        {/* team-lead 规则：取消违约金 1000bp（cancel_penalty_rate_bp，后台可配）；此处按比例预估，实际以服务端计算为准 */}
        {[order_status.CANCELLED, order_status.REFUNDED].some((s) => s === order.status) && (
          <Descriptions.Item label={`违约金（1000bp 预估）`}>
            <MoneyText fen={String(Math.round((Number(order.totalAmountFen) * 1000) / 10000))} />（违约方承担，服务端计算为准）
          </Descriptions.Item>
        )}
        <Descriptions.Item label="取消原因" span={2}>{order.cancelReason ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{order.remark ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{fmtTime(order.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="完成时间">{fmtTime(order.completedAt)}</Descriptions.Item>
      </Descriptions>

      <h3 style={{ margin: '20px 0 12px' }}>状态机时间线</h3>
      <Timeline
        items={order.timeline.map((t) => ({
          color: t.toStatus === order.status ? '#d4380d' : 'gray',
          children: (
            <div>
              <Space>
                <Tag>{ORDER_STATUS[t.toStatus]?.label ?? t.toStatus}</Tag>
                <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
                  {t.operatorType} {t.operatorName ? `· ${t.operatorName}` : ''} ｜ {fmtTime(t.createdAt)}
                </span>
              </Space>
              {t.reason && <div style={{ fontSize: 12, marginTop: 2 }}>原因：{t.reason}</div>}
            </div>
          ),
        }))}
      />

      <h3 style={{ margin: '20px 0 12px' }}>核销记录（三关：动态码 / 人脸 / GPS）</h3>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.verifications}
        locale={{ emptyText: <span style={{ color: 'rgba(0,0,0,0.45)' }}>该订单尚未产生核销记录（未到岗核验）</span> }}
        columns={[
          { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => enumLabel(VERIFICATION_TYPE, v) },
          { title: '结果', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={VERIFY_RESULT[v]?.color}>{enumLabel(VERIFY_RESULT, v)}</Tag> },
          { title: '动态码', dataIndex: 'dynamicCode', width: 100, render: (v?: string) => v ?? '-' },
          { title: '展示方', dataIndex: 'codeMode', width: 100, render: (v?: string) => (v ? enumLabel(CODE_MODE, v) : '-') },
          { title: '人脸分', dataIndex: 'faceScore', width: 90, render: (v: number | undefined, r: OrderVerification) => (v ? <Tag color={r.facePassed ? 'green' : 'red'}>{v}</Tag> : '-') },
          { title: '活体分', dataIndex: 'livenessScore', width: 90, render: (v?: number) => v ?? '-' },
          { title: 'GPS 偏差', dataIndex: 'gpsDeviationM', width: 100, render: (v?: number) => (v !== undefined ? `${v} 米` : '-') },
          { title: '到岗时间', dataIndex: 'arrivedAt', width: 170, render: (v?: string) => fmtTime(v) },
        ]}
      />

      <h3 style={{ margin: '20px 0 12px' }}>分账记录</h3>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.sharings}
        locale={{ emptyText: <span style={{ color: 'rgba(0,0,0,0.45)' }}>该订单尚未产生分账记录（未支付或未到分账时点）</span> }}
        columns={[
          { title: '分账单号', dataIndex: 'sharingNo', width: 180 },
          { title: '状态', dataIndex: 'status', width: 120, render: (v: string) => <StatusTag kind="sharing" value={v} /> },
          { title: '冻结金额', dataIndex: 'frozenAmountFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
          { title: '平台抽成', dataIndex: 'platformCommissionFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
          { title: '陪聊员应收', dataIndex: 'companionIncomeFen', width: 110, render: (v: string) => <MoneyText fen={v} /> },
          { title: '抽成比例', dataIndex: 'commissionRateBp', width: 90, render: (v: number) => `${v / 100}%` },
          { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
        ]}
      />

      <Modal
        title={`客服裁决 ${order.orderNo}`}
        open={decideOpen}
        onOk={decide}
        onCancel={() => setDecideOpen(false)}
        confirmLoading={busy}
        okText="确认裁决"
        okButtonProps={{ danger: decision !== ORDER_DECISION.COMPLETE.value }}
      >
        <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="裁决将联动订单状态与分账（完成→分账；退款→分账回退），操作不可撤销。" />
        <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value)} style={{ marginBottom: 12 }}>
          <Space direction="vertical">
            <Radio value={ORDER_DECISION.COMPLETE.value}>裁决完成（订单 → COMPLETED，分账单 → SHARED）</Radio>
            <Radio value={ORDER_DECISION.PARTIAL_REFUND.value}>部分退款 50%（订单 → REFUNDED，分账回退 50%）</Radio>
            <Radio value={ORDER_DECISION.FULL_REFUND.value}>全额退款（订单 → REFUNDED，分账全额回退）</Radio>
          </Space>
        </Radio.Group>
        <Form layout="vertical">
          <Form.Item label="裁决说明" required>
            <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：双方已和解，按完成处理" maxLength={300} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
