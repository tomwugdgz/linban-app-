#!/usr/bin/env node
/**
 * 邻伴 · 全量门禁聚合入口（verify:all）
 * ============================================================================
 * 为什么要有这一个入口：
 *   2026-10-22 复核发现全仓有 10+ 个门禁脚本散落在四个包的 scripts/ 目录里，
 *   **没有任何一个入口把它们串起来**。这意味着：
 *     - 没人会一次跑完全部门禁（跑一遍要好几分钟，没人愿意）
 *     - 于是每个人只跑自己那部分的门禁 → 跨包的漂移永远发现不了
 *     - CI 建起来时也不知道该跑什么
 *   「门禁存在但没人跑」和「门禁不存在」在效果上是一样的。
 *
 * ── 三条硬规则（本文件自己必须遵守，否则它就是最大的假绿源）──────────
 *
 * 1. **本入口的第一步必须是「收集完整性断言」**
 *    不是每条子门禁都能被跑（有的需要 DB、有的需要网络）。
 *    所以「哪些必须跑、哪些可跳过」要显式声明，且**跳过的必须报出来**，
 *    不能静默跳过。静默跳过 = 又一个假绿。
 *
 * 2. **退出码不能只看子命令的退出码**
 *    实测：vitest 因 EPERM 落在 unhandled errors 区时，**测试全过但退出码 = 1**；
 *    反过来，默认池丢了 3 个守门测试，退出码可能 = 0。
 *    所以每条门禁要声明它**期望的判据形态**（退出码 / 输出模式 / 两者），
 *    由本入口统一判读，而不是简单 && 串联。
 *
 * 3. **本入口必须报告「跑了什么、跳过什么、为什么」**
 *    最后打印一张表。跳过项必须带原因。
 *    一份只说「全绿」的聚合输出，其可信度等于没有输出。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node scripts/verify-all.cjs                  # 跑全部（缺依赖的自动跳过并报出）
 *   node scripts/verify-all.cjs --only=collect,doc # 只跑指定组
 *   node scripts/verify-all.cjs --list           # 只列清单不执行
 *   node scripts/verify-all.cjs --strict         # 有任何跳过就退出码非 0（CI 用）
 * ============================================================================
 */

// ⚠️ 为什么整份文件用 CJS（require）而不是 ESM（import）：
//
//   WorkBuddy 桌面端的 node shim 在加载本仓库 .mjs 时，会让 ESM import 的
//   **绑定在函数体内变成 undefined**。实测现象：
//     顶层 `typeof spawnSync` → 'function'（正常）
//     函数内调用 → `ReferenceError: spawnSync is not defined`
//   两种绕法**同样失效**：`import * as cp`、以及
//   `const childProcess = createRequire(import.meta.url)('node:child_process')`
//   （顶层声明的 childProcess 在函数内也不可见）。
//   最小复现（8 行）在 /tmp 下正常、在本仓库 .mjs 下失败 → 是 shim 的问题，
//   不是代码问题。
//
//   ── 真正的触发条件（实测定位，绕了 20 分钟才找到）────────────────────
//   **不是 ESM vs CJS，而是「解构导入」**：
//     const { spawnSync } = require('node:child_process');   ← ❌ 函数内 undefined
//     const cp = require('node:child_process'); cp.spawnSync() ← ✅ 正常
//   ESM 的 `import { spawnSync }` 同样失败，`import * as cp` 也失败，
//   `createRequire` 也失败 —— 三种绕法都因为最终仍产生「解构绑定」而失效。
//
//   解法：**一律用属性访问，不解构**。本文件所有 node 内置模块都遵守这条。
//
//   代价：不能用顶层 await、不能用 import.meta（改用 __dirname）。
//   收益：CI 与本地行为一致，不再出现「顶层能引用、函数内报 undefined」这类
//   极难定位的问题。
//
//   ⚠️ 给后来人：本仓库任何 .mjs/.cjs 脚本若要起子进程，
//   一律写 `const cp = require('node:child_process'); cp.spawnSync(...)`，
//   不要写解构形式。
const childProcess = require('node:child_process');
const nodePath = require('node:path');

const ROOT = nodePath.resolve(__dirname, '..');


/** 颜色（无 TTY 时降级为空串，避免污染 CI 日志） */
const c = (code) => (process.stdout.isTTY ? `\x1b[${code}m` : '');
const RED = c('31'), GREEN = c('32'), YELLOW = c('33'), DIM = c('2'), BOLD = c('1'), OFF = c('0');

/**
 * 门禁清单。
 *
 * 字段说明：
 *   name     展示名
 *   group    分组（--only 用）
 *   cmd      执行命令（数组形式，交给 spawnSync，不经 shell → 无注入风险）
 *   cwd      工作目录（相对仓库根）
 *   need     运行前置条件：'db' 需要 DB 可连；'none' 纯静态
 *   expect   期望的判据：
 *             'exit0'  → 退出码必须为 0
 *             'exit0-or-known' → 退出码 0，或属于「已知非测试失败」的码（需在 knownExitCodes 说明）
 *   why      这个门禁守什么（一句话，必须写——「不写 why 的门禁没人敢删也没人知道它重要」）
 */
const GATES = [
  {
    name: '收集完整性（server vitest）',
    group: 'collect',
    cmd: ['npm', 'run', 'test:check:collection', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: '守门测试被静默丢弃 → 报告全绿但关键守卫没跑（2026-10 实测丢过 3 个，全是守卫）',
    // 🔴 本门禁的失败**不是一种东西**，必须分类，否则排查方向会被带偏：
    //   ·守门测试在磁盘上存在但未被收集 → 真事故（假绿），优先级最高
    //   · B < A（有文件没被收集）        → 看mtime 区分「有人在落盘」与「真丢了」
    //   · B > A（收集数比磁盘还多）      → **不是丢文件**，是两侧口径不一致（2026-10-22 主理人裁定）
    //   把三者混报成 FAIL = 运维只能猜。下面按 signature 逐类识别。
    classify(out, code) {
      // 🔴 「没输出」=「没跑」—— 最便宜的一道存活判据（2026-10-22 主理人裁定）
      //   脚本必须打印自己的结论行（`ERROR N 项 / WARN M 项`）。
      //   找不到这一行 → 它没跑到判定阶段（tsx 没起来 / 早退 / 被 EPERM 打断 / 输出被吞）。
      //   **退出码 0 在此不可信** —— 必须是 error，不是 pass：
      //   一个「什么都没做但返回 0」的脚本，比一个明确失败的脚本危险得多，
      //   因为它让CI 放行。
      //   ⚠️ 只认这一行，不泛化匹配任何含「ERROR」的字样 —— 泛化匹配会被
      //   错误明细里的文本命中，等于没有判据。
      if (!/ERROR\s+\d+\s+项\s*\/\s*WARN\s+\d+\s+项/.test(out)) {
        return {
          status: 'error',
          detail: '**门禁脚本没打印自己的结论行**（形如「ERROR N 项 / WARN M 项」）'
            + ` —— 它没跑到判定阶段（tsx 未启动 / 中途早退 / 输出被吞）。退出码 ${code} 不可信，不判通过`,
        };
      }
      if (code === 0) return null;
      // B > A：口径不一致（含「差集文件名」以便直接定位）
      const over = out.match(/B\s*>\s*A[\s\S]{0,400}?文件为：([^\n。]+)/);
      if (over) {
        return {
          status: 'error',
          detail: `B > A —— 报告收集数比磁盘文件数还多，多出来的文件：${over[1].trim()}。`
            + '**这不是丢文件，是两侧对「什么算一个测试文件」的定义不一致**；'
            + '排查 vitest include/exclude 与 findTestFiles() 的后缀正则，别去查并发',
        };
      }
      // 守门测试被丢弃（真事故）
      if (/在磁盘上存在但未被收集/.test(out)) {
        const names = [...out.matchAll(/\[守门测试\]\s*(\S+?)（/g)].map((m) => m[1]);
        return {
          status: 'error',
          detail: `守门测试在磁盘上存在但未被收集${names.length ? `：${names.join(', ')}` : ''} —— `
            + '**这是最高形态的假绿**：守卫文件没跑，报告却全绿',
        };
      }
      // B < A：看有没有点名 + mtime 线索
      if (/报告只收集\s*\d+\s*个文件/.test(out)) {
        const m = out.match(/A=(\d+)\s+B=(\d+)\s+C=(\d+)/);
        const missing = out.match(/未被收集：([^\n]+)/);
        return {
          status: 'error',
          detail: `B < A（${m ? `A=${m[1]} B=${m[2]} C=${m[3]}` : '数值见输出'}）—— 有测试文件没被收集`
            + `${missing ? `：${missing[1].trim()}` : ''}。看 mtime：刚修改的多半是有人在落盘（重跑即可），`
            + '很久以前的才是真丢了。⚠️ mtime 只作线索，**绝不能把 ERROR 降级成 WARN**（否则 touch 一下就能绕过门禁）',
        };
      }
      return null; // 交回通用判读
    },
  },
  {
    name: '服务端单测（server vitest）',
    group: 'test',
    cmd: ['npm', 'test', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: '领域纯函数 + 状态机 + 契约守卫的回归网',
  },
  {
    name: '管理后台冒烟（admin-web）',
    group: 'test',
    cmd: ['npm', 'run', 'smoke', '--workspace', '@linban/admin-web'],
    cwd: 'apps/admin-web',
    need: 'none',
    expect: 'exit0',
    why: '枚举镜像 + 错误码处理 + 脚本自证（存在 ≠ 被跑）',
  },
  {
    name: '陪聊员端单测',
    group: 'test',
    cmd: ['npm', 'test', '--workspace', '@linban/miniapp-companion'],
    cwd: 'apps/miniapp-companion',
    need: 'none',
    expect: 'exit0',
    why: '陪聊员端 service 层（订单动作链 / SOS / 举报）',
  },
  {
    name: '用户端单测',
    group: 'test',
    cmd: ['npm', 'test', '--workspace', '@linban/miniapp-user'],
    cwd: 'apps/miniapp-user',
    need: 'none',
    expect: 'exit0',
    why: '用户端预约/下单/绑家人（2026-10 之前是 0 断言）',
    // 🔴 「这个包还没有测试」与「这个包的测试挂了」是两件事，不能混为一谈。
    //   判据：脚本里**根本没有 test 命令** → 没写测试（WARN，待办）；
    //         有 test 命令但跑挂了 → 真失败（ERROR）。
    //   理由与 check-test-collection.ts 的三态一致：
    //   ①「还没写」②「写了但没跑」——只有 ② 才是事故。
    //   若不区分，CI 会因为「某个包还没写测试」而长期红灯，
    //   久而久之没人相信这个门禁 —— 报警信号被稀释 = 门禁被静音。
    missingScriptIsWarn: true,
  },
  {
    name: '类型检查（shared）',
    group: 'typecheck',
    cmd: ['npm', 'run', 'typecheck', '--workspace', '@linban/shared'],
    cwd: 'packages/shared',
    need: 'none',
    expect: 'exit0',
    why: '共享枚举/常量/错误码是三端的单一事实源，错一处三端齐错',
  },
  {
    name: '类型检查（server）',
    group: 'typecheck',
    cmd: ['npm', 'run', 'typecheck', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: '服务端类型（含 scripts/ —— 门禁代码自己也要被检查）',
  },
  {
    name: '类型检查（admin-web）',
    group: 'typecheck',
    cmd: ['npm', 'run', 'typecheck', '--workspace', '@linban/admin-web'],
    cwd: 'apps/admin-web',
    need: 'none',
    expect: 'exit0',
    why: '后台页面 + 门禁脚本（enum-guard / smoke-enums）',
  },
  {
    name: '类型检查（miniapp-companion）',
    group: 'typecheck',
    cmd: ['npm', 'run', 'typecheck', '--workspace', '@linban/miniapp-companion'],
    cwd: 'apps/miniapp-companion',
    need: 'none',
    expect: 'exit0',
    why: '陪聊员端 Taro 页面 + service',
  },
  {
    name: '类型检查（miniapp-user）',
    group: 'typecheck',
    cmd: ['npm', 'run', 'typecheck', '--workspace', '@linban/miniapp-user'],
    cwd: 'apps/miniapp-user',
    need: 'none',
    expect: 'exit0',
    why: '用户端 Taro 页面 + service',
  },
  {
    name: '文档↔代码配置一致性（段1-段7）',
    group: 'doc',
    cmd: ['npm', 'run', 'doc:check:configs', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: 'shared / DATABASE.md / ARCHITECTURE.md 三处同值 + 配置域分组键集 + 号段登记 + 迁移链',
  },
  {
    name: '迁移链漂移检查',
    group: 'db',
    cmd: ['npm', 'run', 'prisma:migrate:check', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: '迁移链末态结构 ≡ schema 重建结构（离线，不需要 DB）',
  },
  {
    name: 'Prisma schema 校验',
    group: 'db',
    cmd: ['npx', 'prisma', 'validate'],
    runner: 'npx',
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: 'schema 语法/关系合法性（注意：不带 DATABASE_URL 时报的是 env 缺失，不是 schema 问题）',
  },
  {
    name: 'Prisma 客户端生成',
    group: 'db',
    cmd: ['npx', 'prisma', 'generate'],
    runner: 'npx',
    cwd: 'apps/server',
    need: 'none',
    expect: 'exit0',
    why: 'client 与 schema 同版本（漂了会在运行时报「字段不存在」）',
  },
  {
    name: '迁移状态（需 DB）',
    group: 'db',
    cmd: ['npm', 'run', 'prisma:migrate:status', '--workspace', '@linban/server'],
    cwd: 'apps/server',
    need: 'db',
    expect: 'exit0',
    why: '确认生产库的迁移已全部应用（**这是上线必查项**）',
  },
  {
    name: '存量券快照回填校验（需 DB）',
    group: 'db',
    cmd: ['npx', 'tsx', 'scripts/check-coupon-backfill.ts'],
    cwd: 'apps/server',
    need: 'db',
    expect: 'exit0',
    why: '上线阻塞：存量券面额快照残留必须为 0，否则改模板会让存量券面额跟着变（资损）',
  },
];

/**
 * ── 跨平台起 npm/npx 的解法（Windows 上必踩，勿删）────────────────────
 *
 * 现象：Windows 上 `spawnSync('npm', [...], { shell: false })` → **ENOENT**；
 *       换成 `'npm.cmd'` → **EINVAL**（Node 22 起禁止免 shell 启动 .cmd，
 *       对应 CVE-2024-27980 的加固）。
 *       两者都会让 `status` 变成 **null** —— 注意这跟「测试失败」是两回事：
 *       status=null 表示**进程根本没起来**，输出是空的。
 *
 * 为什么不直接开 shell:true？
 *   本文件的门禁命令是**代码内写死的常量**，不含用户输入，注入风险为零；
 *   但一旦将来有人把门禁改成从环境变量/配置文件读命令，shell:true 就成了注入面。
 *   所以坚持走 **shell-free** 路线。
 *
 * 解法：找到 npm 自带的 `npm-cli.js`，用 **当前 node 可执行文件**直接跑它。
 *   - 不需要 shell，不受 .cmd 禁令影响
 *   - 用的是 npm 本体，不是某个 shim，行为与 `npm xxx` 一致
 *   - CI（Linux/macOS）上同样成立 —— npm 必定随 node 一起装
 *
 * 路径不能硬编码（CI 上 node 装在哪未知），所以**运行时探测**：
 *   1) 读 `npm_execpath` 环境变量（由 npm 自己注入，最准）
 *   2) 从 process.execPath 的同级/上级的 node_modules/npm/bin 找
 *   3) 兜底用 `shell: true` 跑 'npm'（此时会降级，但能跑通）
 */
function resolveNpmRunner() {
  // 1) npm 注入的 execpath —— 最准，且天然指向「正在用的那个 npm」
  const execPath = process.env.npm_execpath;
  if (execPath && /npm-cli\.js$/i.test(execPath)) {
    return { cmd: process.execPath, prefix: [execPath] };
  }
  // 2) 从当前 node 安装目录里找
  const fs = require('node:fs');
  const candidates = [
    nodePath.join(nodePath.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    nodePath.join(nodePath.dirname(process.execPath), '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    nodePath.join(nodePath.dirname(process.execPath), '..', '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return { cmd: process.execPath, prefix: [c] };
    } catch {
      /* 忽略 */
    }
  }
  // 3) 兜底：交给 shell（会走 .cmd，Windows 上可用）
  return { cmd: 'npm', prefix: [], shell: true };
}

/**
 * 起一个子进程。
 * @param {string[]} argv 命令与参数（不含 npm/npx 前缀）
 * @param {object} opts spawnSync 选项
 * @param {'npm'|'npx'} kind 用 npm 还是 npx
 */
function run(argv, opts, kind = 'npm') {
  const runner = resolveNpmRunner();
  // npx 在 npm 包里对应 npx-cli.js
  let prefix = runner.prefix;
  if (kind === 'npx' && prefix.length) {
    const npxCli = prefix[0].replace(/npm-cli\.js$/i, 'npx-cli.js');
    prefix = [npxCli];
  }
  const base = kind === 'npx' ? 'npx' : 'npm';
  const finalCmd = prefix.length ? runner.cmd : base;
  const finalArgs = prefix.length ? [...prefix, ...argv] : argv;
  return childProcess.spawnSync(finalCmd, finalArgs, {
    ...opts,
    shell: runner.shell === true,
  });
}

/** 判读 DB 可用性：用一个轻量查询试连，不跑迁移 */
function dbReachable() {
  if (!process.env.DATABASE_URL) return false;
  const r = run(['prisma', 'db', 'execute', '--stdin'], {
    cwd: nodePath.join(ROOT, 'apps/server'),
    input: 'SELECT 1;',
    encoding: 'utf8',
    timeout: 30_000,
  }, 'npx');
  return r.status === 0;
}

// ---- 参数解析 ----------------------------------------------------------
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const strict = args.includes('--strict');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

let gates = GATES;
if (only) gates = gates.filter((g) => only.includes(g.group));

if (listOnly) {
  console.log(`${BOLD}门禁清单（${gates.length} 项）${OFF}\n`);
  for (const g of gates) {
    console.log(`  ${g.name}`);
    console.log(`    ${DIM}group=${g.group}  need=${g.need}  expect=${g.expect}${OFF}`);
    console.log(`    ${DIM}${g.why}${OFF}`);
  }
  process.exit(0);
}

// ---- 执行 --------------------------------------------------------------
console.log(`${BOLD}邻伴全量门禁${OFF}  ${DIM}(${gates.length} 项${only ? `，筛选：${only.join(',')}` : ''})${OFF}\n`);

const results = [];
let dbOk = null;

for (const g of gates) {
  // 前置条件检查
  if (g.need === 'db') {
    if (dbOk === null) {
      process.stdout.write(`${DIM}  探测数据库可达性…${OFF}\n`);
      dbOk = dbReachable();
      process.stdout.write(
        dbOk ? `${GREEN}  ✓ 数据库可达${OFF}\n` : `${YELLOW}  ! 数据库不可达 —— 需 DB 的门禁将跳过${OFF}\n`,
      );
    }
    if (!dbOk) {
      results.push({ g, status: 'skip', reason: '数据库不可达（无 DATABASE_URL 或连不上）' });
      console.log(`${YELLOW}  ⊘ SKIP${OFF} ${g.name}  ${DIM}—— 数据库不可达${OFF}`);
      continue;
    }
  }

  process.stdout.write(`  ${DIM}·${OFF} ${g.name} … `);
  // runner 决定用 npm 还是 npx 启动（cmd[0] 是 'npm'/'npx'，这里切掉它）
  const r = run(g.cmd.slice(1), {
    cwd: nodePath.join(ROOT, g.cwd),
    encoding: 'utf8',
    timeout: 600_000,
    // 关键：stdio 透传，让子命令的输出原样出现（便于定位失败）
    stdio: ['ignore', 'pipe', 'pipe'],
    // prisma validate 需要 DATABASE_URL 存在（否则报的是 env 缺失，不是 schema 问题）。
    // 给一个**占位**值即可 —— validate 只解析 schema 不连库。
    // 传真实值有风险：万一哪天 validate 真去连库，会打到生产库。
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://placeholder:placeholder@127.0.0.1:3306/placeholder' },
  }, g.runner ?? 'npm');

  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const code = r.status;

  // 判读：不能只看退出码（见文件头规则 2）
  let status, detail = '';
  // 🔴 门禁可自带 classify()：同一退出码在不同门禁里含义不同。
  //   例：收集完整性门禁退出码非 0 时，可能是「守门测试被丢弃」（真事故）、
  //   「B<A 有人落盘」（环境噪音）、「B>A 两侧口径不一致」（脚本 bug）——
  //   混报成 FAIL 会把排查方向带偏到pool/并发上，而真因在别处。
  const custom = typeof g.classify === 'function' ? g.classify(out, code) : null;
  if (custom) {
    status = custom.status;
    detail = custom.detail;
  } else if (code === 0) {
    status = 'pass';
  } else if (code === null) {
    // 🔴 status=null = 进程**根本没起来**（不是断言失败）
    //   Windows 上最常见：免 shell 起 .cmd 被 Node 22 拒（EINVAL）→ ENOENT/EINVAL
    //   若是超时被 kill，r.signal 会是 SIGTERM
    status = 'error';
    const errCode = r.error?.code ? ` (${r.error.code})` : '';
    detail = r.signal
      ? `进程被信号 ${r.signal} 终止（多半是超时）`
      : `进程未启动${errCode} —— **不是断言失败**，是命令没能执行起来`;
  } else {
    // 🔴 进程级异常（native 崩溃 / 被信号杀）—— **必须与「断言失败」分开**
    //
    // 顾图南 2026-10-22 实测发现：threads 池下 vitest 会 **native 崩溃**，
    // 表现为「测试文件数在 31/32/33 之间波动」且**零断言失败**。
    // 崩溃时 vitest 进程被系统终止，退出码是：
    //   · POSIX  ：128 + signal 号（SIGSEGV=11 → 139；SIGABRT=6 → 134）
    //   · Windows：STATUS_ACCESS_VIOLATION = 0xC0000005 = 3221225477
    //             （node 报出来可能是 3221225477 或被截断的 -1073741819）
    //
    // 若不判别，这类崩溃会被当成「断言失败」→ **报告说「测试失败」，实际是「进程死了」**，
    // 运维会去查代码，而真因是环境/池配置。这跟「收集阶段失败」是同一类误判。
    //
    // 判据：退出码 ≥ 128（POSIX 信号）或命中 Windows 异常码 → 判为 'error'（环境问题）
    const isPosixSignal = code >= 128;
    const isWindowsCrash = code === 3221225477 || code === -1073741819 || code === 0xC0000005;
    if (isPosixSignal || isWindowsCrash) {
      status = 'error';
      const kind = isWindowsCrash
        ? 'Windows 访问违例（0xC0000005）'
        : `POSIX 信号终止（128+${code - 128}）`;
      detail = `退出码 ${code} = ${kind} —— **进程级崩溃，不是断言失败**`
        + '（排查方向：vitest pool 配置 / 原生模块 / 内存；不要去查业务代码）';
    } else {
      // 收集阶段失败（EPERM 等）→ 输出里有 "Errors N error" 且测试本身全过
      const errorsMatch = out.match(/Errors?\s+(\d+)\s+error/i);
      const filesMatch = out.match(/Test Files\s+(\d+)\s+passed\s+\((\d+)\)/);
      if (errorsMatch && filesMatch && Number(errorsMatch[1]) > 0) {
        status = 'error';
        detail = `退出码 ${code}，但测试本身全过（${filesMatch[1]} 文件）——疑似收集阶段失败（EPERM），**退出码非 0 不代表断言失败**`;
      } else if (g.missingScriptIsWarn && /Missing script|not found|is not a (function|command)/i.test(out)) {
        // 🔴 「这个包还没有测试」→ WARN，不是 FAIL
        //   npm 对缺失 script 的原文是 "Missing script: \"test\" in package.json"
        status = 'warn';
        detail = '该包尚无 test 脚本（还没写测试）—— 待办，非失败';
      } else {
        status = 'fail';
        detail = `退出码 ${code}`;
      }
    }
  }

  results.push({ g, status, detail, output: out });
  const icon = {
    pass: `${GREEN}✓ PASS${OFF}`,
    fail: `${RED}✗ FAIL${OFF}`,
    error: `${YELLOW}! ERR ${OFF}`,
    skip: `${YELLOW}⊘ SKIP${OFF}`,
    warn: `${YELLOW}! WARN${OFF}`,
  };
  console.log(icon[status] + (detail ? `  ${DIM}${detail}${OFF}` : ''));

  // 失败时把子命令输出的尾部打出来（不然用户看不到原因）
  if (status === 'fail' || status === 'error') {
    const tail = out.split('\n').slice(-25).join('\n');
    if (tail.trim()) {
      console.log(
        tail
          .split('\n')
          .map((l) => `      ${DIM}${l}${OFF}`)
          .join('\n'),
      );
    }
  }
}

// ---- 汇总 --------------------------------------------------------------
const pass = results.filter((r) => r.status === 'pass');
const fail = results.filter((r) => r.status === 'fail');
const err = results.filter((r) => r.status === 'error');
const skip = results.filter((r) => r.status === 'skip');
const warn = results.filter((r) => r.status === 'warn');

console.log(`\n${BOLD}汇总${OFF}`);
console.log(`  ${GREEN}PASS ${pass.length}${OFF}   ${RED}FAIL ${fail.length}${OFF}   ${YELLOW}ERR ${err.length}${OFF}   ${YELLOW}SKIP ${skip.length}${OFF}   ${YELLOW}WARN ${warn.length}${OFF}`);

if (warn.length > 0) {
  console.log(`\n${BOLD}警告项（待办，不是失败）${OFF}`);
  console.log(`  ${DIM}「还没写」与「写了但没跑」必须分开：只有后者才是事故${OFF}`);
  for (const w of warn) console.log(`  ${YELLOW}!${OFF} ${w.g.name}  ${DIM}${w.detail}${OFF}`);
}

if (skip.length > 0) {
  console.log(`\n${BOLD}跳过项（必须知道为什么跳过）${OFF}`);
  for (const s of skip) console.log(`  ${YELLOW}⊘${OFF} ${s.g.name}  ${DIM}—— ${s.reason}${OFF}`);
}

if (fail.length > 0) {
  console.log(`\n${BOLD}失败项${OFF}`);
  for (const f of fail) console.log(`  ${RED}✗${OFF} ${f.g.name}  ${DIM}${f.detail}${OFF}`);
}
if (err.length > 0) {
  console.log(`\n${BOLD}异常项（非断言失败，需按detail 逐条定性）${OFF}`);
  console.log(`  ${DIM}这一类退出码非 0 但测试可能全过——可能是收集阶段失败(EPERM)、进程崩溃、B>A 口径不一致，三者排查方向完全不同${OFF}`);
  for (const e of err) console.log(`  ${YELLOW}!${OFF} ${e.g.name}  ${DIM}${e.detail}${OFF}`);
}

// ---- 退出码 -----------------------------------------------------------
// 规则：任一 fail → 1；无 fail 但有 error（收集阶段失败）→ 2（与「真失败」区分）；
//       有 skip 且 --strict → 3
if (fail.length > 0) {
  console.log(`\n${RED}${BOLD}门禁未通过：${fail.length} 项失败${OFF}`);
  process.exit(1);
}
if (err.length > 0) {
  // 措辞不能写死「收集阶段失败」——ERR 里还有 B>A 口径不一致、进程崩溃等，
  // 退出码只表示「非断言失败」，具体性质看上面每项的 detail。
  console.log(`\n${YELLOW}${BOLD}门禁未通过：${err.length} 项异常（非断言失败，退出码 2；定性见各项 detail）${OFF}`);
  process.exit(2);
}
if (skip.length > 0 && strict) {
  console.log(`\n${YELLOW}${BOLD}门禁未通过：${skip.length} 项被跳过（--strict 模式视为失败）${OFF}`);
  process.exit(3);
}
console.log(`\n${GREEN}${BOLD}全部门禁通过${OFF}${skip.length > 0 ? `  ${DIM}（${skip.length} 项跳过，原因见上）${OFF}` : ''}`);
process.exit(0);
