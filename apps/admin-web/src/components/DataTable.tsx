// ============================================================================
// DataTable：表格容器封装（统一空态/错误态/分页/刷新）
// 布局：页面容器 → 筛选区(children) → Table → Pagination
//
// 【空态的三分法】这是本组件最要紧的设计决定，不能简化：
// 「列表为空」在业务上至少有三种**完全不同**的含义，混成一句「暂无数据」会误导运营：
//
//   1. clean   —— 该状态下本来就没有待处理的事（好事）
//                 例：客服台「超时订单」为空 = 没有派单超时的单子，系统正常
//   2. filtered —— 有数据但被当前筛选条件过滤掉了（要引导用户改条件）
//                 例：筛选「状态=挂起」后为空，运营以为系统里没有挂起单
//   3. none    —— 真的没数据（新功能/未接数据源/权限范围外）
//
// 三者若都显示「暂无数据」，运营分不清「系统正常」和「我筛选错了」和「功能没通」，
// 会去提工单或误判业务。所以 clean/filtered 允许页面覆写，none 用中性默认文案。
// ============================================================================
import { Alert, Button, Empty, Skeleton, Table } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';

export type EmptyKind = 'none' | 'clean' | 'filtered';

interface Props<T> extends TableProps<T> {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** 分页由 useTable 驱动；传 total/page 时启用内置分页 */
  total?: number;
  /**
   * 覆盖分页器左侧的总数文案。**当 total 的语义不是「全库条数」时必须传**。
   *
   * 典型场景：`operator` / `keyword` 只能应用层筛的端点，服务端候选集有上限，
   * `total` 其实是候选集条数（契约 §5.7.7 明文禁止把它当 total 展示）。
   * 默认的「共 N 条」在这里是**精确传达了错误语义**——所以必须由页面改成
   * 「候选集 N 条」之类，不能靠运营自己推断。
   */
  totalText?: (total: number) => string;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number, pageSize: number) => void;
  /**
   * 空态语义（默认 none）。页面应按业务实际选，不要一律用默认值：
   * - 'clean'    该状态本来就没有待办，显示绿色对勾 +「当前无待处理事项」
   * - 'filtered' 有数据但被筛掉，提示「可能是筛选条件过窄」
   */
  emptyKind?: EmptyKind;
  /** emptyKind 之外的自定义文案（覆盖默认描述） */
  emptyText?: React.ReactNode;
}

export function DataTable<T extends object>({
  loading,
  error,
  onRetry,
  total,
  totalText,
  page,
  pageSize,
  onPageChange,
  emptyKind = 'none',
  emptyText,
  ...rest
}: Props<T>) {
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="数据加载失败"
        description={error}
        action={
          onRetry ? (
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          ) : undefined
        }
      />
    );
  }
  const pagination =
    total !== undefined && onPageChange
      ? {
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showQuickJumper: true,
          // totalText 供「total 语义不是全库条数」的端点覆盖文案。
          // 契约 §5.7.7 禁止把候选集条数当 total 展示——默认「共 N 条」会精确地传达错误语义。
          showTotal: (t: number) => totalText?.(t) ?? `共 ${t} 条`,
          onChange: onPageChange,
        }
      : false;

  const renderEmpty = () => {
    if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
    if (emptyText) return <Empty description={emptyText} />;
    if (emptyKind === 'clean') {
      // 绿色对勾：让运营一眼看出「系统正常，没活干」，而不是「数据丢了」
      return (
        <Empty
          image={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 40 }} />}
          description={
            <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
              {emptyKind === 'clean' ? '当前无待处理事项' : ''}
            </span>
          }
        />
      );
    }
    if (emptyKind === 'filtered') {
      return (
        <Empty
          description={
            <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
              没有符合当前筛选条件的数据，可放宽条件后重试
            </span>
          }
        />
      );
    }
    return <Empty description="暂无数据" />;
  };

  return (
    <Table<T>
      {...rest}
      loading={loading ? { spinning: true } : false}
      pagination={pagination}
      locale={{ emptyText: renderEmpty() }}
    />
  );
}