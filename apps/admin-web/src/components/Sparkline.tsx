// ============================================================================
// Sparkline：行内迷你折线（SVG 自绘，零依赖、零实例开销）
// ----------------------------------------------------------------------------
// 为什么不用 ECharts：老人活动列表一页 20–50 行，每行一个 ECharts 实例会带来
// ~1MB 依赖 + 数十个 canvas 上下文，滚动明显掉帧。行内 sparkline 只需折线形状，
// SVG polyline 足够，且天然随容器缩放、无需 resize 监听。
// 折线下方填色用 linearGradient，视觉上与主看板 ECharts 保持同一语言。
// ============================================================================
interface Props {
  /** 数据序列（老人列表传近 7 日活跃分钟） */
  data: number[];
  width?: number;
  height?: number;
  /** 折线颜色；缺省取状态语义色 */
  color?: string;
  /** 目标线（如久静阈值 2 分钟），画成虚线参考 */
  threshold?: number;
}

export function Sparkline({ data, width = 108, height = 28, color = '#0958d9', threshold }: Props) {
  if (!data.length) return <span style={{ color: 'rgba(0,0,0,0.25)' }}>-</span>;
  const max = Math.max(...data, threshold ?? 0, 1);
  // 上下各留 2px 内边距，避免极值贴边看不清
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `0,${height} ${points} ${width},${height}`;
  const gid = `spark-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }} role="img" aria-label="近 7 日趋势">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {threshold !== undefined && threshold <= max && (
        <line
          x1={0}
          x2={width}
          y1={y(threshold)}
          y2={y(threshold)}
          stroke="#bfbfbf"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      )}
      <polygon points={area} fill={`url(#${gid})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}