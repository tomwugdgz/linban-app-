// ============================================================================
// 邻伴 · 出参密文守卫（common 层，2026-10）
// ----------------------------------------------------------------------------
// 为什么这层要存在：
//
//  `getOrderDetail` 曾`return order` **整行直出**，于是 `address_cipher`
//  跟着泄漏到客户端。AES-GCM 密文长度与原文近似线性 —— 门牌号几位、身份证
//  几位，从密文字符串长度就能推出来。这不是"该脱敏却没脱敏"，是**加密白做了**。
//
// 为什么不能只靠人工核 / 只靠单测：
//  1. 人工比对16 个敏感列 × N 个出参路径，必然漏；
//  2. 单测只能覆盖"已经想到要测的端点"，新写的端点不在测试里就漏；
//  3. 两者的共同失败模式都是**不报错** —— 泄漏了没有任何信号。
//  所以守卫必须下沉到**出参那一刻**，对新端点零成本生效：
//
//  ```
//  guard: strip 密文键 → 非生产环境抛错（让开发者立刻看见）→
//         生产环境记 error 日志并放行已剥离的干净副本
//  ```
//
//  关键设计取舍：**永远不把密文发出去**（生产也strip），抛错只发生在
//  dev/test。因为「让请求 500」在生产等于把一次泄漏变成一次可用性故障，
//  而剥离 + 告警既不漏数据又能让人立刻定位。
// ============================================================================

/** 敏感列命名后缀（口径来源：prisma/schema.prisma 的注释约定） */
export const SENSITIVE_KEY_SUFFIXES = ['_cipher', '_hmac'] as const;

/** 递归查找出参中的敏感键（返回 JSONPath 风格路径） */
export function findCipherKeys(
  value: unknown,
  path = '$',
  depth = 8,
  found: string[] = [],
): string[] {
  if (depth < 0 || value === null || value === undefined) return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findCipherKeys(v, `${path}[${i}]`, depth - 1, found));
    return found;
  }
  if (typeof value !== 'object') return found;
  if (value instanceof Date || Buffer.isBuffer(value)) return found;
  if (typeof PrismaDecimalLike(value) === 'object') {
    // Prisma.Decimal：只有 toString 能取到值，且不含敏感列，跳过避免误报
    return found;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k)) found.push(`${path}.${k}`);
    findCipherKeys(v, `${path}.${k}`, depth - 1, found);
  }
  return found;
}

/** key 是否敏感（`_cipher` / `_hmac` 结尾） */
export function isSensitiveKey(key: string): boolean {
  return (SENSITIVE_KEY_SUFFIXES as readonly string[]).some((s) => key.endsWith(s));
}

/**
 * 判断是否 Prisma.Decimal（用 duck-typing 而非 import，避免 common 层依赖 @prisma/client）
 */
function PrismaDecimalLike(value: object): boolean {
  const v = value as { constructor?: { name?: string }; toFixed?: unknown };
  return typeof v.toFixed === 'function' && v.constructor?.name === 'Decimal';
}

/**
 * 深拷贝并剥离所有敏感键。
 * 返回 `{ data, stripped }` —— stripped 是被剥掉的路径，供日志/告警定位。
 *
 * 注意：**不改动入参**（Object.assign 到新对象），否则调用方的局部变量
 * 也被削掉，后续代码想用 `order.address_cipher` 就找不到了 ——
 * 那是"守卫把业务代码改坏了"，属于更隐蔽的故障。
 */
export function stripCipherKeys<T>(value: T, depth = 8): { data: T; stripped: string[] } {
  const stripped: string[] = [];

  const walk = (v: unknown, path: string, d: number): unknown => {
    if (d < 0 || v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, d - 1));
    if (typeof v !== 'object') return v;
    if (v instanceof Date || Buffer.isBuffer(v)) return v;
    if (PrismaDecimalLike(v)) return v;

    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        stripped.push(`${path}.${k}`);
        continue;
      }
      out[k] = walk(val, `${path}.${k}`, d - 1);
    }
    return out;
  };

  return { data: walk(value, '$', depth) as T, stripped };
}

/**
 * 出参守卫抛出的错误（非生产环境）。
 * 用独立 Error 类型而非 AppError：这不是业务错误，是**开发期缺陷**，
 * 不该占用 22xxx/23xxx 号段，也不该给客户端一个"参数错误"的误导。
 */
export class OutboundCipherLeakError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `出参含密文字段，已阻断响应：${paths.join(', ')}\n` +
        '修复：该端点必须显式挑选安全字段（禁止 return prisma.xxx.findMany() 直出）。\n' +
        '确需输出明文请走 maskPhone/maskAddress 等脱敏函数，不要直出 _cipher 列。',
    );
    this.name = 'OutboundCipherLeakError';
    this.paths = paths;
  }
}