// ============================================================================
// 出参密文守卫中间件单测（2026-10）
// ----------------------------------------------------------------------------
// 这组测试守的是「泄漏」这个失败模式。泄漏的特殊之处在于：
//   **它从不报错**。功能正常、测试通过、日志干净，只是数据出去了。
//   所以必须有机器守，人工核必然漏（16 个敏感列 × N 个出参路径）。
//
// 三层防线各测各的：
//   1. common/outbound.ts  —— 纯函数：查找 + 剥离
//   2. middlewares/outbound-cipher-guard.ts —— 中间件：dev 抛错 / prod 剥离
//   3. 出参纪律 —— A 组 19 个新端点的验收模板（见 response-discipline.test.ts）
//
// 本文件同时给「守卫本身有效」提供反例证明（注入泄漏 → 必须被拦）。
// ============================================================================

import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import {
  findCipherKeys,
  isSensitiveKey,
  stripCipherKeys,
  OutboundCipherLeakError,
  SENSITIVE_KEY_SUFFIXES,
} from '../common/outbound';
import { outboundCipherGuard, __setOutboundGuardProduction } from './outbound-cipher-guard';

/** 造一个最小可用的 res.json 桩 */
function stubRes(): { res: Response; sent: unknown[]; headers: Record<string, string> } {
  const sent: unknown[] = [];
  const headers: Record<string, string> = {};
  const res = {
    locals: { requestId: 'req-test' },
    statusCode: 200,
    setHeader(k: string, v: string) {
      headers[k] = v;
      return res;
    },
    json(body: unknown) {
      sent.push(body);
      return res;
    },
  };
  return { res: res as unknown as Response, sent, headers };
}

function stubReq(path = '/api/v1/admin/orders'): Request {
  return { method: 'GET', path } as unknown as Request;
}

/** 把中间件挂到 res 上（复用中间件真实逻辑，不复刻） */
function mount(res: Response, req: Request = stubReq()): void {
  outboundCipherGuard(req, res, () => {});
}

afterEach(() => {
  __setOutboundGuardProduction(false);
});

describe('纯函数 · findCipherKeys', () => {
  it('识别 _cipher 与 _hmac 两种后缀', () => {
    expect(isSensitiveKey('phone_cipher')).toBe(true);
    expect(isSensitiveKey('phone_hmac')).toBe(true);
    expect(isSensitiveKey('nickname')).toBe(false);
    expect(isSensitiveKey('ciphertext')).toBe(false); // 前缀不算
    expect(isSensitiveKey('phone_ciphertext')).toBe(false); // 后缀不算
  });

  it('敏感后缀表只有两项（新增需同步改schema 口径）', () => {
    expect(SENSITIVE_KEY_SUFFIXES).toEqual(['_cipher', '_hmac']);
  });

  it('整行直出必被检出（反例：证明守卫不是空断言）', () => {
    const row = {
      id: 1n,
      phone_cipher: 'enc',
      phone_hmac: 'h'.repeat(64),
      real_name_cipher: 'enc2',
      nickname: '张三',
    };
    expect(findCipherKeys(row)).toEqual([
      '$.phone_cipher',
      '$.phone_hmac',
      '$.real_name_cipher',
    ]);
  });

  it('嵌套与数组里的密文也能检出', () => {
    const nested = {
      order: {
        user: { phone_cipher: 'e1' },
        payments: [{ id: 1 }, { bank_account_cipher: 'e2' }],
      },
    };
    const found = findCipherKeys(nested);
    expect(found).toHaveLength(2);
    expect(found.some((p) => p.includes('payments'))).toBe(true);
  });

  it('Date / Buffer / 超深结构不误报也不爆栈', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 60; i += 1) deep = { child: deep };
    expect(() => findCipherKeys(deep)).not.toThrow();
    expect(findCipherKeys({ createdAt: new Date(), raw: Buffer.from('x') })).toEqual([]);
  });
});

describe('纯函数 · stripCipherKeys', () => {
  it('剥离敏感键并报告路径', () => {
    const { data, stripped } = stripCipherKeys({
      id: 1,
      phone_cipher: 'enc',
      profile: { real_name_cipher: 'enc2', nickname: '张阿姨' },
    });
    expect(stripped).toEqual(['$.phone_cipher', '$.profile.real_name_cipher']);
    expect(findCipherKeys(data)).toEqual([]);
    expect((data as { profile: { nickname: string } }).profile.nickname).toBe('张阿姨');
  });

  it('不改动入参（守卫不得削掉调用方的局部变量）', () => {
    const src = { id: 1, phone_cipher: 'enc' };
    stripCipherKeys(src);
    // 调用方后续还要用 address_cipher 做内部逻辑，被削掉就是"守卫改坏了业务"
    expect(src.phone_cipher).toBe('enc');
  });

  it('已干净的出参不被改写（原样返回，零开销）', () => {
    const src = { id: '1', nickname: '张阿姨' };
    const { data, stripped } = stripCipherKeys(src);
    expect(stripped).toEqual([]);
    expect(data).toEqual(src);
  });
});

describe('中间件 · 开发环境（抛错阻断）', () => {
  it('出参含密文时抛 OutboundCipherLeakError，且不写出响应', () => {
    const { res, sent } = stubRes();
    mount(res);
    expect(() => res.json({ code: 0, data: { address_cipher: 'enc' } })).toThrow(
      OutboundCipherLeakError,
    );
    // 关键：响应**没有**被写出去 —— 半截响应比整块泄漏更难排查
    expect(sent).toHaveLength(0);
  });

  it('错误信息里带路径，且给出修复指引', () => {
    const { res } = stubRes();
    mount(res);
    try {
      res.json({ data: { user: { id_card_cipher: 'x' } } });
      throw new Error('本应抛出');
    } catch (e) {
      const err = e as OutboundCipherLeakError;
      expect(err.paths).toEqual(['$.data.user.id_card_cipher']);
      expect(err.message).toContain('显式挑选安全字段');
    }
  });

  it('干净出参原样放行（守卫不得误伤正常业务）', () => {
    const { res, sent } = stubRes();
    mount(res);
    const body = { code: 0, data: { id: '1', phoneMasked: '138****8888' }, requestId: 'r' };
    res.json(body);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(body);
  });

  it('这正是 getOrderDetail 曾经的写法 —— 现在会被当场拦下（回归防护）', () => {
    const { res } = stubRes();
    mount(res, stubReq('/api/v1/admin/orders/123'));
    // order 整行直出
    expect(() =>
      res.json({
        code: 0,
        data: {
          id: 1n,
          order_no: 'LB20261020ABC',
          address_cipher: 'U2FsdGVkX1+abcdefghijklmnop',
          status: 'ACCEPTED',
        },
      }),
    ).toThrow(OutboundCipherLeakError);
  });
});

describe('中间件 · 生产环境（剥离 + 主动告警 + 打标记，不阻断可用性）', () => {
  it('剥离后放行干净副本，路径进日志', () => {
    __setOutboundGuardProduction(true);
    const { res, sent } = stubRes();
    mount(res);
    res.json({ code: 0, data: { id: 1, address_cipher: 'enc', order_no: 'LB1' } });
    expect(sent).toHaveLength(1);
    const body = sent[0] as { data: Record<string, unknown> };
    expect(body.data).toEqual({ id: 1, order_no: 'LB1' });
    expect(findCipherKeys(body)).toEqual([]);
  });

  it('生产也不得因泄漏而500（可用性优先于"报个错"）', () => {
    __setOutboundGuardProduction(true);
    const { res } = stubRes();
    mount(res);
    expect(() => res.json({ data: { phone_cipher: 'e' } })).not.toThrow();
  });

  it('响应头打 X-Outbound-Sanitized: true（前端/网关可观测）', () => {
    __setOutboundGuardProduction(true);
    const { res, headers } = stubRes();
    mount(res);
    res.json({ data: { phone_cipher: 'e' } });
    expect(headers['X-Outbound-Sanitized']).toBe('true');
  });

  it('干净出参不打该标记（标记只服务于"被动过的响应"）', () => {
    __setOutboundGuardProduction(true);
    const { res, headers } = stubRes();
    mount(res);
    res.json({ code: 0, data: { id: '1' } });
    expect(headers['X-Outbound-Sanitized']).toBeUndefined();
  });

  it('生产环境干净出参同样原样放行（守卫不引入行为差异）', () => {
    __setOutboundGuardProduction(true);
    const { res, sent } = stubRes();
    mount(res);
    res.json({ code: 0, data: { id: '1' } });
    expect(sent[0]).toEqual({ code: 0, data: { id: '1' } });
  });

  it('开发环境不落告警也不打标记（泄漏当场抛，不需要事后追溯）', () => {
    const { res, headers } = stubRes();
    mount(res);
    expect(() => res.json({ data: { phone_cipher: 'e' } })).toThrow();
    expect(headers['X-Outbound-Sanitized']).toBeUndefined();
  });
});

describe('主动告警落库 · hit_detail 纪律', () => {
  it('告警明细只含路径与键名，绝不含字段值（告警记录本身不得成为新泄漏源）', async () => {
    const src = readFileSync(
      fileURLToPath(new URL('./outbound-cipher-guard.ts', import.meta.url)),
      'utf8',
    );
    // hit_detail 块内不得出现任何"把 paths 的值塞进明细"的写法
    //
    // ⚠️ 2026-10 改写（承钧「断言数据源优先级」裁定的落地）：
    //   原写法 `[\s\S]*?\n {8}\}` **硬编码了 8 空格缩进**——
    //   被测文件改一级缩进（Prettier 重排、调整嵌套层级）就失配。
    //   失配本身会红（有 toBeDefined 守卫），但**红因是"缩进变了"而不是
    //   "密文泄漏了"** —— 会把排查方向带偏，属承钧所说「断言红因错误」。
    //   改法：用**内容锚点**定位块尾（`hit_detail:` 之后到下一个 `},`，
    //   靠「非贪婪匹配 + 首个 `},`」而非任何缩进量）；
    //   并保留 toBeDefined 守卫（匹配不到就红，不静默通过）。
    const detail = /hit_detail:\s*\{([\s\S]*?\n\s*\})/.exec(src);
    expect(detail?.[1], '未找到 hit_detail 块（结构锚点未命中）').toBeDefined();
    const body = detail?.[1] ?? '';
    // 只允许 strippedPaths（键路径）不允许出现任何 value 字段
    expect(body).toContain('strippedPaths');
    expect(body).not.toMatch(/\bvalue\s*:/);
    expect(body).not.toMatch(/cipherText|ciphertext|encrypted/i);
  });

  it('告警类型用主理人裁定的 OUTBOUND_CIPHER_LEAK，且等级 CRITICAL', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./outbound-cipher-guard.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toContain("type: 'OUTBOUND_CIPHER_LEAK'");
    expect(src).toContain("level: 'CRITICAL'");
    // type 与 risk_events 的 VarChar(48) 长度上限匹配，防截断
    expect('OUTBOUND_CIPHER_LEAK'.length).toBeLessThanOrEqual(48);
  });

  it('告警写入是 fire-and-forget（失败不得影响业务响应）', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./outbound-cipher-guard.ts', import.meta.url)),
      'utf8',
    );
    // 用 void 前缀调用而非 await
    expect(src).toMatch(/void raiseRiskEvent\(/);
    // 且告警函数内部整体被 try/catch 包住
    expect(src).toMatch(/async function raiseRiskEvent[\s\S]*?try \{/);
  });

  it('subject_type 用 API 而非 USER/ORDER（泄漏主体是接口不是人）', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./outbound-cipher-guard.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toContain("subject_type: 'API'");
  });
});

describe('中间件 · 幂等与不重复剥离', () => {
  it('嵌套调用 res.json 只守卫一次（不无限递归）', () => {
    const { res, sent } = stubRes();
    mount(res);
    const inner = res.json;
    let nestedCall = 0;
    // 模拟某个 handler 在 json 里再套一层
    (res as unknown as { json: unknown }).json = function once(b: unknown) {
      nestedCall += 1;
      return inner(b);
    };
    res.json({ data: { id: 1 } });
    expect(sent).toHaveLength(1);
    expect(nestedCall).toBe(1);
  });
});

describe('守卫清单完整性 · 与 schema 敏感列对齐', () => {
  it('schema 新增敏感列时必须同步 SENSITIVE_KEY_SUFFIXES', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
    const schema = readFileSync(path, 'utf8');
    const cols = new Set<string>();
    for (const line of schema.split(/\r?\n/)) {
      if (line.trim().startsWith('//')) continue;
      const m = /^\s*(\w+_(?:cipher|hmac))\s+\w+/.exec(line);
      if (m?.[1]) cols.add(m[1]);
    }
    // 实测 16 个唯一列名（21 处声明）。若schema 加了新敏感列且后缀不在表里，
    // 这条会红 —— 提醒同步 SENSITIVE_KEY_SUFFIXES。
    expect(cols.size).toBeGreaterThanOrEqual(16);
    for (const c of cols) {
      expect(SENSITIVE_KEY_SUFFIXES.some((s) => c.endsWith(s)), `未覆盖的敏感列 ${c}`).toBe(true);
    }
  });
});