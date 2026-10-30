// ============================================================================
// TrendChart：ECharts 趋势图封装（GMV 柱 + 订单量线，双 Y 轴）
// 单独分包 echarts（vite manualChunks），避免拖慢首屏。
// ============================================================================
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import type { TrendPoint } from '@/shared/types';
import { fenToYuanNumber } from '@/shared/format';

interface Props {
  data: TrendPoint[];
  loading?: boolean;
}

export function TrendChart({ data, loading }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current);
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const option: EChartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { data: ['GMV（元）', '订单量', '平台抽成（元）'], top: 0 },
      grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date.slice(5)),
        axisTick: { alignWithLabel: true },
      },
      yAxis: [
        { type: 'value', name: '金额（元）', splitLine: { lineStyle: { type: 'dashed' } } },
        { type: 'value', name: '订单量', minInterval: 1, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'GMV（元）',
          type: 'bar',
          data: data.map((d) => fenToYuanNumber(d.gmvFen)),
          itemStyle: { color: '#d4380d', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
        {
          name: '平台抽成（元）',
          type: 'bar',
          data: data.map((d) => fenToYuanNumber(d.profitFen)),
          itemStyle: { color: '#ffc069', borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 22,
        },
        {
          name: '订单量',
          type: 'line',
          yAxisIndex: 1,
          data: data.map((d) => d.orderCount),
          smooth: true,
          itemStyle: { color: '#0958d9' },
          lineStyle: { width: 2 },
        },
      ],
    };
    chartRef.current.setOption(option, true);
  }, [data]);

  if (loading) return <div className="chart-box" />;
  return <div className="chart-box" ref={ref} />;
}
