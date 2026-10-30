// ============================================================================
// 格式化工具：金额（分→元）、时间（UTC 存储 → Asia/Shanghai 展示，schema 约定 3）
// ============================================================================
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/** 分（字符串，防 BigInt 精度丢失）→ 「¥12.34」；非法值返回 '-' */
export function fenToYuan(fen?: string | number | null): string {
  if (fen === undefined || fen === null || fen === '') return '-';
  const n = typeof fen === 'number' ? Math.round(fen) : Number(fen);
  if (Number.isNaN(n)) return '-';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const cent = String(abs % 100).padStart(2, '0');
  return `${sign}¥${yuan.toLocaleString('zh-CN')}.${cent}`;
}

/** 分 → 不带符号的数值字符串（图表轴用） */
export function fenToYuanNumber(fen?: string | null): number {
  const n = Number(fen ?? 0);
  return Number.isNaN(n) ? 0 : n / 100;
}

/** bp（基点，500=5%）→ 「5%」 */
export function bpToPercent(bp?: number | null): string {
  if (bp === undefined || bp === null) return '-';
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** DECIMAL 字符串（"0.05"）→ bp（500），抽成配置编辑用 */
export function decimalToBp(v: string): number {
  return Math.round(Number(v) * 10000);
}

/**
 * bp（500）→ DECIMAL 字符串（"0.05"），**整数运算**。
 *
 * 为什么不能用 `(bp/10000).toFixed(4)`：浮点数在 0.05 这类值上
 * 会得到 "0.0500" 或 "0.0499"，写回 DB 后配置就漂了。这里用
 * 「除- 取余 - 补零」拼串，结果与入参严格互逆。
 */
export function bpToDecimal(bp: string | number): string {
  const n = Math.round(Number(bp));
  if (!Number.isFinite(n)) return '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  const intPart = Math.floor(abs / 10000);
  const frac = String(abs % 10000).padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${intPart}${frac ? `.${frac}` : ''}`;
}

/** UTC ISO 字符串 → 东八区展示（schema 约定：库内 UTC，仅展示层转换） */
export function fmtTime(iso?: string | null, pattern = 'YYYY-MM-DD HH:mm:ss'): string {
  if (!iso) return '-';
  const d = dayjs.utc(iso);
  if (!d.isValid()) return '-';
  return d.add(8, 'hour').format(pattern);
}

export function fmtDate(iso?: string | null): string {
  return fmtTime(iso, 'YYYY-MM-DD');
}

/** 相对时间（如「3 分钟前」），看板/审计列表用 */
export function fmtRelative(iso?: string | null): string {
  if (!iso) return '-';
  const d = dayjs.utc(iso).add(8, 'hour');
  if (!d.isValid()) return '-';
  const diffMin = dayjs().diff(d, 'minute');
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
  if (diffMin < 43200) return `${Math.floor(diffMin / 1440)} 天前`;
  return d.format('YYYY-MM-DD');
}

/** 时长（分钟）→ 「1.5 小时」/「45 分钟」 */
export function fmtDuration(minutes?: number | null): string {
  if (!minutes && minutes !== 0) return '-';
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
}
