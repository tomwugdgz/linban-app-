// ============================================================================
// AppLayout：后台骨架（左侧权限菜单 + 顶部用户区 + 内容区 + 面包屑）
// 布局方案：Flex（sider 固定 + main 自适应）；sider 支持收起。
// ============================================================================
import { useMemo, useState } from 'react';
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import {
  DownOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { menuRoutes } from '@/router/routes';
import { useAuth } from '@/stores/auth';
import type { MenuProps } from 'antd';

const { Sider, Header, Content } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

export function AppLayout() {
  const { admin, permissions, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  // 权限驱动菜单：无 meta.perm 的入口登录即可见
  const can = (perm?: string) => {
    if (!perm) return true;
    if (permissions.includes('*')) return true;
    if (permissions.includes(perm)) return true;
    const domain = perm.split(':')[0];
    return permissions.includes(`${domain}:*`);
  };

  const menuItems = useMemo(() => {
    const visible = menuRoutes.filter((r) => can(r.meta.perm));
    const groups = new Map<string, MenuItem[]>();
    const singles: MenuItem[] = [];
    visible.forEach((r) => {
      const Icon = r.meta.icon;
      const item: MenuItem = {
        key: r.path,
        icon: Icon ? <Icon /> : undefined,
        label: r.meta.title,
      };
      if (r.meta.group) {
        const arr = groups.get(r.meta.group) ?? [];
        arr.push(item);
        groups.set(r.meta.group, arr);
      } else {
        singles.push(item);
      }
    });
    return [
      ...singles,
      ...[...groups.entries()].map(([name, children]) => ({
        key: `group-${name}`,
        icon: <SafetyOutlined />,
        label: name,
        children,
      })),
    ];
  }, [permissions]);

  const activePath = location.pathname;
  const current = menuRoutes.find((r) => r.path === activePath);
  const currentGroup = current?.meta.group;

  return (
    <Layout className="app-layout">
      <Sider className="app-sider" width={232} collapsed={collapsed} collapsedWidth={64}>
        <div className="brand">
          <SafetyOutlined style={{ fontSize: 22 }} />
          {!collapsed && (
            <>
              邻伴 · 管理后台
              <span className="brand-sub">v1.0</span>
            </>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activePath]}
          defaultOpenKeys={currentGroup ? [`group-${currentGroup}`] : []}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <Space>
            <span
              style={{ cursor: 'pointer', fontSize: 16 }}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <Breadcrumb
              items={[
                { title: '邻伴' },
                ...(current?.meta.group ? [{ title: current.meta.group }] : []),
                { title: current?.meta.title ?? '页面' },
              ]}
            />
          </Space>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: () => {
                    logout();
                    navigate('/login', { replace: true });
                  },
                },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: '#d4380d' }}>
                {(admin?.realName ?? 'U')[0]}
              </Avatar>
              <Typography.Text strong>{admin?.realName}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {admin?.roleName}
              </Typography.Text>
              <DownOutlined style={{ fontSize: 10 }} />
            </Space>
          </Dropdown>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
