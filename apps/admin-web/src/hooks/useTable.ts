// ============================================================================
// useTable：列表页通用数据 hook（分页/筛选/加载/错误态/刷新）
// 收敛各页面重复的「请求 + 状态」样板，页面只声明 fetcher 与初始筛选。
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageQuery, PageResult } from '@/shared/types';

export interface UseTableOptions<T, F extends object> {
  fetcher: (params: PageQuery & F) => Promise<PageResult<T>>;
  initialFilters?: Partial<F>;
  pageSize?: number;
  /** 依赖 key 变化时自动重新请求（如路由参数） */
  deps?: unknown[];
}

export function useTable<T, F extends object = Record<string, never>>({
  fetcher,
  initialFilters,
  pageSize = 20,
  deps = [],
}: UseTableOptions<T, F>) {
  const [list, setList] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [filters, setFilters] = useState<F>((initialFilters ?? {}) as F);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (p = page, s = size, f = filters) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetcherRef.current({ page: p, pageSize: s, ...f } as PageQuery & F);
        setList(res.list);
        setTotal(res.total);
        setPage(res.page);
        setSize(res.pageSize);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
        setList([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [page, size, filters],
  );

  useEffect(() => {
    void load(1, size, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, size, ...deps]);

  return {
    list,
    total,
    page,
    pageSize: size,
    loading,
    error,
    filters,
    setFilters,
    /** 筛选变更（重置到第一页） */
    search: (next: Partial<F>) => setFilters((prev) => ({ ...prev, ...next }) as F),
    /** 重置筛选 */
    reset: () => setFilters((initialFilters ?? {}) as F),
    /** 翻页 */
    changePage: (p: number, s: number) => {
      setSize(s);
      void load(p, s, filters);
    },
    /** 操作后原地刷新当前页 */
    refresh: () => void load(page, size, filters),
    retry: () => void load(page, size, filters),
  };
}
