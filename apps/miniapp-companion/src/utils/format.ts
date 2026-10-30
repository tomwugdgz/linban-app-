// ============================================================================
// 格式化工具：金额（分→元）/ 时间（UTC→Asia/Shanghai）/ 时长 / 距离
// ----------------------------------------------------------------------------
// 约定：
// - 金额一律「分」为单位的字符串，展示层才转「元」（schema 约定 1）；
// - 时间统一存 UTC，展示转 Asia/Shanghai（DATABASE.md §2.6）；
// - service_date 为广州本地日期（"YYYY-MM-DD"），不做时区换算。
// ============================================================================

/** 分 → 元（字符串入，字符串出，禁浮点误差） */
export function fenToYuan(fen: string | number, withSymbol = false): string {
  const n = typeof fen === 'string' ? Number(fen) : fen
  if (!Number.isFinite(n)) return withSymbol ? '¥0.00' : '0.00'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(Math.round(n))
  const yuan = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${sign}${withSymbol ? '¥' : ''}${yuan}.${cents}`
}

/** 元 → 分（输入校验后取整） */
export function yuanToFen(yuan: string | number): number {
  const n = typeof yuan === 'string' ? Number(yuan) : yuan
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/** "2026-09-25" → "9月25日" */
export function formatDateCN(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** "2026-09-25" → "09-25 周五" */
export function formatDateWithWeekday(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${week}`
}

/** ISO(UTC) → "HH:mm"（本地展示） */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** ISO(UTC) → "MM-DD HH:mm" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '----'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / MM-DD */
export function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return formatDateTime(iso)
}

/** 分钟 → "1 小时 30 分钟"（适老大写中文） */
export function durationText(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

/** 距离（米）→ 适老文案 */
export function distanceText(meters: number): string {
  if (meters < 1000) return `${meters} 米`
  return `${(meters / 1000).toFixed(1)} 公里`
}

/** 手机号脱敏（架构 §5.3 L3：端上只展示脱敏号） */
export function maskPhone(phone?: string): string {
  if (!phone || phone.length < 7) return phone || ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

/** 本地日期解析（"YYYY-MM-DD" 按本地时区，避免 UTC 偏移一天） */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** 生成未来 N 天日期串（"YYYY-MM-DD"） */
export function nextDays(n: number, from = new Date()): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** 评分展示（1 位小数，schema Decimal(2,1)） */
export function ratingText(avg: number): string {
  return avg > 0 ? avg.toFixed(1) : '新'
}
