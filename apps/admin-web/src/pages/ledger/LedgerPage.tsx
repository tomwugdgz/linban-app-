// ============================================================================
// 保单与文件台账（契约 5.6：GET /admin/policies、/admin/files，登录即可）
// 红线：文件 objectKey 为 X 态不出参，一律走 access-url 换链并审计。
// ============================================================================
import { Alert, Button, Table, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { PageContainer } from '@/components/PageContainer';
import { MoneyText } from '@/components/MoneyText';
import { csApi } from '@/api/system';
import type { FileItem, PolicyItem } from '@/shared/types';
import { fmtTime } from '@/shared/format';
import { INSURANCE_CLAIM_STATUS, enumLabel } from '@/shared/enums';

export function LedgerPage() {
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [p, f] = await Promise.all([csApi.policies({ page: 1, pageSize: 50 }), csApi.files({ page: 1, pageSize: 50 })]);
      setPolicies(p.list);
      setFiles(f.list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <PageContainer title="保单与文件台账" desc="保险批量投保半自动对账 / 文件元数据台账（objectKey 不出参）">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} action={<Button size="small" onClick={() => void load()}>重试</Button>} />}
      <Tabs
        items={[
          {
            key: 'policies',
            label: `保单台账（${policies.length}）`,
            children: (
              <Table
                rowKey="id"
                loading={loading}
                pagination={false}
                dataSource={policies}
                columns={[
                  { title: '保单号', dataIndex: 'policyNo', width: 140 },
                  { title: '关联订单', dataIndex: 'orderNo', width: 160 },
                  { title: '老人（脱敏）', dataIndex: 'elderNameMasked', width: 110 },
                  { title: '陪聊员（脱敏）', dataIndex: 'companionNameMasked', width: 120 },
                  { title: '保费', dataIndex: 'amountFen', width: 100, render: (v: string) => <MoneyText fen={v} /> },
                  { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag color={INSURANCE_CLAIM_STATUS[v]?.color}>{enumLabel(INSURANCE_CLAIM_STATUS, v)}</Tag> },
                  { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
                ]}
              />
            ),
          },
          {
            key: 'files',
            label: `文件台账（${files.length}）`,
            children: (
              <>
                <Alert style={{ marginBottom: 12 }} type="info" showIcon message="文件访问一律走 POST /files/:id/access-url 换临时链接并记审计；后台列表不返回 objectKey 与直出 URL。" />
                <Table
                  rowKey="id"
                  loading={loading}
                  pagination={false}
                  dataSource={files}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 60 },
                    {
                      title: '文件类型',
                      dataIndex: 'fileType',
                      width: 140,
                      render: (v: string) => ({ ID_CARD_FRONT: '身份证正面', CRIMINAL_CERT: '无犯罪记录证明', FACE_PHOTO: '人脸照片' }[v] ?? v),
                    },
                    { title: '业务类型', dataIndex: 'bizType', width: 180 },
                    { title: '业务单号', dataIndex: 'bizId', width: 160 },
                    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color="blue">{v}</Tag> },
                    { title: '大小', dataIndex: 'sizeBytes', width: 100, render: (v: number) => `${(v / 1024).toFixed(0)} KB` },
                    { title: '上传时间', dataIndex: 'createdAt', width: 170, render: (v: string) => fmtTime(v) },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    </PageContainer>
  );
}
