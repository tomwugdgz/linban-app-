// ============================================================================
// 邻伴 · BigInt 序列化助手（common 层，schema 实现注意 a）
// ----------------------------------------------------------------------------
// 铁律：金额/ID 为 BigInt，JSON.stringify 直接抛
// "Do not know how to serialize a BigInt" —— 所有 API 出参必须经本模块
// 统一转字符串，杜绝浮点与精度丢失。
// ============================================================================

/** 单值：BigInt → string（其余原样） */
export function bigintToString(v: bigint): string {
  return v.toString();
}

/** 任意结构深拷贝转换：BigInt 一律转 string（用于 res.json 前） */
export function serializeBigInts<T>(value: T): T {
  if (typeof value === 'bigint') {
    return value.toString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => serializeBigInts(v)) as unknown as T;
  }
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Decimal 列经 Prisma 以 Decimal.js 对象返回（toJSON 存在时优先）
      if (v && typeof v === 'object' && 'toJSON' in (v as object) && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
        out[k] = (v as { toJSON: () => unknown }).toJSON();
        continue;
      }
      out[k] = serializeBigInts(v);
    }
    return out as T;
  }
  return value;
}

/** JSON.stringify 的安全 replacer（BigInt → string） */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** 安全 stringify（不会因 BigInt 抛错） */
export function safeJsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, bigintReplacer, space);
}

/** 金额入参解析：前端 string/number → BigInt（分）。
 *  拒绝浮点（含小数点的字符串/number）—— 金额必须整分。 */
export function parseFen(input: string | number | bigint): bigint {
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      throw new Error(`金额必须为整数分，收到浮点: ${input}`);
    }
    return BigInt(input);
  }
  const s = String(input).trim();
  if (!/^-?\d+$/.test(s)) {
    throw new Error(`金额必须为整数字符串（分），收到: "${input}"`);
  }
  return BigInt(s);
}

/** BigInt → number（仅在 ≤2^53 安全时；超限抛错，防止静默丢精度） */
export function bigintToSafeNumber(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`BigInt ${v} 超出 Number 安全范围，禁止转换`);
  }
  return Number(v);
}
