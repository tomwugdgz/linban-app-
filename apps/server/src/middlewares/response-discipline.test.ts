// ============================================================================
// 出参纪律静态巡检（2026-10）
// ----------------------------------------------------------------------------
// 中间件守卫（outbound-cipher-guard）能拦住**运行时**的密文泄漏，但有盲区：
//   它只看键名。`res.json({ data: row })` 若row 已被手工 map 成安全字段，
//   守卫无从判断"该map 的字段是否漏了"。所以再加一道**静态**巡检。
//
// 【本文件第一版设计的教训，保留在此免得重犯】
//   v1 规则是"`data:` 后面跟一个裸标识符就报警"。扫出 18 处，逐条核实**全部**
//   是服务层字面量返回（`return { stage, score }` 这类），零真实泄漏。
//   代价却很大：一条会喊 18 次狼的规则，人看第3 次就开始整体忽略，
//   于是真泄漏来了也跟着被忽略 —— **误报率高的守卫比没有守卫更危险**。
//   教训：静态规则必须能区分「服务层字面量」与「Prisma 行直出」。
//
// v2 做法：**溯源**。只报"标识符直接来自 `await prisma.xxx(...)` / `await tx.xxx(...)`"
// 这一种形态 —— 那才是整行直出。服务层返回走别的路径，不会命中。
// 这样误报率从 18/18 降到 0，而真实泄漏（getOrderDetail 曾经的写法）仍会命中。
//
// 覆盖不到的地方（诚实声明）：
//   1. 跨函数传递（handler 把 row 交给 service，service 再 return 出来）——
//      这类要靠中间件运行时兜住，不靠本巡检；
//   2. `data: { a: row.address_cipher }` 手工挑密文字段——键名守卫会拦（运行时）；
//   3. `data: rows.map(toPublic)` —— 有 map，判定为安全，不报。
// ============================================================================

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 递归列出所有 .routes.ts */
function listRouteFiles(dir = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRouteFiles(full));
    else if (entry.endsWith('.routes.ts')) out.push(full);
  }
  return out;
}

const ROUTE_FILES = listRouteFiles();

/** 剥掉注释与字符串字面量，避免把注释/字面量里的文本当代码 */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

interface Hit {
  file: string;
  line: number;
  text: string;
  rule: string;
}

/**
 * v2 核心：从「`data:` 的值是裸标识符」出发，**回溯**该标识符是否直接
 * 来自一个未加工的 Prisma / 事务客户端调用。
 */
function scan(): Hit[] {
  const hits: Hit[] = [];

  for (const file of ROUTE_FILES) {
    const clean = stripCommentsAndStrings(readFileSync(file, 'utf8'));

    // 收集「疑似 Prisma 整行」变量：  const X = await prisma.<m>.<op>(  |  const {..} = await prisma.
    // 带解构的一律视为「已挑选字段」，不报（解构即显式挑选）。
    const wholeRowVars = new Map<string, number>();
    const assignRe =
      /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:prisma|tx|db)\s*\.\s*[a-z_$]+\s*\.\s*(findUnique|findFirst|findMany)\s*\(/g;
    let am: RegExpExecArray | null;
    while ((am = assignRe.exec(clean)) !== null) {
      const name = am[1];
      if (!name) continue;
      let line = 1;
      for (let i = 0; i < am.index; i += 1) if (clean[i] === '\n') line += 1;
      wholeRowVars.set(name, line);
    }

    // 收集「已加工」变量： X = <anything>.map( / X = prisma... 之外的加工
    const mappedVars = new Set<string>();
    const mapRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^\n]*\.map\s*\(/g;
    let mm: RegExpExecArray | null;
    while ((mm = mapRe.exec(clean)) !== null) {
      if (mm[1]) mappedVars.add(mm[1]);
    }

    const lines = clean.split(/\r?\n/);

    // 规则 1： data: X，而 X 直接来自 findUnique/findFirst/findMany 整行
    const dataRe = /\bdata:\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g;
    let dm: RegExpExecArray | null;
    while ((dm = dataRe.exec(clean)) !== null) {
      const name = dm[1];
      if (!name) continue;
      if (mappedVars.has(name)) continue; // 经 .map 加工，安全
      const srcLine = wholeRowVars.get(name);
      if (srcLine === undefined) continue; // 非 Prisma 整行（服务层字面量等），不报

      let line = 1;
      for (let i = 0; i < dm.index; i += 1) if (clean[i] === '\n') line += 1;
      // 赋值在出参之后（跨函数/后续声明）也算命中——只要同一个标识符
      hits.push({
        file: file.replace(SRC_ROOT, 'src/'),
        line,
        text: (lines[line - 1] ?? '').trim().slice(0, 120),
        rule: `R1-Prisma整行直出(var=${name}, 赋值于第${srcLine}行)`,
      });
    }

    // 规则 2： res.json({ ...X })  —— 整行展开，含任何来源
    const spreadRe = /res\s*\.\s*json\s*\(\s*\{\s*\.\.\.([A-Za-z_$][\w$]*)/g;
    let sm: RegExpExecArray | null;
    while ((sm = spreadRe.exec(clean)) !== null) {
      let line = 1;
      for (let i = 0; i < sm.index; i += 1) if (clean[i] === '\n') line += 1;
      hits.push({
        file: file.replace(SRC_ROOT, 'src/'),
        line,
        text: (lines[line - 1] ?? '').trim().slice(0, 120),
        rule: `R2-顶层展开直出(...${sm[1] ?? '?'})`,
      });
    }

    // 规则 3： data: { ...X } —— 出参对象里直接展开一个未知来源变量
    const dataSpreadRe = /\bdata:\s*\{\s*\.\.\.([A-Za-z_$][\w$]*)\s*\}/g;
    let xm: RegExpExecArray | null;
    while ((xm = dataSpreadRe.exec(clean)) !== null) {
      let line = 1;
      for (let i = 0; i < xm.index; i += 1) if (clean[i] === '\n') line += 1;
      hits.push({
        file: file.replace(SRC_ROOT, 'src/'),
        line,
        text: (lines[line - 1] ?? '').trim().slice(0, 120),
        rule: `R3-出参对象展开(...${xm[1] ?? '?'})`,
      });
    }
  }
  return hits;
}

const HITS = scan();

describe('出参纪律 · 静态巡检 v2（溯源式）', () => {
  it('扫描器本身有效（防空转：必须在已知反模式样本上命中）', () => {
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(10);
    // 反例样本：getOrderDetail 曾经的写法。必须被命中，否则规则整体失效。
    const SAMPLE = `
      const order = await prisma.orders.findUnique({ where: { id } });
      res.json({ code: 0, data: order, requestId: r });
    `;
    const clean = stripCommentsAndStrings(SAMPLE);
    const assignRe =
      /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:prisma|tx|db)\s*\.\s*[a-z_$]+\s*\.\s*(findUnique|findFirst|findMany)\s*\(/g;
    const vars = new Set<string>();
    let am: RegExpExecArray | null;
    while ((am = assignRe.exec(clean)) !== null) if (am[1]) vars.add(am[1]);
    expect(vars.has('order')).toBe(true);
    expect(/\bdata:\s*order\s*(?=[,}])/.test(clean)).toBe(true);
  });

  it('真实泄漏面为空：不存在 Prisma 整行直出的出参', () => {
    // 白名单：每条必须写明「为什么这一处安全」。写不出来就说明它不安全。
    const WHITELIST: Array<{ file: string; line: number; why: string }> = [
      {
        file: 'src/modules/risk/risk.routes.ts',
        line: 163,
        why:
          'SOS 出参为 { eventNo, level, suspended, complaintNo } 字面量；' +
          'include 进来的 emergency_contact_*_cipher 仅供服务端 safeDecryptPhone 发短信，不进出参',
      },
    ];

    const unexpected = HITS.filter((h) => !WHITELIST.some((w) => h.file.endsWith(w.file) && h.line === w.line));
    if (unexpected.length > 0) {
      const detail = unexpected
        .slice(0, 20)
        .map((h) => `  ${h.file}:${h.line}  [${h.rule}]${h.text}`)
        .join('\n');
      throw new Error(
        `检出 ${unexpected.length} 处 Prisma 整行直出（须改为显式挑选字段）：\n${detail}`,
      );
    }
    expect(unexpected).toHaveLength(0);
  });

  it('误报率受控：v1 的18 处服务层字面量返回不再被报', () => {
    // 这几个是 v1 全部误报的来源：r 来自服务层字面量返回，v2 不得再报。
    // 若这条红了，说明溯源逻辑坏了（把所有 data: r 都当Prisma 行），
    // 那会让守卫重新变成"喊狼"的噪声源。
    const knownSafe = [
      { file: 'src/modules/companion/companion.routes.ts', line: 60 }, // submitApplication
      { file: 'src/modules/companion/companion.routes.ts', line: 110 }, // submitRealname
      { file: 'src/modules/companion/companion.routes.ts', line: 166 }, // submitExam
      { file: 'src/modules/order/order.routes.ts', line: 255 }, // grabOrder
      { file: 'src/modules/payment/payment.routes.ts', line: 41 }, // createPrepay
      { file: 'src/modules/payment/payment.routes.ts', line: 223 }, // runDailyReconciliation
      { file: 'src/modules/auth/auth.routes.ts', line: 213 }, // issueTokens
      { file: 'src/modules/verification/verification.routes.ts', line: 23 }, // issueArrivalCode
    ];
    for (const k of knownSafe) {
      const hit = HITS.some((h) => h.file.endsWith(k.file) && h.line === k.line);
      expect(hit, `${k.file}:${k.line} 是服务层字面量返回，不该被报（误报）`).toBe(false);
    }
  });

  it('经 .map 加工的列表不算直出（避免把标准写法判死）', () => {
    const SAMPLE = `
      const rows = await prisma.orders.findMany({ where });
      const list = rows.map((r) => ({ id: r.id, no: r.order_no }));
      res.json({ code: 0, data: { list }, requestId: r });
    `;
    // 规则本意：rows 命中、list 不命中
    expect(SAMPLE).toContain('rows.map');
    const clean = stripCommentsAndStrings(SAMPLE);
    const assignRe =
      /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:prisma|tx|db)\s*\.\s*[a-z_$]+\s*\.\s*(findUnique|findFirst|findMany)\s*\(/g;
    const mapRe = /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^\n]*\.map\s*\(/g;
    const whole = new Set<string>();
    const mapped = new Set<string>();
    let a: RegExpExecArray | null;
    while ((a = assignRe.exec(clean)) !== null) if (a[1]) whole.add(a[1]);
    let b: RegExpExecArray | null;
    while ((b = mapRe.exec(clean)) !== null) if (b[1]) mapped.add(b[1]);
    expect(whole.has('rows')).toBe(true);
    expect(mapped.has('list')).toBe(true);
  });

  it('白名单每项都有非空理由（防止白名单变成泄漏堆放区）', () => {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const entries = [...src.matchAll(/why:\s*([\s\S]*?),\n\s*\},/g)].map((m) => m[1] ?? '');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const why of entries) {
      expect(why.trim().length, '白名单条目缺少理由').toBeGreaterThanOrEqual(20);
      expect(/出参|不进出参|字面量|显式|安全|不进/.test(why)).toBe(true);
    }
  });
});