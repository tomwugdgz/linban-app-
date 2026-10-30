// ============================================================================
// 登录页：账号密码登录（契约：POST /auth/admin-login 签发 adminToken）
// 左侧品牌叙事 + 右侧表单；登录成功后回跳来源页。
// ============================================================================
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { SafetyOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/dashboard';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 已登录访问登录页直接回跳
  useEffect(() => {
    if (token) navigate(from, { replace: true });
  }, [token, from, navigate]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.username.trim(), values.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div style={{ display: 'flex', gap: 48, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div style={{ maxWidth: 360 }}>
          <Typography.Title level={2} style={{ color: '#d4380d', marginBottom: 8 }}>
            <SafetyOutlined /> 邻伴 · 管理后台
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 15 }}>
            社区养老陪伴匹配平台 · 同城真人陪聊 O2O（广州单城 MVP）
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            分账结算 · 裂变营销 · 四审风控 · 全操作审计
            <br />
            所有资金与敏感操作均经 RBAC 权限校验并留痕 audit_logs。
          </Typography.Paragraph>
        </div>
        <Card style={{ width: 380, boxShadow: '0 8px 24px rgba(212,56,13,0.08)' }}>
          <Typography.Title level={4} style={{ marginTop: 0 }}>账号登录</Typography.Title>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
          <Form layout="vertical" onFinish={onFinish} initialValues={{ username: 'admin', password: 'admin123' }} requiredMark={false}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
              <Input size="large" placeholder="请输入管理员账号" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password size="large" placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" size="large" block htmlType="submit" loading={loading}>
              登 录
            </Button>
          </Form>
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message="演示账号（mock 环境）"
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                admin / admin123（超管，全部权限）
                <br />
                ops01 / ops123（运营）｜ finance01 / finance123（财务）｜ cs01 / cs123（客服）
              </div>
            }
          />
        </Card>
      </div>
    </div>
  );
}
