// ============================================================================
// 测试收集完整性门禁 —— 防「EPERM 静默丢测试文件」
// ----------------------------------------------------------------------------
// 用法：
//   npx tsx scripts/check-test-collection.ts            # 全包检查
//   npx tsx scripts/check-test-collection.ts --json     # 机器可读
//   npx tsx scripts/check-test-collection.ts --update-baseline  # 显式抬高基线
//
// 退出码：0 = 通过；1 = 有 ERROR（任一收集缺失 / 配置缺项/ 守门测试未收集 / 收集数下降）
//
// ---------------------------------------------------------------------------
// 为什么这条必须存在（本项目已真实踩到，两种机制都要防）
// ---------------------------------------------------------------------------
//   机制①EPERM 写盘失败（本机沙箱）
//     `npx vitest run` → Test Files 33 passed (33)，Tests 683，**Errors 1**，EXIT=1
//     报告看起来是「全绿」，但磁盘上有 34 个 .test.ts —— 有文件被静默丢弃。
//     丢弃是**整文件级**的：报告里它连 failed 都不算，就是不存在。
//     排除项已核过：src/middlewares / src/domain / src/modules/** 均不在其中。
//     调用栈：node:internal/fs/promises → mkdir/writeFile/rename → EPERM
//   机制②同名缓存并发覆盖（**任何多核机器都会发生**，不限于沙箱）
//     vitest 2.1 `resolveConfig:6628` 的 check-then-set 竞态：
//     `has(tmp)` 与 `promises.set(tmp)` 之间隔着 `await mkdir`，
//     两个 worker 同时判定「不存在」→ 后写覆盖先写 → 前者的产物丢。
//
//   两者表象完全相同（报告里少文件、零警告），但**根治手段不同**：
//     机制① → 换进程池（pool: 'forks'，子进程不走 broker 的 fs 拦截路径）
//     机制② → 串行化 + 独立缓存目录（singleFork + fileParallelism:false + cacheDir）
//   实测（去掉 pool，裸跑 4 次）：33 / 35 / 34 / 35 —— **波动**。
//   实测（四项齐备，裸跑 4 次）：35 / 35 / 35 / 35 —— 稳定。
//
//   ⚠️ 但**配了四项还不够**：「配了」不等于「生效」（有人会手改回threads）。
//   所以必须每次对账磁盘与报告，且必须点名守门测试。
//
// ---------------------------------------------------------------------------
// 为什么 7.1 要比「三个数」而不是两个
// ---------------------------------------------------------------------------
//   A = 磁盘上 *.test.ts / *.spec.ts 文件数
//   B = 报告 testResults.length（**收集到的文件数**）
//   C = testResults 中 status === 'passed' 的文件数
//   B < A 时**必须列出漏掉的文件名**——只报「34 ≠ 35」运维不知道该查哪个文件。
//
// ⚠️⚠️ 量纲陷阱（本门禁自己踩过一次，写在这里防止重犯）：
//   我最初把 `numTotalTestSuites` 当成「文件数」用，实测：
//     磁盘文件 36 → numTotalTestSuites = 197、numPassedTestSuites = 197
//   197 是**describe 块数**，不是文件数。于是 `B < A`（197 < 36）**永不成立**，
//   这条断言变成了恒真 —— 正是本项目反复追打的「全绿有两种解释」，
//   这次轮到自己头上。
//   正确口径：`testResults` 数组的**长度**才是文件数；
//   `num*TestSuites` 是 suite（describe）数，`num*Tests` 才是 it() 条数。
//   两者不是同一量纲，不能混用。suite 级的一致性另行断言（C_suite === B_suite）。
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SERVER_ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO_ROOT = resolve(SERVER_ROOT, '../..');
const BASELINE_FILE = join(SERVER_ROOT, '.tmp/test-collection-baseline.json');

/** 参与检查的包：路径 + 该包是否已有测试文件 */
const PACKAGES = [
  { name: 'server', dir: join(SERVER_ROOT), label: '服务端' },
  { name: 'miniapp-companion', dir: join(REPO_ROOT, 'apps/miniapp-companion'), label: '陪聊员端' },
  { name: 'miniapp-user', dir: join(REPO_ROOT, 'apps/miniapp-user'), label: '用户端' },
  { name: 'admin-web', dir: join(REPO_ROOT, 'apps/admin-web'), label: '管理后台' },
] as const;

/**
 * 守门测试名单（缺一即 ERROR）。
 *
 * 收录标准：该测试一旦不跑，**某类事故会静默通过**。
 *
 * 关于条数：team-lead 要求「点名 7 个」，我保留 12 条 —— 集合是**超集**，
 * 门禁只会更严不会更松。若要收到 7 条，请指定砍哪 5 条，我不擅自削覆盖面。
 */
const GUARD_TESTS: Array<{ pkg: string; file: string; guards: string }> = [
  { pkg: 'server', file: 'src/middlewares/response-discipline.test.ts', guards: '出参密文巡检' },
  { pkg: 'server', file: 'src/middlewares/admin-perm-guard.test.ts', guards: 'RBAC 权限门禁' },
  { pkg: 'server', file: 'src/middlewares/outbound-cipher-guard.test.ts', guards: '密文出参守卫中间件' },
  { pkg: 'server', file: 'src/middlewares/revenue-endpoint-contract.test.ts', guards: '营收端点契约' },
  { pkg: 'server', file: 'src/middlewares/companion-income-contract.test.ts', guards: '陪聊员资金端点契约' },
  { pkg: 'server', file: 'src/middlewares/coupon-deduct-wiring.test.ts', guards: '券核销接线' },
  { pkg: 'server', file: 'src/middlewares/config-changelog-group.test.ts', guards: '配置分组 6 组 P0' },
  { pkg: 'server', file: 'src/middlewares/config-changelog-fields.test.ts', guards: 'changelog 出参字段名' },
  { pkg: 'server', file: 'src/middlewares/route-path-contract.test.ts', guards: '注册路径 ≡ 契约路径' },
  { pkg: 'server', file: 'src/domain/coupon-deduct.test.ts', guards: '券核销口径（快照优先/回退）' },
  { pkg: 'server', file: 'src/domain/revenue.test.ts', guards: '营收摊分精度' },
  { pkg: 'server', file: 'src/domain/companion-income.test.ts', guards: '收入台账防超发' },
  { pkg: 'server', file: 'src/middlewares/rating-precision.test.ts', guards: '评分精度不变量' },
  { pkg: 'server', file: 'src/middlewares/coupon-state-machine.test.ts', guards: '券状态机准入条件' },
];

interface Result {
  pkg: string;
  label: string;
  onDisk: number;
  /** 报告 testResults.length —— **文件数**（不是 suite 数，见文件头「量纲陷阱」） */
  collected: number;
  /** testResults 中 status==='passed' 的文件数 */
  passedFiles: number;
  /** describe 块数（量纲与上面两个不同） */
  totalSuites: number;
  passedSuites: number;
  tests: number;
  /** 收集到的测试文件绝对路径（归一化为正斜杠），供守门测试点名比对 */
  collectedFiles: string[];
  skipped: boolean;
  skipReason?: string;
  errors: string[];
  warnings: string[];
}

const errors: string[] = [];
const warnings: string[] = [];
const results: Result[] = [];
const updateBaseline = process.argv.includes('--update-baseline');

/** 递归找 *.test.ts / *.spec.ts（跳过 node_modules / dist / .tmp） */
function findTestFiles(root: string): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.tmp', '.git', 'build', '.workbuddy']);
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
      else if (/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(full.replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out;
}

function hasVitestConfig(pkgDir: string): boolean {
  return (
    existsSync(join(pkgDir, 'vitest.config.ts')) || existsSync(join(pkgDir, 'vitest.config.mts'))
  );
}

/**
 * 断言 7.3：vitest config 必须真正配齐三项，且 fileParallelism 不得重复出现。
 *
 * ⚠️ 必须先剥注释再匹配，且匹配的是**配置对象的 test 段**：
 *   反例（真实踩到）：本函数最初直接对整份文件跑 /pool:\s*'forks'/，
 *   而文件头的踩坑注释里就写着 `pool: 'forks'` 是强制项 ——
 *   于是把配置改成 `pool: 'threads'` 后断言**照样通过**，
 *   门禁变成恒真。这正是「正则扒文本」最典型的自欺：
 *   注释里描述配置，和配置里实际写值，在文本层面无法区分。
 *   故：① 剥掉所有注释；② 定位到 `test: {` 段内再匹配。
 *
 * ⚠️ 另一处自伤（真实踩到）：重复对象键是**静默陷阱**。
 *   `fileParallelism` 曾在同一份 config 里出现两次（上方 true、下方 false），
 *   JS 语义是后者覆盖前者，故**运行时确实生效 false**，
 *   但读文件的人只看得到第一个 true —— 于是下一个改代码的人会以为可以并行，
 *   把 false 删掉，丢文件问题原地复活。故这里显式断言「只出现一次」。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function checkVitestConfig(pkg: string, pkgDir: string): void {
  const cfgPath = ['vitest.config.ts', 'vitest.config.mts']
    .map((f) => join(pkgDir, f))
    .find((p) => existsSync(p));
  if (!cfgPath) return; // 7.3 只对有 config 的包断言
  const cfgName = cfgPath.split(/[\\/]/).pop();
  const cfg = stripComments(readFileSync(cfgPath, 'utf8'));

  // 只在 test 配置段内匹配，避免命中文件头注释或 import 行
  const testIdx = cfg.search(/\btest\s*:\s*\{/);
  const testBlock = testIdx >= 0 ? cfg.slice(testIdx) : cfg;

  const hasForks = /pool\s*:\s*['"]forks['"]/.test(testBlock);
  const hasSingle = /singleFork\s*:\s*true/.test(testBlock);
  // fileParallelism: false 必须显式写true/false 之一；只写 key 不给值视为未配
  const fpMatches = testBlock.match(/fileParallelism\s*:\s*(true|false)/g) ?? [];

  if (!hasForks) {
    errors.push(
      `[${pkg}] ${cfgName} 的 test 段未配 pool: 'forks' —— `
      + '本机沙箱下会导致测试文件被静默丢弃而报告仍显示通过（详见该config 文件头）',
    );
    return;
  }
  if (!hasSingle) {
    // 定为 ERROR 而非 WARN：实测仅 forks 时 5 跑有 2 次丢文件，
    // 且丢哪些文件不确定 —— 概率性丢守门测试的代价远高于多跑几秒
    errors.push(
      `[${pkg}] 配了 pool: 'forks' 但未配 poolOptions.forks.singleFork —— `
      + '实测仅 forks 时 5 跑有 2 次丢文件（并发写 SSR 产物目录）',
    );
  }
  if (fpMatches.length === 0) {
    errors.push(
      `[${pkg}] ${cfgName} 的 test 段未配 fileParallelism: false —— `
      + '单靠 singleFork 时 team-lead 实测仍有 31/32/33 波动，'
      + '须「池串行 + 文件间串行」两项同时生效',
    );
  } else if (fpMatches.length > 1) {
    // 重复键：运行时是「最后一个生效」，但读代码的人只看得到第一个
    errors.push(
      `[${pkg}] ${cfgName} 的 test 段出现 ${fpMatches.length} 次 fileParallelism `
      + `（${fpMatches.join(' / ')}）—— 重复对象键是静默陷阱：运行时后者覆盖前者，`
      + '但下一个改代码的人只会看到第一个，容易误判并删掉真正生效的那条',
    );
  } else if (!/fileParallelism\s*:\s*false/.test(testBlock)) {
    errors.push(
      `[${pkg}] ${cfgName} 配了 fileParallelism: true —— 文件间并发是丢文件的第二个机制`
      + '（vitest 2.1 resolveConfig:6628 同名缓存check-then-set 竞态），必须为 false',
    );
  }
}

/**
 * 跑一次 vitest 并读 JSON 报告。
 *
 * ⚠️ 返回的 `collected` 是**文件**（testResults 数组长度），不是 suite 数。
 *   suite 数另取 numTotalTestSuites —— 两者量纲不同，见文件头「量纲陷阱」。
 */
function collectVitest(
  pkg: string,
  pkgDir: string,
): {
  collected: string[];
  passedFiles: number;
  totalSuites: number;
  passedSuites: number;
  tests: number;
  failedCases: Array<{ file: string; test: string }>;
} {
  mkdirSync(join(pkgDir, '.tmp'), { recursive: true });
  const out = join(pkgDir, '.tmp/vitest-collection-report.json');
  if (existsSync(out)) rmSync(out, { force: true });
  // 退出码与崩溃形态（见下方 catch 段注释）：null = 未取到
  let exitCode: number | null = null;
  let exitCrash: string | null = null;
  try {
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['vitest', 'run', '--reporter=json', `--outputFile=${out}`],
      { cwd: pkgDir, stdio: 'ignore', shell: process.platform === 'win32' },
    );
  } catch (e: any) {
    // 🔴 接住退出码（2026-10-22 主理人裁定，catch 段归顾图南；7.1-b 段不碰）
    //
    // 【为什么必须接】原实现是 `catch {}` —— 把 `e.status` **主动丢弃**了。
    // 后果：vitest **整进程崩溃**（native 崩 / 启动失败）时，JSON 报告不存在，
    // 脚本只会报「未产出 JSON 报告」——**看不出是崩溃还是断言失败**。
    // 这与 `scripts/verify-all.cjs:417-425` 要解决的是**同一个问题**
    // （退出码不可信 → 必须分类），只是路径不同：那边丢在「怎么判」，这边丢在「没接住」。
    //
    // 【实测前提】`execFileSync` 在子进程非零退出时**抛异常而不是让父进程连带崩溃**，
    // 且异常对象上带 `status`（= 子进程退出码）。故本段能拿到退出码，**不需要改架构**。
    //   探针：`.tmp/probe-execfile-crash.cjs`
    //     exit139 => 父进程存活，捕获异常：status= 139  signal= null
    //     segv    => 父进程存活，捕获异常：status= 1    signal= null
    //
    // 【判据形态】退出码 ≥ 128（POSIX 信号：128+signum，如 SIGSEGV=11 → 139）
    //   或命中 Windows 访问违例（0xC0000005 = 3221225477，或被截断的 -1073741819）
    //   → **一定是进程级崩溃**，判 ERROR，但消息必须写明「不是断言失败」，
    //     并指向排查方向（pool 配置 / 原生模块 / 内存），**不要把人引去查业务代码**。
    //   退出码 1 且报告已产出 → 是断言失败，交给下面维度①~⑤ 正常判定。
    exitCode = typeof e?.status === 'number' ? e.status : null;
    const isPosixSignal = exitCode !== null && exitCode >= 128;
    const isWindowsCrash =
      exitCode === 3221225477 || exitCode === -1073741819 || exitCode === 0xc0000005;
    if (isPosixSignal || isWindowsCrash) {
      const kind = isWindowsCrash
        ? 'Windows 访问违例（0xC0000005）'
        : `POSIX 信号终止（128+${(exitCode as number) - 128}）`;
      exitCrash = `退出码 ${exitCode} = ${kind}`;
    }
  }
  if (!existsSync(out)) {
    if (exitCrash) {
      // 崩溃 → 消息必须含退出码，且必须说清「这不是断言失败」
      errors.push(
        `[${pkg}] vitest 进程级崩溃（${exitCrash}）—— **不是断言失败**，`
        + '排查方向：vitest pool 配置 / 原生模块 / 内存；**不要去查业务代码**。'
        + '（本条由 catch 段接住 e.status 判定，若这里报的是「未产出 JSON 报告」'
        + '且不带退出码，说明退出码又被丢了）',
      );
    } else {
      const codeMsg =
        exitCode === null
          ? '（且未捕获到退出码 —— 进程可能根本没起来）'
          : `（退出码 ${exitCode}，非崩溃形态）`;
      errors.push(
        `[${pkg}] vitest 未产出 JSON 报告，无法核对收集情况${codeMsg}`,
      );
    }
    return { collected: [], passedFiles: 0, totalSuites: 0, passedSuites: 0, tests: 0, failedCases: [] };
  }
  const raw = JSON.parse(readFileSync(out, 'utf8'));
  const testResults = (raw.testResults ?? []) as Array<{
    name: string;
    status?: string;
    assertionResults?: Array<{ fullName?: string; status?: string }>;
  }>;
  // 🔴 采集「失败用例名」—— 报错要能回答「哪个文件的哪条用例挂了」，
  //   而不只是「有几个没挂」（主理人2026-10-22 裁定）。
  //   ⚠️ 注意 status 是**文件级**，assertionResults[].status 是**用例级**。
  //   两者都要：只有文件级 status 能定位文件，只有用例级能定位用例。
  //   ⚠️ 且用例级可能为空 —— 那种情况恰好是机制③（磁盘在收集窗口内被增删，
  //   文件被认领但用例还没生成就退出了），故必须允许空数组并单列判定。
  const failedCases = testResults.flatMap((t) =>
    (t.assertionResults ?? [])
      .filter((a) => a.status === 'failed')
      .map((a) => ({
        file: t.name.replace(/\\/g, '/').replace(/^.*?(src|tests)\//, '$1/'),
        test: a.fullName ?? '(未命名用例)',
      })),
  );
  return {
    collected: testResults.map((r) => r.name.replace(/\\/g, '/')),
    passedFiles: testResults.filter((r) => r.status === 'passed').length,
    totalSuites: raw.numTotalTestSuites ?? 0,
    passedSuites: raw.numPassedTestSuites ?? 0,
    tests: raw.numTotalTests ?? 0,
    failedCases,
  };
}

for (const pkg of PACKAGES) {
  const { name, dir, label } = pkg;
  if (!existsSync(dir)) {
    warnings.push(`[${name}] 目录不存在，已跳过：${dir}`);
    continue;
  }
  const diskFiles = findTestFiles(dir);
  const r: Result = {
    pkg: name,
    label,
    onDisk: diskFiles.length,
    collected: 0,
    passedFiles: 0,
    totalSuites: 0,
    passedSuites: 0,
    tests: 0,
    collectedFiles: [],
    skipped: false,
    errors: [],
    warnings: [],
  };

  // 无测试文件的包：显式记录，不静默跳过（跳过与「有 0 个测试」是两件事）
  if (diskFiles.length === 0) {
    r.skipped = true;
    r.skipReason = '该包磁盘上无测试文件';
    warnings.push(`[${name}] ${label}：磁盘上 0 个测试文件（未覆盖，非本次可修范围）`);
    results.push(r);
    continue;
  }
  if (!hasVitestConfig(dir)) {
    r.skipped = true;
    r.skipReason = '无 vitest.config.ts';
    errors.push(`[${name}] 有 ${diskFiles.length} 个测试文件但没有 vitest.config.ts —— 无法运行`);
    results.push(r);
    continue;
  }

  checkVitestConfig(name, dir);
  const { collected, passedFiles, totalSuites, passedSuites, tests, failedCases } = collectVitest(name, dir);
  r.passedFiles = passedFiles;
  r.totalSuites = totalSuites;
  r.passedSuites = passedSuites;
  r.tests = tests;
  r.collectedFiles = collected;
  // 🔴 修复（2026-10-22 主理人）：`r.collected`（文件数，number）此前**从未被赋值**，
  //   一直是初始化时的 0 —— 而显示行印的正是 `r.collected`。
  //   后果：屏幕上永远是「收集B=0」，人眼完全看不到真实收集数，
  //   而断言 7.1 用的是局部变量 `collected.length`（正确）→ **断言没被带偏，但显示层骗人**。
  //   这类「断言对、显示错」的组合最阴险：数字看着荒谬（0），容易被当成「没跑」而忽略。
  r.collected = collected.length;
  const collectedSet = new Set(collected);

  // ---- 断言 7.1：三数比对 + **五条互斥判定**（同量纲，全部是「文件数」）
  //
  // A = 磁盘文件数 / B = 报告 testResults 长度 / C = 其中 status=passed
  //
  // 【为什么必须分五条而不是「B≠A 就报错」】
  //   实测（本项目真实走过）：
  //     ① B < A，有失败用例名→ **断言真失败**
  //     ② B < A，无失败用例名      → **机制③**（本包磁盘在收集窗口内被增删）
  //     ③ B > A                → **跨包/并发污染**（别的 vitest 写进了同一份报告目录）
  //     ④ C ≠ B，有失败用例名      → 同①，但文件都被认领了，是「跑过但红」
  //     ⑤ C ≠ B，无失败用例名      → 同②
  //   五种的**根因与处置完全不同**，混成一句「收集数不符」会把人引向错误方向
  //   —— 本轮就发生过：C(2)≠B(3) 被当成「有文件没跑过」，实际是 companion 的报告串进了server。
  const A = diskFiles.length;
  const B = collected.length;
  const C = passedFiles;
  /** 本包磁盘有、但报告里没有的文件（B < A 的那批） */
  const missing = diskFiles.filter((f) => !collectedSet.has(f));

  /** 格式化「哪个文件的哪条用例挂了」—— 最多列 8 条，超出给省略号 */
  const fmtFailed = (): string => {
    if (failedCases.length === 0) return '(报告里没有任何失败用例)';
    const lines = failedCases
      .slice(0, 8)
      .map((c) => `\n             · ${c.file} › ${c.test}`);
    return failedCases.length > 8 ? `${lines.join('')}\n             · …另有 ${failedCases.length - 8} 条` : lines.join('');
  };

  /** mtime 线索：判断「磁盘是不是刚刚在变」 */
  const fmtMtime = (files: string[]): string =>
    files
      .map((f) => {
        let mtime = 'mtime=?';
        try {
          mtime = new Date(statSync(f).mtimeMs).toISOString().replace('T', ' ').slice(0, 19);
        } catch {
          /* 读不到就留原样 */
        }
        return `${f.replace(/^.*?(src|tests)\//, '$1/')}（mtime ${mtime} UTC）`;
      })
      .join(', ');

  // ⚠️ 判定 ③（B > A）**不在这里判**——
  //   我最初写成「跨包/并发污染」，但那个归因是**错的**：
  //   并发只会让文件变少（丢），**不会凭空变多**。
  //   凭空变多只可能是「vitest 的 include 范围 ⊃ 我方扫描器的范围」，
  //   即两侧对「什么算一个测试文件」的定义不一致。
  //   已由下方那段更完整的分类（越出本包 / 落在跳过集 / 命名不匹配 / 报告重复条目）取代。
  //   保留此注记是为了不让下一个人再写一遍这个错归因。

  // ---- 判定 ②/①：B < A —— 未收集，且要区分「有没有失败用例」
  if (B < A) {
    if (failedCases.length > 0) {
      //判定①：B < A **且有失败用例名** → 有东西真的挂了，且顺带丢了文件
      r.errors.push(
        `[${name}] 磁盘 ${A} 个测试文件，报告只收集 ${B} 个，且存在失败用例：`
        + `${fmtFailed()}\n`
        + `             未被收集：${fmtMtime(missing)}\n`
        + '         → **存在真实断言失败**（见上列用例名）。先修断言；'
        + '若同时伴随文件缺失，请查 pool/singleFork/fileParallelism 是否被改动。',
      );
    } else {
      // 判定②：B < A **且无失败用例名** → 机制③（磁盘在收集窗口内被增删）
      r.errors.push(
        `[${name}] 报告只收集 ${B} 个文件，磁盘上有 ${A} 个测试文件（A=${A} B=${B} C=${C}），`
        + `未被收集：${fmtMtime(missing) || '(路径前缀不一致)'}\n`
        + '         → 报告里**没有任何失败用例**，故这不是断言失败，'
        + '而是**磁盘文件集合在 vitest 收集窗口内发生了变化**（有人正在落盘新测试文件）。\n'
        + '         → 若上面文件的 mtime 是刚刚（几分钟内）：等落盘完成重跑即可。\n'
        + '         → 若 mtime 很久以前：则是真被丢弃了，请查 pool/singleFork/fileParallelism 配置。',
      );
    }
  }

  // ---- 判定 ④/⑤：C ≠ B —— 被认领但未通过，同样分「有无失败用例」
  if (C !== B) {
    if (failedCases.length > 0) {
      // 判定④：文件都被收集了，是「跑过但红」
      r.errors.push(
        `[${name}] 通过文件数 C(${C}) ≠ 收集文件数 B(${B}) —— 有文件被收集但未通过：`
        + `${fmtFailed()}\n`
        + '         → 「跑过但红」与「压根没跑」是两种故障，不可混为一谈。'
        + '本条是真断言失败，请按上面的**文件 › 用例名**定位。',
      );
    } else {
      // 判定⑤：C ≠ B 但无失败用例 → 又一种机制③的变体：
      //   文件被认领（status 非 passed）却没产出任何用例 = 执行中途退出了
      r.errors.push(
        `[${name}] 通过文件数 C(${C}) ≠ 收集文件数 B(${B})，但报告里**没有任何失败用例**：`
        + `${fmtFailed()}\n`
        + '         → 文件被认领但没产出用例，典型是**执行中途退出**（含 EPERM 导致的环境写入失败）。'
        + '请看 stderr 里是否有 EPERM/ENOENT。'
        + '若报里有非本包的文件，先按「B > A」那条处理跨包污染。',
      );
    }
  }
  if (B > A) {
    // ---- 断言 7.1-b：B > A（2026-10-22 主理人裁定，霍承钧报的现象）
    //
    // 【为什么必须单独判，不能并进 B < A】
    //   B < A 的成因已经清楚（文件被丢 / 磁盘在变），运维知道去查 pool 与落盘。
    //   但 B > A 是**反常**的：磁盘上明明只有 A 个测试文件，报告里却有 A+ 个。
    //   物理上不可能「凭空多出文件」，所以它一定不是丢文件，而是
    //   **A 与 B 由两套不同的规则算出来** —— 「同一个事实有多个消费者」的裂缝。
    //   判错方向 = 排查方向错，所以必须点名差集，而不是只报「38≠35」。
    //
    // 【纠正承钧的归因】他观察到的 C ≠ B 伴随 B > A，判为「跨包并发污染」。
    //   核磁盘后**否定**这个归因：并发只会让文件变少（丢），不会凭空变多。
    //   凭空变多只可能是「vitest 的 include 范围 ⊃ 我方扫描器的范围」。
    //   所以本条**不写「并发污染」字样**，避免把排查引到并发上。
    const diskSet = new Set(diskFiles);
    const extra = collected.filter((f) => !diskSet.has(f));
    const uniqCount = new Set(collected).size;
    const dupCount = collected.length - uniqCount;

    //差集分类：① 越出本包目录（真·跨包）② 本包内但落在扫描器跳过集里
    //   ③ 本包内且不在跳过集里 → 扩展名/命名不匹配（如 .test.mts / .spec.js）
    const dirNorm = dir.replace(/\\/g, '/').replace(/\/$/, '');
    const SKIP_DIRS = ['node_modules', 'dist', '.tmp', 'build', '.git', '.workbuddy'];
    const relOf = (f: string) => f.replace(dirNorm + '/', '');
    const outside = extra.filter((f) => !f.startsWith(dirNorm + '/'));
    const inSkipped = extra.filter(
      (f) => f.startsWith(dirNorm + '/')
        && SKIP_DIRS.some((d) => relOf(f).split('/').includes(d)),
    );
    const namingMismatch = extra.filter(
      (f) => f.startsWith(dirNorm + '/')
        && !SKIP_DIRS.some((d) => relOf(f).split('/').includes(d)),
    );

    const causes: string[] = [];
    if (dupCount > 0) {
      causes.push(
        `①报告里有 ${dupCount} 条重复条目（同一文件被记了多次）`
        + `（vitest 多 project / 多 include 命中同一文件；去重后 B=${uniqCount}）`,
      );
    }
    if (outside.length > 0) {
      causes.push(`②有 ${outside.length} 个文件在本包目录之外：${outside.map(relOf).join(', ')}`);
    }
    if (inSkipped.length > 0) {
      causes.push(
        `③有 ${inSkipped.length} 个文件在本包内但落在扫描器跳过集里`
        + `（${SKIP_DIRS.join('/')}）：${inSkipped.map(relOf).join(', ')} —— `
        + '扫描器跳过了它们，vitest 的 include 没跳 → 两侧口径不一致',
      );
    }
    if (namingMismatch.length > 0) {
      causes.push(
        `④有 ${namingMismatch.length} 个文件在本包内且不在跳过集里：`
        + `${namingMismatch.map(relOf).join(', ')} —— `
        + '本脚本扫描器的后缀正则比vitest 的 include **窄**（vitest include 覆盖到它了，'
        + '扫描器没算进来）→ 两侧后缀口径不一致。注意方向：这类是扫描器漏认，'
        + '不是 vitest 多跑，所以「多出来」的文件在磁盘上确实是测试文件',
      );
    }

    r.errors.push(
      `[${name}] 报告收集 ${B} 个文件，磁盘只有 ${A} 个（A=${A} B=${B} C=${C}，B > A）—— `
      + '**这不是「文件被丢弃」，是两侧对「什么算一个测试文件」的定义不一致**。'
      + `磁盘多出的 ${extra.length} 个文件为：${extra.map(relOf).join(', ') || '(路径前缀不一致)'}。\n`
      + `         成因分类：${causes.join(' | ') || '路径前缀不一致（两侧一个是绝对路径、一个是相对路径）'}。\n`
      + '         → 排查方向：核对 vitest.config 的 include/exclude 与本脚本 findTestFiles() 的'
      + '后缀正则 + 跳过集，把两侧口径对齐。不要去查 pool / 并发（并发只会让文件变少）。'
      + '也不要改基线（基线取的是磁盘数，不受此项影响）。',
    );
  }
  // ⚠️ 旧版 `if (C !== B) { … }` 已删除—— 它已被上面「判定 ④/⑤」取代
  //（旧版只报数量不点名用例、不区分有无失败用例）。保留会造成**重复报错**。
  //
  // suite 级一致性（量纲与上面不同：suite = describe 块）
  if (passedSuites !== totalSuites) {
    r.errors.push(
      `[${name}] numPassedTestSuites(${passedSuites}) ≠ numTotalTestSuites(${totalSuites}) —— `
      + '有 describe 块内含失败用例。注意这是 suite 数不是文件数',
    );
  }

  // ---- 断言 7.2：测试条数必须 > 0（防「跑了个寂寞」）
  if (tests === 0) {
    r.errors.push(`[${name}] 收集到 ${B} 个文件但 0 条测试 —— 疑似全文件被丢`);
  }

  results.push(r);
}

// ---- 断言 7.4：守门测试必须在收集清单里（逐包点名比对）
//
// 🔴 三态区分（2026-10-22 主理人裁定，映棠反馈触发）
//   本条原来只有两态，把「守门测试还没创建」和「守门测试被静默丢弃」混成一类，
//   后果是：真事故（被丢弃）淹没在「还没写」的噪声里，报警信号被稀释。
//   现在分成三态：
//     ① 文件在磁盘上不存在      → **WARN**（待办：守门测试尚未创建）
//     ② 文件在磁盘上但没被收集  → **ERROR**（真事故：被静默丢弃）
//     ③ 文件在磁盘上且被收集    → PASS
//   判据：① 是「还没写」，② 是「写了但没跑」。只有 ② 才是假绿事故。
for (const g of GUARD_TESTS) {
  const r = results.find((x) => x.pkg === g.pkg);
  if (!r || r.skipped) {
    errors.push(
      `[守门测试] ${g.pkg}/${g.file}（${g.guards}）：所在包未成功运行，无法确认其被收集`,
    );
    continue;
  }
  // 归一化两侧路径后比对（vitest 报告的是绝对路径，磁盘扫描也是）
  const abs = join(SERVER_ROOT, g.file).replace(/\\/g, '/');
  if (r.collectedFiles.includes(abs)) continue; // ③ PASS

  // 区分 ① 与 ②：文件在磁盘上吗？
  const onDisk = existsSync(abs);
  if (!onDisk) {
    // ① 守门测试尚未创建 —— 是待办，不是事故
    r.warnings.push(
      `[守门测试] ${g.file}（${g.guards}）在磁盘上尚不存在 —— 待办：守门测试未创建`
      + '（尚未创建 ≠ 被丢弃；一旦创建后未被收集，才升级为 ERROR）',
    );
    continue;
  }
  // ② 文件在磁盘上但没被收集 —— 真事故
  r.errors.push(
    `[守门测试] ${g.file}（${g.guards}）在磁盘上存在但未被收集 —— 该类事故会静默通过`
    + '（EPERM 丢弃是整文件级、零警告的，只比数量发现不了「少的正好是守门测试」）',
  );
}

// ---------------------------------------------------------------------------
// 断言 7.5：收集数只增不减（基线存 .tmp/，不硬编码在脚本里）
// ---------------------------------------------------------------------------
//设计取舍：为什么不把基线硬编码成「server必须 ≥35」
//   ① 硬编码数会与「新增测试文件」冲突 —— 每加一个文件都要改脚本，
//      而改脚本的人往往就是赶着加测试的人，容易顺手把断言改松。
//   ② 基线写成数据文件后，「下降」这件事由 diff 自动发现，
//      且--update-baseline 是显式动作，会留git 痕迹。
//   ③ 基线只在**磁盘文件数**上取，不取报告数——
//      报告数受丢文件影响，若拿它当基线，一次丢文件会把基线拉低，之后再也发现不了。
const baseline: Record<string, number> = existsSync(BASELINE_FILE)
  ? (JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as Record<string, number>)
  : {};
const nextBaseline: Record<string, number> = { ...baseline };

for (const r of results) {
  if (r.skipped) continue;
  const prev = baseline[r.pkg];
  if (prev === undefined) {
    warnings.push(`[基线] ${r.pkg} 首次记录：磁盘 ${r.onDisk} 个测试文件（原无基线）`);
    nextBaseline[r.pkg] = r.onDisk;
    continue;
  }
  if (r.onDisk < prev) {
    r.errors.push(
      `[${r.pkg}] 磁盘测试文件数 ${r.onDisk} < 基线 ${prev} —— `
      + '测试被删除或移动。删除守门测试会让对应事故静默通过，'
      + `如确需删除请显式执行：npm run test:collect -- --update-baseline（会留 git 痕迹）`,
    );
  } else if (r.onDisk > prev) {
    warnings.push(`[基线] ${r.pkg} 磁盘 ${r.onDisk} > 基线 ${prev}（新增 ${r.onDisk - prev} 个，自动抬高）`);
    nextBaseline[r.pkg] = r.onDisk;
  } else {
    nextBaseline[r.pkg] = prev;
  }
}

if (updateBaseline || Object.keys(baseline).length === 0) {
  mkdirSync(join(SERVER_ROOT, '.tmp'), { recursive: true });
  writeFileSync(BASELINE_FILE, `${JSON.stringify(nextBaseline, null, 2)}\n`, 'utf8');
  if (updateBaseline) {
    warnings.push(`[基线] 已按 --update-baseline 写入：${BASELINE_FILE}`);
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const lines: string[] = [];
lines.push('── 测试收集完整性门禁 ─────────────────────────────────────────');
for (const r of results) {
  const mark = r.skipped ? '⏭' : r.errors.length > 0 ? '❌' : '✅';
  lines.push(
    `${mark} [${r.pkg}] ${r.label}：磁盘A=${r.onDisk} / 收集B=${r.collected} / 通过C=${r.passedFiles}`
    + `（suite ${r.passedSuites}/${r.totalSuites}，测试 ${r.tests} 条）`
    + (r.skipped ? `（跳过：${r.skipReason}）` : ''),
  );
  for (const e of r.errors) lines.push(`      ${e}`);
}
lines.push('───────────────────────────────────────────────────────────');

/**
 * 退出码必须把 **per-result 的 errors 一并计入**。
 *
 * 反例（本轮真实踩到）：7.4 命中守门测试未收集时，
 * 消息已经打进 r.errors 且输出里打了 ❌，但汇总只统计了顶层 `errors` 数组，
 * 于是 `ERROR 0 项` + `GATE_EXIT=0` —— **报告里明明有 ❌，退出码却是绿的**。
 * 这比不检查更坏：它让 CI 在已检出问题时放行。
 * 凡是把错误挂在子对象上，就必须同时把它并进退出判定，
 * 否则「显示」与「判定」会分叉。
 */
const allErrors = [...errors, ...results.flatMap((r) => r.errors)];
const allWarnings = [...warnings, ...results.flatMap((r) => r.warnings)];

lines.push(`ERROR ${allErrors.length} 项 / WARN ${allWarnings.length} 项`);
if (allErrors.length > 0) {
  lines.push('ERROR 明细：');
  for (const e of allErrors) lines.push(`  - ${e}`);
}
if (allWarnings.length > 0) {
  lines.push('WARN 明细：');
  for (const w of allWarnings) lines.push(`  - ${w}`);
}

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      { results, errors: allErrors, warnings: allWarnings, baseline: nextBaseline, ok: allErrors.length === 0 },
      null,
      2,
    ),
  );
} else {
  console.log(lines.join('\n'));
}
process.exit(allErrors.length > 0 ? 1 : 0);