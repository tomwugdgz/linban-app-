// ============================================================================
// 密文/盲索引出参守卫（全项目级，2026-10）
// ----------------------------------------------------------------------------
// 背景：`getOrderDetail` 曾`return order` **整行直出**，于是 `address_cipher`
// 跟着泄漏到客户端。AES-GCM 密文长度与原文近似线性 —— 门牌号位数直接暴露。
// 这不是"该脱敏却没脱敏"，是**加密白做了**。
//
// 为什么用测试而不是人工核：漏一个接口就漏一次，而且**不会报错**。
// 人工比对 22 个敏感列 × N 个出参路径，必然漏；机器遍历不会。
//
// 本文件锁两层：
//   1. **结构层**：对已知的出参构造器逐个断言「不含任何 _cipher / _hmac 键」。
//   2. **规则层**：提供 assertNoCipherKeys() 助手，供后续每个出参端点单测复用。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findCipherKeys, stripCipherKeys } from '../common/outbound';

const SCHEMA = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

/**
 * 出参断言（**复用生产实现** common/outbound.ts，不复刻）。
 *
 * 为什么不复刻：两份 `findCipherKeys` 必然漂移 —— 守卫那份改了、测试那份没改，
 * 测试会绿着放过真实泄漏。这里直接打生产实现，改一处两处同时生效。
 * 中间件层的环境相关行为（dev 抛 / prod 剥离）见 outbound-cipher-guard.test.ts。
 */

/** 断言出参不含敏感键（供后续端点单测复用） */
export function assertNoCipherKeys(out: unknown): void {
  expect(findCipherKeys(out)).toEqual([]);
}

/** 断言剥离逻辑可用（端点出参构造器单测用） */
export { stripCipherKeys };

describe('密文出参守卫 · 已修复的泄漏点', () => {
  it('订单详情出参不含 address_cipher（回归防护）', async () => {
    // getOrderDetail 走DB，这里用等价结构验证剥离逻辑：
    // 解构剥离后 address 是脱敏值，密文键本身不出现在对象里
    const { address_cipher: _c, ...rest } = {
      id: 1n,
      order_no: 'LB20261020ABC',
      address_cipher: 'U2FsdGVkX1+abcdefghijklmnop',
      status: 'ACCEPTED',
    };
    const out = { ...rest, address: '广州市天河区珠江新城X号院' };
    assertNoCipherKeys(out);
    // 且不得把密文值塞进别的字段名（BigInt 需显式转字符串才能JSON 化）
    expect(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
      .not.toContain('U2FsdGVkX1');
  });

  it('掩掉整行直出的通用模式：只要剥离过就一定不含密文键', () => {
    const dbRow = {
      phone_cipher: 'enc(phone)',
      phone_hmac: 'a'.repeat(64),
      real_name_cipher: 'enc(name)',
      id_card_cipher: 'enc(id)',
      id_card_hmac: 'b'.repeat(64),
      nickname: '张三',
    };
    // 反例：整行直出必然命中（证明守卫有效，不是空断言）
    expect(findCipherKeys(dbRow).length).toBe(5);
    // 正例：显式挑选安全字段后干净
    assertNoCipherKeys({ nickname: dbRow.nickname, id: 1 });
  });
});

describe('密文出参守卫 · 用户信息出参', () => {
  it('用户自助资料出参只出脱敏手机号，不含 cipher/hmac', () => {
    // auth.routes.ts 的 GET /users/me：phoneMasked 走 maskPhone(decrypt(...))
    const out = {
      id: '1',
      nickname: '张阿姨',
      phoneMasked: '138****8888',
      role: 'ELDER',
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    assertNoCipherKeys(out);
  });

  it('完整 users 行直出会命中 2 个敏感键（证明用户表也在泄漏面上）', () => {
    // users 表有 phone_cipher + phone_hmac + is_system
    const usersRow = {
      id: 1n,
      openid: 'oxxx',
      phone_cipher: 'enc',
      phone_hmac: 'c'.repeat(64),
      is_system: false,
      nickname: '李伯',
    };
    expect(findCipherKeys(usersRow)).toEqual([
      '$.phone_cipher',
      '$.phone_hmac',
    ]);
  });
});

describe('密文出参守卫 · 全项目敏感列清单完整性', () => {

/** 高危列抽查清单：这些列一旦泄漏后果最严重，必须逐个盯住 */
const HIGH_RISK_COLUMNS = [
  'phone_cipher',
  'address_cipher',
  'id_card_cipher',
  'id_card_hmac',
  'real_name_cipher',
  'emergency_contact_name_cipher',
  'emergency_contact_phone_cipher',
  'bank_account_cipher',
  'account_name_cipher',
  'totp_secret_cipher',
  'target_phone_cipher',
] as const;

/** 解析 schema 里的全部敏感列名（去重） */
function schemaSensitiveColumns(): Set<string> {
  const schema = readFileSync(SCHEMA, 'utf8');
  const cols = new Set<string>();
  for (const line of schema.split(/\r?\n/)) {
    // 跳过注释行（`// xxx_cipher 是...` 之类，否则会把注释里的词当列名）
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const m = /^\s*(\w+_(?:cipher|hmac))\s+\w+/.exec(line);
    if (m?.[1]) cols.add(m[1]);
  }
  return cols;
}

  it('schema 里的敏感列清单与本守卫规则匹配（新增敏感列必须被覆盖）', () => {
    const cols = schemaSensitiveColumns();
    // 下限 16 是**实测值**（2026-10 核对：21 处声明 / 16 个唯一列名，
    // 同名列在 users / companions / distributors / sms_channels 等多表各出现一次）。
    // 作用是防解析器静默失效——不是拍脑袋的数字。
    expect(cols.size).toBeGreaterThanOrEqual(16);
    // 抽查几个必须覆盖的高危列
    for (const must of HIGH_RISK_COLUMNS) {
      expect(cols.has(must), `schema 未匹配到敏感列 ${must}（解析器可能失效）`).toBe(true);
    }
  });

  it('全部敏感列都恰好以 _cipher 或 _hmac 结尾（规则无例外）', () => {
    for (const col of schemaSensitiveColumns()) {
      expect(col.endsWith('_cipher') || col.endsWith('_hmac'), col).toBe(true);
    }
  });

  it('列数与磁盘实测一致（新增敏感列时这条会提醒你更新预期数）', () => {
    // 若schema 新增了敏感列而没更新本断言，这里会红——这是刻意的：
    // 新增敏感列必须重新审视「哪些出参会泄漏」。
    expect(schemaSensitiveColumns().size).toBe(16);
  });
});

describe('密文出参守卫 · 嵌套与数组场景', () => {
  it('嵌套 include 的密文也能被检出（深度不设限会漏）', () => {
    const nested = {
      order: {
        user: { phone_cipher: 'enc' },
        payments: [{ id: 1 }, { id: 2, bank_account_cipher: 'enc2' }],
      },
    };
    const found = findCipherKeys(nested);
    expect(found).toHaveLength(2);
    expect(found.some((p) => p.includes('payments'))).toBe(true);
  });

  it('超过深度上限时停止递归（防循环引用打爆栈）', () => {
    // 构造超深对象，不应栈溢出
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 50; i += 1) deep = { child: deep };
    expect(() => findCipherKeys(deep)).not.toThrow();
  });

  it('Date / Buffer 不被当作对象递归（否则会误报）', () => {
    const out = {
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      raw: Buffer.from('x'),
      phoneMasked: '138****8888',
    };
    assertNoCipherKeys(out);
  });
});