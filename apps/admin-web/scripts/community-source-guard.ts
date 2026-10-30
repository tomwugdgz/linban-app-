// ============================================================================
// 社区字典来源守卫（community-source-guard）
// ----------------------------------------------------------------------------
// 主理人裁定（2026-10-22）：
//   「**生产环境不得 `import` mock 常量**（页面现在确实这么做了，mock 里 7 条硬编码社区
//     → 生产会静默显示假数据）。**这一条请做成门禁**，别只写进契约。」
//
// 契约依据：docs/API-CONTRACT.md §13.6.2.1.1
//   「服务端不提供独立社区字典端点；社区筛选项由前端从 elders 返回结果的
//    『所属社区』字段去重得出。」
//   「**宁可选项少，不可选项假。**」
//
// 🔴 本门禁**守什么**
// ---------------------------------------------------------------------------
//   1. **生产代码（src/）不得 import 任何 mock 数据模块**；
//   2. mock 数据模块不得被生产代码**间接**引入（经 `@/api` 桶文件等中间层）；
//   3. 页面里不得出现「硬编码社区常量」——社区选项只能来自接口返回。
//
// 🔴 本门禁**不守什么**（声明边界，避免被当万能牌用）
// ---------------------------------------------------------------------------
//   1. **不守 mock 数据本身对不对**（7 条社区叫什么、够不够，不归本门禁）；
//   2. **不守测试文件**（apps/admin-web/scripts/ 与 *.test.* 允许 import mock）；
//   3. **不守服务端**（服务端不产 mock 社区字典，契约已明说无该端点）；
//   4. **不保证发现率 100%**——本门禁按 **import 字面量** 扫描，
//      若有人用 `await import(...)` 动态引入且路径变量拼接，则**扫不到**（已知漏检面）。
//      漏检面的兜底是代码评审，不是本门禁。
//
// ============================================================================

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ADMIN_ROOT, 'src');
const PKG_ROOT = join(ADMIN_ROOT, '..', '..');
const SERVER_SRC = join(PKG_ROOT, 'apps', 'server', 'src');

/** 允许 import mock 的目录（测试与门禁脚本自身） */
const ALLOW_DIR_MARKERS = ['/scripts/', '/.test.', '/.spec.', '/__tests__/'];

/** 生产代码里出现的 mock 数据模块特征（按路径片段匹配，跨平台用正斜杠） */
const MOCK_PATH_MARKERS = ['/api/mock/', 'api/mock/db', '/mock/db-', 'mock/server'];

/**
 * 🔴 断言 1 的**豁免名单**（第六轮实测后补，第一版过宽打到了 request.ts）
 * ---------------------------------------------------------------------------
 * `src/api/request.ts` 会 import `mock/server`——那是**联调开关的正常机制**：
 *   · `shared/constants` 的 `USE_MOCK`（来自 `VITE_USE_MOCK`）决定走真后端还是内置 mock；
 *   · 该 import 是**静态的**（mock 模块被 bundle 进来），但**只有开关打开时才生效**。
 *
 * 豁免它**不是**给 mock 开免检牌，而是因为：
 *   · 它 import 的是 **mock 路由分发器**，不是 **mock 数据表**；
 *   · 数据表（`mock/db-*`）才是「假数据来源」，那个**绝不许进生产代码**。
 *
 * 豁免条件是**精确到文件 + 精确到被 import 的模块**，不是「凡是 mock/server 都豁免」——
 * 豁免名单写成通配符就等于没有豁免。
 */
const IMPORT_EXEMPTIONS: Array<{ file: string; spec: string }> = [
  { file: 'src/api/request.ts', spec: './mock/server' },
];

function isExempt(rel: string, spec: string): boolean {
  return IMPORT_EXEMPTIONS.some((e) => rel === e.file && spec === e.spec);
}

/**
 * 断言 2：硬编码社区常量的**精确标识符**。
 * ---------------------------------------------------------------------------
 * 不用通配的 `COMMUNITY` 之类——那会打到 `community` 字段名（正常业务字段），
 * 也会打到 `communityCode` 这类变量名。**只认「清单型常量名」**。
 */
const COMMUNITY_LIST_CONSTANTS = [
  'ACTIVITY_COMMUNITIES',
  'ADMIN_COMMUNITIES',
  'MOCK_COMMUNITIES',
  'COMMUNITY_LIST',
  'COMMUNITIES',
];

const errors: string[] = [];
const warnings: string[] = [];

/** 递归列出所有源文件（跳过 node_modules / dist / .tmp） */
function listFiles(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.tmp', 'build', '.git', '.workbuddy', 'coverage']);
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (exts.some((x) => e.endsWith(x))) out.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** 把 import/require 目标归一化成可匹配的路径片段 */
function extractImportSpecifiers(src: string): string[] {
  const out: string[] = [];
  const patterns = [
    /import\s+[^;]*?from\s+['"]([^'"]+)['"]/g, // import ... from '...'
    /import\s+['"]([^'"]+)['"]/g, // import '...'
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...')
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // await import('...')
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(m[1]!);
  }
  return out;
}

function isAllowedPath(file: string): boolean {
  const norm = file.replace(/\\/g, '/');
  return ALLOW_DIR_MARKERS.some((m) => norm.includes(m));
}

// ---------------------------------------------------------------------------
// 断言 1：生产代码不得 import mock 数据模块
// ---------------------------------------------------------------------------
const prodFiles = listFiles(SRC, ['.ts', '.tsx']).filter((f) => !isAllowedPath(f));

for (const f of prodFiles) {
  const rel = relative(ADMIN_ROOT, f).replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  for (const spec of extractImportSpecifiers(src)) {
    const norm = spec.replace(/\\/g, '/');
    const hit = MOCK_PATH_MARKERS.find((m) => norm.includes(m));
    if (!hit) continue;
    if (isExempt(rel, spec)) continue; // 精确豁免（见 IMPORT_EXEMPTIONS 注释）
    errors.push(
      `生产代码 import 了 mock 数据模块：${rel} → '${spec}'\n`
      + '         → 契约 §13.6.2.1.1 裁定：社区筛选项由前端从 elders 返回结果去重得出，\n'
      + '           **服务端不提供独立社区字典端点**（独立字典 = 第二份需同步的数据源，必然漂移）。\n'
      + '         → 后果：生产环境会**静默显示 mock 里的硬编码社区**（当前是 7 条），\n'
      + '           运营看不出来它是假的，且第 8 个社区永远出不来。**宁可选项少，不可选项假。**\n'
      + '         → 修法：改为从接口返回结果去重；若该数据源尚未就绪，控件**禁用**并挂说明。',
    );
  }
}

// ---------------------------------------------------------------------------
// 断言 2：页面不得出现硬编码社区常量
//   （社区选项只能来自接口；mock 常量表本身就是「第二份数据源」）
// ---------------------------------------------------------------------------
const pageFiles = prodFiles.filter((f) => f.replace(/\\/g, '/').includes('/pages/'));
for (const f of pageFiles) {
  const rel = relative(ADMIN_ROOT, f).replace(/\\/g, '/');
  const src = readFileSync(f, 'utf8');
  // 找形如 COMMUNITY / COMMUNITIES 的标识符定义或引用
  const m = COMMUNITY_LIST_CONSTANTS.map((c) => new RegExp(`\\b${c}\\b`).exec(src)).find(Boolean);
  if (!m) continue;
  errors.push(
    `页面引用了硬编码社区常量：${rel}（${m[0]}）\n`
    + '         → 同上：社区选项只能来自接口返回，页面不得持有社区清单。\n'
    + '         → 判据：页面里出现的任何「社区列表」都必须是从 elders 返回结果去重得来的。',
  );
}

// ---------------------------------------------------------------------------
// 断言 3：服务端不得提供独立社区字典端点
//   （契约已明说「不提供」；若有人加了端点，契约与实现就分叉了）
// ---------------------------------------------------------------------------
if (existsSync(SERVER_SRC)) {
  for (const f of listFiles(SERVER_SRC, ['.ts'])) {
    if (isAllowedPath(f)) continue;
    const rel = relative(PKG_ROOT, f).replace(/\\/g, '/');
    const src = readFileSync(f, 'utf8');
    // 只认「注册了一个 communities 字典路由」这一件事
    const routeHit = /['"`]\/activity\/communities['"`]/.exec(src);
    if (!routeHit) continue;
    errors.push(
      `服务端注册了社区字典端点：${rel}\n`
      + '         → 契约 §13.6.2.1.1 裁定「服务端不提供独立社区字典端点」。\n'
      + '         → 独立字典 = 第二份需同步的数据源（新增小区/改名/合并都会让两侧漂移）。\n'
      + '         → 若确需该端点，**先改契约**（走契约变更流程），不要在代码里悄悄加。',
    );
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const lines: string[] = [];
lines.push('── 社区字典来源守卫 ───────────────────────────────────────────────');
if (errors.length === 0) {
  lines.push(`✅ 生产代码未 import mock 社区数据（已扫 ${prodFiles.length} 个生产源文件）`);
  lines.push('✅ 页面未引用硬编码社区常量');
  lines.push('✅ 服务端未提供独立社区字典端点');
  lines.push('   依据：docs/API-CONTRACT.md §13.6.2.1.1');
} else {
  lines.push(`❌ ${errors.length} 项违反「社区选项只能来自接口」：`);
  for (const e of errors) lines.push('  ' + e);
}
if (warnings.length) {
  lines.push(`WARN ${warnings.length} 项`);
  for (const w of warnings) lines.push('  ' + w);
}
const out = lines.join('\n');
console.log(out);

const payload = { ok: errors.length === 0, errors, warnings, scanned: prodFiles.length };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload));
}
process.exit(errors.length === 0 ? 0 : 1);
