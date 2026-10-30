// ============================================================================
// 优惠券管理：列表 + 状态筛选 + 新建/编辑弹窗 + 定向发放 + 领取明细
// ----------------------------------------------------------------------------
// 契约状态：§5 未覆盖 coupons 端点，全部为 [前端补充]，待霍承钧补登记。
// 字段口径严格对齐 schema:1421 coupons，页面不自行发明字段。
//
// 【金额铁律】coupons.value 的单位随 type 变（schema:1425 注释逐字）：
//   FULL_REDUCTION → value 是**减免分**（¥0.01 为 1 分）
//   DURATION→ value 是**抵扣分钟**
// 两者差 200 倍量级，绝不能混在一列让运营横向比较。故：
//   1. 列表「面值」列按type 分别渲染 ¥xx.xx / xx 分钟，列头挂 tooltip 说明；
//   2. 表单里输入框后缀随 type 切换（分 / 分钟），并在 label 上写清；
//   3. 全程 **整数运算**，不用 parseFloat/toFixed——分转元用 Math.floor + 取余拼串。
//
// 【核销率】运营判断「哪种券跑不动」只看三个数：领了多少、核销多少、核销率。
// mock 刻意做出差异（5% ~ 77%），页面上核销率 <20% 标橙、0 领取标中性灰「未投放/未领取」
// ——0 与「跑不动」是两件事，不能都显示成 0% 或都显示成红色。
// ============================================================================
import { useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  Tooltip,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { MoneyText } from '@/components/MoneyText';
import { PermissionButton } from '@/components/PermissionButton';
import { ConfirmButton } from '@/components/ConfirmButton';
import { useTable } from '@/hooks/useTable';
import { couponApi } from '@/api/marketing';
import type { Coupon, CouponInput, UserCoupon } from '@/shared/types';
import { fmtDate, fenToYuan } from '@/shared/format';
import {
  COUPON_STATUS,
  COUPON_TYPE,
  COUPON_VALUE_UNIT,
  COUPON_VALUE_UNIT_LABEL,
  coupon_type,
} from '@/shared/enums';

interface Filters {
  status?: string;
  keyword?: string;
}

/** 表单态：value/minSpendFen 一律用 number 承载整数分，提交时转字符串 */
interface FormState {
  name: string;
  type: string;
  value: number;
  minSpendFen: number;
  validDays: number;
  totalCount: number;
  scopeRules: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  type: coupon_type.FULL_REDUCTION,
  value: 1000,
  minSpendFen: 5000,
  validDays: 30,
  totalCount: 0,
  scopeRules: '',
};

/** 核销率：整数百分比，不用 toFixed（这里是展示比例，浮点可接受，但保持一致口径） */
function redemptionRate(c: Coupon): number | null {
  if (c.claimedCount === 0) return null; // 未领取 ≠ 0% 核销
  return Math.floor((c.usedCount / c.claimedCount) * 100);
}

/**
 * 核销率单元格。三个语义分区，视觉上必须能一眼分开：
 * - 未领取（claimedCount=0）：中性灰「未领取」——草稿券正常态，不是问题
 * - 核销率 < 20%：橙色 + tooltip「领取了但基本不用，门槛或面值设置有问题」
 * - 其它：正常色
 */
function RedemptionCell({ coupon }: { coupon: Coupon }) {
  const rate = redemptionRate(coupon);
  if (rate === null) {
    return (
      <Tooltip title="一张都没被领取。草稿券属正常；投放中的券则说明入口没被看到。">
        <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 13 }}>未领取</span>
      </Tooltip>
    );
  }
  const low = rate < 20;
  return (
    <Space direction="vertical" size={0}>
      <span style={{ color: low ? '#d46b08' : '#389e0d', fontWeight: low ? 600 : 400 }}>
        {rate}%
        {low && (
          <Tooltip title="领取了却基本不核销，通常是门槛偏高或面值吸引力不足。建议下调门槛或提高面值再观察一周。">
            <InfoCircleOutlined style={{ marginLeft: 4, fontSize: 12 }} />
          </Tooltip>
        )}
      </span>
      <Progress
        percent={rate}
        size="small"
        showInfo={false}
        strokeColor={low ? '#faad14' : '#52c41a'}
        style={{ width: 70, marginBottom: 0 }}
      />
    </Space>
  );
}

/** 领取进度（占发行总量） */
function ClaimProgress({ coupon }: { coupon: Coupon }) {
  if (coupon.totalCount === 0) {
    return (
      <Tooltip title="不限量发行">
        <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>不限量</span>
      </Tooltip>
    );
  }
  const pct = Math.floor((coupon.claimedCount / coupon.totalCount) * 100);
  const soldOut = coupon.claimedCount >= coupon.totalCount;
  return (
    <Tooltip title={`已领取 ${coupon.claimedCount} / 发行 ${coupon.totalCount}`}>
      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: soldOut ? '#d46b08' : undefined, fontWeight: soldOut ? 600 : 400 }}>
          {soldOut ? '已领完' : `${pct}%`}
        </span>
        <span style={{ color: 'rgba(0,0,0,0.45)', marginLeft: 4 }}>
          {coupon.claimedCount}/{coupon.totalCount}
        </span>
      </span>
    </Tooltip>
  );
}

export function CouponsPage() {
  const table = useTable<Coupon, Filters>({
    fetcher: (params) => couponApi.list(params),
    initialFilters: {},
  });
  const [createOpen, setCreateOpen] = useState(false);
  /** 编辑中的券；非null 时弹窗标题与提交目标都指向它 */
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [grantTarget, setGrantTarget] = useState<Coupon | null>(null);
  const [grantCount, setGrantCount] = useState(100);
  const [detailTarget, setDetailTarget] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState(false);
  const userTable = useTable<UserCoupon, Record<string, never>>({
    fetcher: (params) =>
      detailTarget ? couponApi.userCoupons(detailTarget.id, params) : Promise.resolve({ list: [], total: 0, page: 1, pageSize: 20 }),
    initialFilters: {},
    deps: [detailTarget?.id],
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  };

  const openEdit = (c: Coupon) => {
    setEditing(c);
    setForm({
      name: c.name,
      type: c.type,
      value: c.value,
      minSpendFen: Number(c.minSpendFen),
      validDays: c.validDays,
      totalCount: c.totalCount,
      scopeRules: c.scopeRules ?? '',
    });
    setCreateOpen(true);
  };

  /** 表单 → 请求体：金额类一律转字符串传「分」，不在前端做单位换算 */
  const toPayload = (): CouponInput => ({
    name: form.name.trim(),
    type: form.type,
    value: form.value,
    minSpendFen: String(form.minSpendFen),
    validDays: form.validDays,
    totalCount: form.totalCount,
    scopeRules: form.scopeRules.trim() || undefined,
  });

  const submit = async () => {
    if (!form.name.trim()) {
      Modal.error({ content: '券名称必填' });
      return;
    }
    if (!Number.isInteger(form.value) || form.value <= 0) {
      Modal.error({ content: form.type === coupon_type.DURATION ? '面值必须为正整数分钟' : '面值必须为正整数分' });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await couponApi.update(editing.id, toPayload());
        Modal.success({ content: '券模板已更新' });
      } else {
        await couponApi.create(toPayload());
        Modal.success({ content: '券模板已创建（草稿态，需投放后才对用户可见）' });
      }
      setCreateOpen(false);
      setEditing(null);
      table.refresh();
    } catch (e) {
      // http 层已toast；这里只做兜底文案，不重复弹
      if (!(e instanceof Error)) Modal.error({ content: '保存失败' });
    } finally {
      setBusy(false);
    }
  };

  const grant = async () => {
    if (!grantTarget) return;
    if (grantCount <= 0) {
      Modal.error({ content: '发放数量必须大于 0' });
      return;
    }
    setBusy(true);
    try {
      const res = await couponApi.grant(grantTarget.id, grantCount);
      Modal.success({ content: `已发放 ${res.granted} 张` });
      setGrantTarget(null);
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  /** 状态动作分发：不同状态能做的动作不同，列里按状态渲染避免无效按钮 */
  const runAction = async (c: Coupon, action: 'pause' | 'resume' | 'publish' | 'end') => {
    setBusy(true);
    try {
      if (action === 'pause') await couponApi.pause(c.id);
      else if (action === 'resume') await couponApi.resume(c.id);
      else if (action === 'publish') await couponApi.publish(c.id);
      else await couponApi.end(c.id);
      table.refresh();
    } finally {
      setBusy(false);
    }
  };

  // 有任一筛选条件生效时，空列表优先解释为「被筛掉了」而非「没有数据」
  const hasFilter = Boolean(table.filters.status || table.filters.keyword);

  const columns = [
    { title: '券编号', dataIndex: 'couponNo', width: 100 },
    {
      title: '名称',
      dataIndex: 'name',
      width: 170,
      render: (v: string, c: Coupon) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 500 }}>{v}</span>
          {c.scopeRules && (
            <Tooltip title={`适用范围：${c.scopeRules}`}>
              <Tag style={{ fontSize: 11, margin: 0 }}>限范围</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: string) => <Tag color={COUPON_TYPE[v]?.color}>{COUPON_TYPE[v]?.label ?? v}</Tag>,
    },
    {
      // 单位随 type 变，故列头必须挂说明，且渲染分两支
      title: (
        <Tooltip title="面值单位随类型变化：满减券=减免金额（分），时长券=抵扣时长（分钟）。两者量纲不同，不可横向比较。">
          <span>面值 <InfoCircleOutlined style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }} /></span>
        </Tooltip>
      ),
      dataIndex: 'value',
      width: 130,
      render: (v: number, c: Coupon) =>
        c.type === coupon_type.DURATION ? (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {v} <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>分钟</span>
          </span>
        ) : (
          <Space direction="vertical" size={0}>
            <MoneyText fen={String(v)} />
            <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{v} 分</span>
          </Space>
        ),
    },
    {
      title: '门槛',
      dataIndex: 'minSpendFen',
      width: 110,
      render: (v: string) => (Number(v) > 0 ? `满 ${fenToYuan(v)}` : <Tag>无门槛</Tag>),
    },
    {
      title: '有效期',
      dataIndex: 'validDays',
      width: 90,
      render: (v: number) => `${v} 天`,
    },
    { title: '领取进度', dataIndex: 'totalCount', width: 140, render: (_: unknown, c: Coupon) => <ClaimProgress coupon={c} /> },
    { title: '核销率', dataIndex: 'usedCount', width: 110, render: (_: unknown, c: Coupon) => <RedemptionCell coupon={c} /> },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <StatusTag kind="coupon" value={v} /> },
    {
      title: '投放期',
      width: 200,
      render: (_: unknown, c: Coupon) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 13 }}>{c.startAt ? fmtDate(c.startAt) : '未设'} → {c.endAt ? fmtDate(c.endAt) : '长期'}</span>
          {c.updatedAt && (
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>最后改动 {fmtDate(c.updatedAt)}</span>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 250,
      fixed: 'right' as const,
      render: (_: unknown, c: Coupon) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setDetailTarget(c)}>领取明细</Button>
          {/* 草稿与已结束不可编辑：已结束是终态，改了也发不出去 */}
          {c.status !== COUPON_STATUS.ENDED.value && (
            <PermissionButton perm="marketing:*" size="small" type="link" onClick={() => openEdit(c)}>
              编辑
            </PermissionButton>
          )}
          {c.status === COUPON_STATUS.ACTIVE.value && (
            <>
              <PermissionButton perm="marketing:*" size="small" type="link" onClick={() => { setGrantTarget(c); setGrantCount(100); }}>
                发放
              </PermissionButton>
              <ConfirmButton
                title={`确认暂停「${c.name}」的投放？`}
                description="暂停后用户已领取的券仍可使用，只是不再新增领取。可随时恢复。"
                onConfirm={() => runAction(c, 'pause')}
              >
                <PermissionButton perm="marketing:*" size="small" type="link" loading={busy}>暂停</PermissionButton>
              </ConfirmButton>
            </>
          )}
          {c.status === COUPON_STATUS.PAUSED.value && (
            <>
              <PermissionButton perm="marketing:*" size="small" type="link" onClick={() => { setGrantTarget(c); setGrantCount(100); }}>
                发放
              </PermissionButton>
              <PermissionButton perm="marketing:*" size="small" type="link" onClick={() => runAction(c, 'resume')} loading={busy}>
                恢复
              </PermissionButton>
              <ConfirmButton
                title={`确认结束「${c.name}」？`}
                description="结束不可恢复。存量已领取券仍可用完，但不再新增领取，且不能改面额。"
                onConfirm={() => runAction(c, 'end')}
              >
                <PermissionButton perm="marketing:*" size="small" type="link" loading={busy}>结束</PermissionButton>
              </ConfirmButton>
            </>
          )}
          {c.status === COUPON_STATUS.DRAFT.value && (
            <ConfirmButton
              title={`确认投放「${c.name}」？`}
              description="投放后用户即可领取，面额不可再改。"
              onConfirm={() => runAction(c, 'publish')}
            >
              <PermissionButton perm="marketing:*" size="small" type="link" loading={busy}>投放</PermissionButton>
            </ConfirmButton>
          )}
        </Space>
      ),
    },
  ];

  // 表单后缀单位由类型决定：满减=分、时长=分钟（不可跨类型沿用数值）
  const valueUnit = COUPON_VALUE_UNIT[form.type];
  const valueUnitLabel = COUPON_VALUE_UNIT_LABEL[valueUnit];

  return (
    <PageContainer
      title="优惠券管理"
      desc="满减券 / 时长抵扣券；创建、编辑、投放、暂停恢复、定向发放（契约缺口，[前端补充]端点）"
      extra={
        <PermissionButton perm="marketing:*" type="primary" onClick={openCreate}>
          新建券模板
        </PermissionButton>
      }
    >
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="面值单位随类型变化，别混着看"
        description="满减券面值单位是「分」（1000 = ¥10.00），时长券面值单位是「分钟」（1000 分钟 = 16 小时 40 分）。两者量纲不同，列表已分列渲染；所有金额均以整数「分」传输与运算，不做浮点换算。"
      />
      <div className="filter-bar">
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.values(COUPON_STATUS).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.status}
          onChange={(v) => table.search({ status: v })}
        />
        <Input.Search
          allowClear
          placeholder="券名称 / 编号"
          style={{ width: 220 }}
          onSearch={(v) => table.search({ keyword: v })}
        />
        <div className="filter-actions">
          <a onClick={table.reset} style={{ fontSize: 13 }}>重置</a>
        </div>
      </div>
      <DataTable
        // 空列表有两种完全不同的含义：有筛选条件时多半是被筛掉了；
        // 没筛选条件时是「还没建过券模板」——引导语不同，不能一律写「暂无数据」
        emptyKind={hasFilter ? 'filtered' : 'none'}
        emptyText={
          hasFilter ? undefined : (
            <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
              还没有券模板<br />
              <span style={{ fontSize: 12 }}>点击右上角「新建券模板」创建，保存后为草稿态，需投放后才对用户可见</span>
            </span>
          )
        }
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
        scroll={{ x: 1750 }}
      />

      <Modal
        title={editing ? `编辑券模板 · ${editing.couponNo}` : '新建券模板'}
        open={createOpen}
        onOk={submit}
        onCancel={() => { setCreateOpen(false); setEditing(null); }}
        confirmLoading={busy}
        okText={editing ? '保存' : '创建（草稿）'}
        width={560}
      >
        <Form layout="vertical">
          <Form.Item label="券名称" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：重阳节陪伴券" maxLength={128} />
          </Form.Item>
          <Form.Item label="券类型">
            <Select
              value={form.type}
              onChange={(v) => {
                // 切类型时重置面值：分与分钟量纲不同，沿用旧数字必然是错的
                setForm({ ...form, type: v, value: v === coupon_type.DURATION ? 30 : 1000 });
              }}
              options={Object.values(COUPON_TYPE).map((s) => ({ value: s.value, label: s.label }))}
            />
          </Form.Item>
          <Form.Item
            label={
              <Tooltip title={form.type === coupon_type.DURATION ? '抵扣时长（分钟）' : '减免金额（分），1000 分 = ¥10.00'}>
                <span>面值（{valueUnitLabel}）</span>
              </Tooltip>
            }
            extra={
              editing && editing.claimedCount > 0 ? (
                <span style={{ color: '#d46b08' }}>
                  该券已发放 {editing.claimedCount} 张，禁止改面额：用户已领的券按模板实时计值，改面额会让存量券面额同步变化（如¥50 改 ¥100，所有存量券立即变¥100）。
                  要降面值请新建券模板。
                </span>
              ) : undefined
            }
          >
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              precision={0}
              disabled={Boolean(editing && editing.claimedCount > 0)}
              value={form.value}
              onChange={(v) => setForm({ ...form, value: v ?? 0 })}
              addonAfter={valueUnitLabel}
            />
          </Form.Item>
          <Form.Item label="使用门槛（分，0 = 无门槛）">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={0}
              value={form.minSpendFen}
              onChange={(v) => setForm({ ...form, minSpendFen: v ?? 0 })}
              addonAfter="分"
            />
          </Form.Item>
          <Form.Item label="领取后有效期（天）">
            <InputNumber style={{ width: '100%' }} min={1} precision={0} value={form.validDays} onChange={(v) => setForm({ ...form, validDays: v ?? 30 })} addonAfter="天" />
          </Form.Item>
          <Form.Item
            label="发放总量（0 = 不限量）"
            extra={editing && form.totalCount !== 0 && form.totalCount < editing.claimedCount ? `不能小于已领取数 ${editing.claimedCount}` : undefined}
          >
            <InputNumber style={{ width: '100%' }} min={0} precision={0} value={form.totalCount} onChange={(v) => setForm({ ...form, totalCount: v ?? 0 })} />
          </Form.Item>
          <Form.Item
            label="适用范围规则（可选）"
            extra="JSON 格式，如 {&quot;serviceTypes&quot;:[&quot;CHAT&quot;],&quot;minOrderFen&quot;12000}；留空 = 全量可用"
          >
            <Input.TextArea rows={2} value={form.scopeRules} onChange={(e) => setForm({ ...form, scopeRules: e.target.value })} placeholder='{"serviceTypes":["CHAT"]}' />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`发放「${grantTarget?.name ?? ''}」`} open={!!grantTarget} onOk={grant} onCancel={() => setGrantTarget(null)} confirmLoading={busy} okText="确认发放">
        <Form layout="vertical">
          <Form.Item
            label="发放数量"
            extra={
              grantTarget && grantTarget.totalCount > 0
                ? `剩余可发 ${Math.max(grantTarget.totalCount - grantTarget.claimedCount, 0)} 张（发行总量 ${grantTarget.totalCount}，已领 ${grantTarget.claimedCount}）`
                : '不限量发行'
            }
          >
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={grantTarget && grantTarget.totalCount > 0 ? Math.max(grantTarget.totalCount - grantTarget.claimedCount, 1) : 100000}
              precision={0}
              value={grantCount}
              onChange={(v) => setGrantCount(v ?? 0)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`领取明细 · ${detailTarget?.name ?? ''}`}
        width={680}
        open={!!detailTarget}
        onClose={() => setDetailTarget(null)}
      >
        {detailTarget && (
          <Alert
            style={{ marginBottom: 12 }}
            type="info"
            message={
              detailTarget.claimedCount === 0
                ? '该券尚无领取记录'
                : `共领取 ${detailTarget.claimedCount} 张，核销 ${detailTarget.usedCount} 张（核销率 ${
                    redemptionRate(detailTarget)
                  }%）`
            }
          />
        )}
        <DataTable
          rowKey="id"
          size="small"
          columns={[
            { title: '用户（脱敏）', dataIndex: 'userNameMasked', width: 100 },
            { title: '来源', dataIndex: 'source', width: 120, render: (v: string) => <StatusTag kind="couponSource" value={v} /> },
            { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <StatusTag kind="userCoupon" value={v} /> },
            { title: '使用订单', dataIndex: 'usedOrderNo', width: 160, render: (v?: string) => v ?? '-' },
            { title: '领取时间', dataIndex: 'receivedAt', width: 110, render: (v: string) => fmtDate(v) },
            { title: '过期时间', dataIndex: 'expiredAt', width: 110, render: (v?: string) => (v ? fmtDate(v) : '-') },
          ]}
          dataSource={userTable.list}
          loading={userTable.loading}
          error={userTable.error}
          onRetry={userTable.retry}
          total={userTable.total}
          page={userTable.page}
          pageSize={userTable.pageSize}
          onPageChange={userTable.changePage}
        />
      </Drawer>
    </PageContainer>
  );
}