// ============================================================================
// 格式化工具：金额（分→元）/ 时间（UTC→Asia/Shanghai）/ 时长 / 距离
// ----------------------------------------------------------------------------
// 约定：
// - 金额一律「分」为单位的字符串，展示层才转「元」（schema 约定 1）；
// - 时间统一存 UTC，展示转 Asia/Shanghai（DATABASE.md §2.6）；
// - service_date 为广州本地日期（"YYYY-MM-DD"），不做时区换算。
// ============================================================================

/**
 * 分 → 元（字符串入，字符串出，禁浮点误差）
 *
 * ⚠️ 必须用 **BigInt** 做整数运算，不能用 Number：
 *   金额在契约里是 BigInt 序列化出来的字符串（shared dto.ts:5：
 *   「金额字段一律 string（BigInt 序列化），禁止 number，杜绝浮点与精度丢失」），
 *   其量级可以超过 2^53 —— 而 Number 的安全整数上限就是 2^53-1。
 *   实测（format.test.ts 抓到）：Number('9007199254740993') → 9007199254740992，
 *   分→元后少 1 分（...09.92 而非 ...09.93）。
 *   ⇒ 这不是「极端情况下的理论问题」，是**金额少算 1 分**的资损风险。
 *
 * 顺带说明：字符串 → BigInt 对非数字输入会抛 SyntaxError，
 * 所以先用正则校验「纯整数」（含可选负号），不合法一律兜底 0.00。
 */
export function fenToYuan(fen: string | number, withSymbol = false): string {
  const raw = typeof fen === 'string' ? fen.trim() : String(fen)
  // 只接受纯整数（含可选负号）；小数、空串、NaN、Infinity 一律兜底
  if (!/^-?\d+$/.test(raw)) return withSymbol ? '¥0.00' : '0.00'
  let n: bigint
  try {
    n = BigInt(raw)
  } catch {
    return withSymbol ? '¥0.00' : '0.00'
  }
  const sign = n < 0n ? '-' : ''
  const abs = n < 0n ? -n : n
  const yuan = abs / 100n
  const cents = (abs % 100n).toString().padStart(2, '0')
  return `${sign}${withSymbol ? '¥' : ''}${yuan.toString()}.${cents}`
}

/**
 * 元 → 分（输入校验后取整）
 *
 * 同样走 BigInt（避免大额乘 100 后丢精度）。
 * 返回 string 而非 number —— 调用方若需要数字语义请自行处理，
 * 但**金额字段在契约里必须是 string**（shared dto.ts:5），故此处返回 string 更安全。
 */
export function yuanToFen(yuan: string | number): string {
  const raw = typeof yuan === 'string' ? yuan.trim() : String(yuan)
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return '0'
  const neg = raw.startsWith('-')
  const [intPart, decPart = ''] = raw.replace('-', '').split('.')
  const intFen = BigInt(intPart || '0') * 100n
  // 小数部分补齐到 2 位再取整（0.1 → 10 分；0.005 → 1 分，四舍五入）
  const padded = (decPart + '00').slice(0, 3)
  const fracFen = BigInt(padded.slice(0, 2) || '0')
  const roundUp = Number(padded[2] || '0') >= 5
  let total = intFen + fracFen + (roundUp ? 1n : 0n)
  if (neg) total = -total
  return total.toString()
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
