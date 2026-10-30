// ============================================================================
// 四审队列：实名 → 人脸 → 无犯罪记录 → 保证金，每步材料查看 + 审批动作
// 契约 5.2：criminal 裁定 / deposit-confirm 为契约端点；
//           realname / face 人工复核、exam-pass、activate 为前端补充。
// ============================================================================
import { Alert, Button, Descriptions, Drawer, Form, Input, Select, Steps, Tag, message } from 'antd';
import { useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { DataTable } from '@/components/DataTable';
import { StatusTag } from '@/components/StatusTag';
import { PermissionButton } from '@/components/PermissionButton';
import { useTable } from '@/hooks/useTable';
import { applicationApi } from '@/api/application';
import type { CompanionApplication } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { APPLICATION_ACTION, APPLICATION_STAGE, application_stage, enumLabel, step_status } from '@/shared/enums';

/** 四审步骤定义（架构 §6.6） */
const STEPS = [
  { key: 'realname', title: '① 实名认证', stage: 'APPLIED' },
  { key: 'face', title: '② 人脸核验', stage: 'REALNAME_OK' },
  { key: 'criminal', title: '③ 无犯罪记录', stage: 'FACE_OK' },
  { key: 'deposit', title: '④ 保证金', stage: 'EXAM_OK' },
];

const stepStatusOf = (a: CompanionApplication, key: string): string => {
  if (key === 'realname') return a.realnameStatus;
  if (key === 'face') return a.faceStatus;
  if (key === 'criminal') return a.criminalStatus;
  return a.depositPaidAt ? step_status.PASSED : step_status.PENDING;
};

const currentStepIndex = (a: CompanionApplication): number => {
  const order = [
    application_stage.APPLIED,
    application_stage.REALNAME_OK,
    application_stage.FACE_OK,
    application_stage.CRIMINAL_OK,
    application_stage.TRAINING,
    application_stage.EXAM_OK,
    application_stage.DEPOSIT_OK,
    application_stage.ACTIVE,
  ];
  const idx = order.indexOf(a.stage as (typeof order)[number]);
  if (idx <= 0) return 0;
  if (idx <= 2) return 1;
  if (idx <= 4) return 2;
  return 3;
};

export function ApplicationsPage() {
  const table = useTable<CompanionApplication, { stage?: string; keyword?: string }>({
    fetcher: (params) => applicationApi.list(params),
    initialFilters: { stage: 'APPLIED' },
  });
  const [detail, setDetail] = useState<CompanionApplication | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const openDetail = async (r: CompanionApplication) => {
    try {
      const full = await applicationApi.detail(r.applicationNo);
      setDetail(full);
      setComment('');
    } catch {
      setDetail(r);
    }
  };

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      setDetail(null);
      table.refresh();
      if (okMsg) message.success(okMsg);
    } finally {
      setBusy(false);
    }
  };

  const review = (step: 'realname' | 'face' | 'criminal', action: 'PASS' | 'REJECT') => {
    if (!detail) return;
    if (action === APPLICATION_ACTION.REJECT.value && !comment.trim()) {
      message.error('驳回必须填写原因');
      return;
    }
    const fn =
      step === 'realname'
        ? applicationApi.reviewRealname(detail.applicationNo, action, comment.trim())
        : step === 'face'
          ? applicationApi.reviewFace(detail.applicationNo, action, comment.trim())
          : applicationApi.reviewCriminal(detail.applicationNo, action, comment.trim());
    void act(() => fn, `${detail.applicationNo} 已${enumLabel(APPLICATION_ACTION, action)}`);
  };

  const columns = [
    { title: '申请单号', dataIndex: 'applicationNo', width: 150 },
    { title: '陪聊员', dataIndex: 'companionName', width: 90 },
    { title: '手机号', dataIndex: 'phoneMasked', width: 130 },
    { title: '当前阶段', dataIndex: 'stage', width: 150, render: (v: string) => <StatusTag kind="application" value={v} /> },
    {
      title: '步骤进度',
      key: 'steps',
      width: 200,
      render: (_: unknown, r: CompanionApplication) => (
        <Steps
          size="small"
          current={currentStepIndex(r)}
          items={STEPS.map((s) => ({ title: s.title.replace(/[①②③④]\s/, ''), status: stepStatusOf(r, s.key) as 'wait' | 'process' | 'finish' | 'error' }))}
        />
      ),
    },
    { title: '人脸分', dataIndex: 'faceScore', width: 80, render: (v?: number) => (v ? <Tag color={v >= 80 ? 'green' : 'orange'}>{v}</Tag> : '-') },
    { title: '考试分', dataIndex: 'examScore', width: 80, render: (v?: number) => v ?? '-' },
    { title: '提交时间', dataIndex: 'submittedAt', width: 170, render: (v: string) => fmtTime(v) },
    {
      title: '操作',
      width: 90,
      fixed: 'right' as const,
      render: (_: unknown, r: CompanionApplication) => (
        <Button type="link" size="small" onClick={() => void openDetail(r)}>审核</Button>
      ),
    },
  ];

  const canReviewStep = (key: string): boolean => {
    if (!detail) return false;
    if (key === 'realname') return detail.realnameStatus === step_status.PENDING;
    if (key === 'face') return detail.faceStatus === step_status.PENDING;
    if (key === 'criminal') return detail.criminalStatus === step_status.PENDING;
    return false;
  };

  return (
    <PageContainer title="陪聊员入驻四审队列" desc="实名 → 人脸 → 无犯罪记录 → 培训考试 → 保证金，逐阶段审核；阶段推进只认状态机（契约 §8）">
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="人脸阈值取 system_configs.face_match_threshold（默认 80）；材料文件仅审核岗可见，查看行为记 L4 级审计。"
      />
      <div className="filter-bar">
        <Select
          placeholder="阶段"
          style={{ width: 200 }}
          allowClear
          options={Object.values(APPLICATION_STAGE).map((s) => ({ value: s.value, label: s.label }))}
          value={table.filters.stage}
          onChange={(v) => table.search({ stage: v })}
        />
        <Input.Search
          allowClear
          placeholder="申请单号 / 陪聊员"
          style={{ width: 240 }}
          onSearch={(v) => table.search({ keyword: v || undefined })}
        />
      </div>
      <DataTable
        emptyKind="clean"
        emptyText={<>当前无待审申请<br/><span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>系统运行正常</span></>}
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
      <Drawer
        title={`四审详情 ${detail?.applicationNo ?? ''}`}
        width={640}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="陪聊员">{detail.companionName}</Descriptions.Item>
              <Descriptions.Item label="手机号">{detail.phoneMasked}</Descriptions.Item>
              <Descriptions.Item label="当前阶段"><StatusTag kind="application" value={detail.stage} /></Descriptions.Item>
              <Descriptions.Item label="提交时间">{fmtTime(detail.submittedAt)}</Descriptions.Item>
            </Descriptions>
            <Steps
              direction="vertical"
              current={currentStepIndex(detail)}
              items={[
                {
                  title: '① 实名认证（OCR）',
                  status: stepStatusOf(detail, 'realname') as 'wait' | 'process' | 'finish' | 'error',
                  description: (
                    <div>
                      <div>OCR 业务号：{detail.realnameOcrBizId ?? '-'} ｜ 审核时间：{fmtTime(detail.realnameReviewedAt)}</div>
                      <div>审核意见：{detail.realnameComment ?? '-'}</div>
                      {canReviewStep('realname') && (
                        <div style={{ marginTop: 8 }}>
                          <PermissionButton perm="companion:*" size="small" type="primary" loading={busy} onClick={() => review('realname', 'PASS')}>通过</PermissionButton>
                          <PermissionButton perm="companion:*" size="small" danger style={{ marginLeft: 8 }} loading={busy} onClick={() => review('realname', 'REJECT')}>驳回</PermissionButton>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: '② 人脸核验（慧眼）',
                  status: stepStatusOf(detail, 'face') as 'wait' | 'process' | 'finish' | 'error',
                  description: (
                    <div>
                      <div>
                        人脸分：<Tag color={(detail.faceScore ?? 0) >= 80 ? 'green' : 'orange'}>{detail.faceScore ?? '-'}</Tag>
                        （阈值 80）｜ 核验 ID：{detail.faceVerifyId ?? '-'}
                      </div>
                      {detail.facePhotoUrl && (
                        <div style={{ margin: '6px 0' }}>
                          <img src={detail.facePhotoUrl} alt="人脸照片" style={{ width: 120, borderRadius: 6, border: '1px solid #f0f0f0' }} />
                          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>预签名 URL（L4 审计已记录本次查看）</div>
                        </div>
                      )}
                      <div>审核意见：{detail.faceComment ?? '-'}</div>
                      {canReviewStep('face') && (
                        <div style={{ marginTop: 8 }}>
                          <PermissionButton perm="companion:*" size="small" type="primary" loading={busy} onClick={() => review('face', 'PASS')}>通过</PermissionButton>
                          <PermissionButton perm="companion:*" size="small" danger style={{ marginLeft: 8 }} loading={busy} onClick={() => review('face', 'REJECT')}>驳回</PermissionButton>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: '③ 无犯罪记录',
                  status: stepStatusOf(detail, 'criminal') as 'wait' | 'process' | 'finish' | 'error',
                  description: (
                    <div>
                      <div>材料：{detail.criminalMaterialUrl ? <a href={detail.criminalMaterialUrl} target="_blank" rel="noreferrer">查看证明文件</a> : '未上传'}</div>
                      <div>审核意见：{detail.criminalComment ?? '-'}</div>
                      {canReviewStep('criminal') && (
                        <div style={{ marginTop: 8 }}>
                          <PermissionButton perm="companion:*" size="small" type="primary" loading={busy} onClick={() => review('criminal', 'PASS')}>裁定通过</PermissionButton>
                          <PermissionButton perm="companion:*" size="small" danger style={{ marginLeft: 8 }} loading={busy} onClick={() => review('criminal', 'REJECT')}>裁定驳回</PermissionButton>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: '④ 培训考试与保证金',
                  status: stepStatusOf(detail, 'deposit') as 'wait' | 'process' | 'finish' | 'error',
                  description: (
                    <div>
                      <div>培训完成：{fmtTime(detail.trainingCompletedAt)} ｜ 考试分：{detail.examScore ?? '-'}（第 {detail.examAttemptNo} 次）</div>
                      <div>保证金：{detail.depositPaidAt ? `¥${Number(detail.depositAmountFen ?? 0) / 100}（${fmtTime(detail.depositPaidAt)} 到账）` : '未缴纳'}</div>
                      {[application_stage.CRIMINAL_OK, application_stage.TRAINING].some((s) => s === detail.stage) && (
                        <PermissionButton
                          perm="companion:*"
                          size="small"
                          style={{ marginTop: 8, marginRight: 8 }}
                          loading={busy}
                          onClick={() => void act(() => applicationApi.examPass(detail.applicationNo, 85), '已记录考试通过')}
                        >
                          记录考试通过
                        </PermissionButton>
                      )}
                      {detail.stage === application_stage.EXAM_OK && (
                        <PermissionButton
                          perm="companion:*"
                          size="small"
                          type="primary"
                          style={{ marginTop: 8, marginRight: 8 }}
                          loading={busy}
                          onClick={() => void act(() => applicationApi.depositConfirm(detail.applicationNo), '保证金已确认到账')}
                        >
                          确认保证金到账
                        </PermissionButton>
                      )}
                      {detail.stage === application_stage.DEPOSIT_OK && (
                        <PermissionButton
                          perm="companion:*"
                          size="small"
                          type="primary"
                          style={{ marginTop: 8 }}
                          loading={busy}
                          onClick={() => void act(() => applicationApi.activate(detail.applicationNo), '四审完成，已上架接单')}
                        >
                          四审终审 · 上架
                        </PermissionButton>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            {detail.rejectReason && <Alert style={{ marginTop: 16 }} type="error" showIcon message={`驳回原因：${detail.rejectReason}`} />}
            <Form layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item label="审核意见（驳回时必填）">
                <Input.TextArea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="填写审核意见或驳回原因，将同步申请端" maxLength={200} showCount />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>
    </PageContainer>
  );
}
