// ============================================================================
// 冒烟脚本收集完整性门禁
// ----------------------------------------------------------------------------
// 这道门禁为的是什么（源自主理人 2026-10 发现的 EPERM 假绿）：
//
//   `apps/server` 跑 vitest 时，WorkBuddy 沙箱的 fs 拦截层对 SSR 转换产物的写入
//   做 broker IPC 权限裁决，裁决失败即 EPERM。vitest 遇 EPERM 会**静默丢弃整个
//   测试文件**，只留一行 `Errors 3 errors`——而报告上写的是「全绿」。主理人实测：
//   磁盘 31 个 `.test.ts`，实际只收集 28 个，被丢的 3 个**全是守门测试**
//   （RBAC 守卫 / 密文出参巡检 / 营收端点契约）。
//
//   `apps/admin-web` 不用 vitest，用 `smoke.mjs`。**但同一失效模式在这里也成立**：
//   「脚本存在 ≠ 脚本被跑」。我上一轮踩过一个同根异形的坑——`enum-guard.ts` /
//   `smoke-enums.ts` 不在 `tsconfig.json` 的 `include` 范围，门禁代码自己没人检查。
//   一个是「写了没被检查」，一个是「写了没被执行」，**都是「存在 ≠ 生效」**。
//
// **这个门禁分两段，两段各答一个问题（我第一版把两件事塞进一条断言，是错的）**：
//
//   段一（本文件，跑在冒烟**之前**）：**接线检查**——
//     「该跑的脚本，是否都被 npm script 串起来了？」
//     能抓：新增脚本忘写进 package.json / 脚本名拼错 / 被从链条上摘掉。
//     抓不到：脚本被串起来了但执行中崩了（那是段二）。
//
//   段二（在 smoke.mjs 末尾）：**自证检查**——
//     「串起来的脚本，是不是都真的跑完了？」
//     能抓：脚本崩在中途、或某段被条件短路，导致后面的脚本压根没执行。
//
// **为什么要拆两段**（我第一版的错）：如果只在本文件里断言「都自证了」，
// 而本文件跑在冒烟**之前**——那时冒烟还没跑，自证必然为空，**这条断言恒红**，
// 等于把门禁自己变成噪声。而如果只断言「接线了」，那「脚本崩了没跑到」又漏了。
//
// ============================================================================
// ⚖️ **对偶端：这不是全项目唯一的收集完整性门禁**
// ---------------------------------------------------------------------------
//   服务端的对偶门禁是 `apps/server/scripts/check-test-collection.ts`
//   （主理人 2026-10 建），它查的是「**服务端 .test.ts 文件**有没有全被 vitest 收集」；
//   本文件查的是「**admin-web 的 scripts/ 下脚本**有没有全被 npm run smoke 执行」。
//
//   **为什么两个都要有**：失效模式是同一个（磁盘集合 vs 实际执行集合），
//   但**作用域完全不同**——任一方单独全绿**不能推出**另一方也干净。
//   将来引用「门禁说 38/38 全收集」时，必须知道那是服务端测试文件的数字，
//   不能拿来给 admin-web 的脚本背书。
//
//   主理人已把服务端那边改成**三态**（磁盘不存在→WARN / 存在但未收集→ERROR /
//   已收集→PASS）。判据一句话：**①「还没写」②「写了但没跑」，只有 ② 才是假绿事故。**
//   本文件目前是二态（必跑 / 缺失），**若要对齐三态需主理人确认后我改**——
//   「未创建」与「被丢弃」在本文件语境下能不能区分，得先确认收集窗口内磁盘
//   是否也会像vitest 那样变化。**我不擅自对齐，两边口径不同会引入新的误判。**
//
//   ⚠️ 本门禁**不覆盖**：node_modules 内的脚本、CI 里配置的其它 job、
//   vite 构建本身（那是 `tsc --noEmit` 与 vite build 的职责）。
// ============================================================================
// **恒红的断言比没有断言更糟**：它训练人忽略红色。
//
// **不覆盖什么（重要，别误以为它万能）**：
//   · 不校验断言本身的正确性——一条恒真断言照样绿；
//   · 不校验 mock 数据真实性——mock 全是假数据照样绿；
//   · 不校验构建产物完整性——bundle 少打一个文件它也不知道；
//   · 不校验断言条数下限（那是 smoke.mjs 的职责）。
//   它只回答一个问题：**「该跑的脚本，是不是都跑了、都跑完了？」**
// ============================================================================
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RAN_FILE = join(ROOT, '.tmp', 'smoke-ran.json');

/**
 * **必须被 npm run smoke 执行**的独立脚本（相对仓库根，正斜杠）。
 *
 * 新增独立脚本时**必须**同步登记 + 串进 package.json，两处都改才算生效。
 */
export const REQUIRED = [
  'scripts/esbuild-smoke.mjs', // 打包 mock server（不跑它就没有 dist-smoke/server.js）
  'scripts/smoke.mjs',         // 冒烟断言主体（段二的自证检查也在这里）
];

/**
 * **被 import 的门禁模块**（不是独立脚本，由 esbuild 打进 bundle）。
 *
 * 单独登记而不是简单排除，是因为「排除」意味着没人再管它——
 * 而它们恰恰是最容易悄悄失效的一类（改了断言逻辑但没人跑）。
 * 登记在此意味着：**新增模块必须在这里显式声明它被谁 import、靠什么保障**。
 *
 * 保障方式两类：
 *   ·被 esbuild 入口打进 bundle → 跑 smoke.mjs 时必然执行；
 *   · 被 tsconfig include 覆盖 → 受类型检查（上一轮修的那条）。
 */
export const IMPORTED_MODULES = {
  'scripts/enum-guard.ts': '被 scripts/smoke-enums.ts import → esbuild 打进 dist-smoke/smoke-enums.js',
  'scripts/smoke-enums.ts': 'esbuild 的第二个 entryPoint → 跑 smoke.mjs 时必然加载',
};

// ---------------------------------------------------------------------------
// 自证登记：被执行的脚本在**成功结束**时调用
// ---------------------------------------------------------------------------
// 由脚本自己写，而不是由门禁推断——门禁只能证明「文件存在」，
// 自证才能证明「跑完了而且没崩」。
mkdirSync(join(ROOT, '.tmp'), { recursive: true });

export function markRan(name) {
  let list = [];
  if (existsSync(RAN_FILE)) {
    try { list = JSON.parse(readFileSync(RAN_FILE, 'utf8')); } catch { list = []; }
  }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(name)) list.push(name);
  writeFileSync(RAN_FILE, JSON.stringify(list, null, 2));
}

export function readRan() {
  if (!existsSync(RAN_FILE)) return [];
  try {
    const v = JSON.parse(readFileSync(RAN_FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 段一：接线检查（跑在冒烟之前）
// ---------------------------------------------------------------------------
const isDirectRun = process.argv[1] && process.argv[1].endsWith('check-collection.mjs');

// ---------------------------------------------------------------------------
// 段一的执行体
// ---------------------------------------------------------------------------
// **关键实现细节（踩过一次坑才明白）**：本文件同时被 `smoke.mjs` import，
//所以它既作为独立入口跑（段一），也会在 smoke 跑到末尾时作为**模块**再加载一次。
// 若把「清空上一轮记录」写在这里无条件执行，第二次加载就会把
// `esbuild-smoke.mjs` 刚写的自证标记清掉——**段一于是自己把自己搞红**
// （`残留=["scripts/esbuild-smoke.mjs"]`）。
//
// 正确做法：**只在作为独立入口运行时清空**，模块加载时只提供函数。
// 这个坑的教训与主理人发现的 EPERM 假绿同源：
// **「清理动作」放在错误的位置，会让它清掉本轮刚产生的有效证据。**
if (isDirectRun) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
  };

  console.log('\n【收集完整性·段一】该跑的脚本是否都接进了 npm run smoke');

  // 上一轮记录必须先清空再断言——顺序反了会自己把自己搞红：
  // 第二次 `npm run smoke` 时，上一轮 `esbuild-smoke.mjs` 写的标记还在，
  // 若「先断言后清空」，这条永远红。
  //
  // 不清则累积出「历史上跑过就行」的假绿——那正是 EPERM 假绿的另一种形态
  // （更隐蔽，因为报告上看起来是绿的）。
  //
  // 注意本文件会被 `smoke.mjs` import 而二次加载，所以这里必须靠
  // 顶部的 `isDirectRun` 守卫，不能无条件清（否则会清掉本轮 esbuild 的有效标记）。
  const stale = readRan();
  writeFileSync(RAN_FILE, '[]');
  ok('上一轮自证记录已清空（避免「历史上跑过就行」的累积假绿）', true,
    stale.length ? `清掉了残留：${JSON.stringify(stale)}` : '本轮本就无残留');

  // ① package.json 的 smoke 必须真的串上了每一个 REQUIRED
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const smoke = pkg.scripts?.smoke ?? '';
  ok('package.json 有 smoke 脚本', !!smoke, '缺失');
  for (const r of REQUIRED) {
    ok(`smoke 串上了 ${r}`, smoke.includes(r), `smoke="${smoke}"`);
  }
  // 段一自身也必须被串上，否则这段检查根本不会跑
  ok('smoke 串上了门禁自身 scripts/check-collection.mjs',
    smoke.includes('check-collection.mjs'), `smoke="${smoke}"`);

  // ② 登记的脚本在磁盘上真实存在（登记了不存在的文件 = 静默空转）
  for (const r of REQUIRED) {
    ok(`${r} 在磁盘上真实存在`, existsSync(join(ROOT, r)));
  }

  // ③ 扫描磁盘上的独立脚本，发现未登记的——「存在但可能没人跑」的那一类。
  //    只认 scripts/ 下的独立脚本；src/ 下的 .ts 是页面/模块，不是脚本。
  const found = [];
  for (const name of readdirSync(join(ROOT, 'scripts'))) {
    if (/\.(mjs|ts)$/.test(name) && /(smoke|guard|check|test)/.test(name)) {
      found.push(`scripts/${name}`);
    }
  }
  ok('至少发现 5 个测试相关脚本（防扫描正则失效静默空转）', found.length >= 5,
    `found=${found.length}: ${found.join(',')}`);

  // 每个扫到的脚本都必须有归属：独立脚本 → REQUIRED；模块 → IMPORTED_MODULES
  const selfRel = 'scripts/check-collection.mjs';
  const orphans = found.filter(
    (f) => !REQUIRED.includes(f) && !Object.keys(IMPORTED_MODULES).includes(f) && f !== selfRel,
  );
  ok('无「已存在但无归属」的脚本（既未登记必跑，也未登记为被 import 模块）',
    orphans.length === 0, orphans.join(','));

  // 登记的两个表自身不能有僵尸条目（登记了不存在的文件 = 静默空转）
  const staleRegistry = [...REQUIRED, ...Object.keys(IMPORTED_MODULES)]
    .filter((r) => !existsSync(join(ROOT, r)));
  ok('登记表中无僵尸条目（登记的文件真实存在）', staleRegistry.length === 0,
    staleRegistry.join(','));

  // IMPORTED_MODULES 每条都要写明「被谁 import」，理由为空即红（防随手登记成免检牌）
  const noReason = Object.entries(IMPORTED_MODULES).filter(([, why]) => !why || why.trim().length < 10);
  ok('被 import 的模块均登记了执行路径（防随手登记成免检牌）', noReason.length === 0,
    noReason.map(([p]) => p).join(','));

  // ④ 门禁模块必须真被引用——写在注释里不算，要真在代码里
  const enumsEntry = readFileSync(join(ROOT, 'scripts/smoke-enums.ts'), 'utf8');
  ok('smoke-enums.ts 真的 import 了 enum-guard.ts（不是只在注释里提）',
    /from\s+['"]\.\/enum-guard['"]/.test(enumsEntry));
  const esbuildCfg = readFileSync(join(ROOT, 'scripts/esbuild-smoke.mjs'), 'utf8');
  ok('esbuild-smoke.mjs 真的把 smoke-enums.ts 作为 entryPoint（否则模块不会被执行）',
    /entryPoints/.test(esbuildCfg) && /smoke-enums/.test(esbuildCfg));

  // ⑤ 门禁模块必须被 tsconfig 覆盖（上一轮修的那条，防回归）
  const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
  ok('tsconfig include 覆盖 scripts 下的 ts（门禁模块自身受类型检查）',
    /"scripts\//.test(tsconfig) && /ts"/.test(tsconfig),
    'include 里没有 scripts —— 门禁代码会重蹈「写了没人检查」');

  console.log(`===== 段一 ${pass} passed / ${fail} failed =====`);
  if (fail > 0) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}