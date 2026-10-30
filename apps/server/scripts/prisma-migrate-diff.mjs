// ============================================================================
// 迁移链漂移校验（官方 Prisma 通道）——跨平台包装
// ----------------------------------------------------------------------------
// 背景：
//   旧脚本 `prisma migrate diff --from-schema-datamodel X --to-schema-datamodel X`
//   是**同文件自比**，恒退出 0 —— 恒真命题，不能算验证通过。已删除。
//
//   本脚本跑 Prisma 官方的 `--from-migrations` 比对：
//     迁移历史（migrations/ 目录实际内容） ←→  当前 schema.prisma
//   官方命令需要 shadow database（把迁移链重放到影子库再比对结构），
//   故需环境变量 SHADOW_DATABASE_URL。
//
// 为什么用 Node 包装而不是直接写进 package.json：
//   1) 官方参数 --shadow-database-url 需要环境变量注入；
//      直接写 "$SHADOW_DATABASE_URL" 在 Windows npm（cmd.exe）下**不会展开**，
//      在 bash 下能展开 → 跨平台不一致。Node 里读 process.env 是唯一稳定做法。
//   2) 缺 SHADOW_DATABASE_URL 时必须**明确失败**（exit 2），
//      绝不能因为参数没传上就「看起来通过了」——那是把恒真命题换了个马甲。
//
// 退出码约定：
//   0 = 迁移链与 schema 一致（无漂移）
//   1 = 存在漂移（官方命令 exit 2 = 有差异）
//   2 = 环境不具备（缺 SHADOW_DATABASE_URL / prisma 不可用）—— 明确报错，不静默通过
//
// 另：不带 shadow DB 的离线结构级比对见同目录 check-migration-drift.mjs
// （npm run prisma:migrate:check），它不需要数据库。
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const PRISMA_CLI = require_.resolve('prisma/build/index.js');

const MIGRATIONS_DIR = resolve('prisma/migrations');
const SCHEMA_PATH = resolve('prisma/schema.prisma');

if (!existsSync(MIGRATIONS_DIR)) {
  console.error('[FAIL] 迁移目录不存在：' + MIGRATIONS_DIR);
  console.error('       线上无迁移历史 —— 必须先补 baseline 迁移（npm run prisma:baseline）。');
  process.exit(2);
}

const shadowUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowUrl) {
  console.error('[FAIL] 缺环境变量 SHADOW_DATABASE_URL。');
  console.error('       官方 --from-migrations 比对需要影子库来重放迁移链。');
  console.error('       CI/本地请提供，例如：');
  console.error('         SHADOW_DATABASE_URL="mysql://root:pw@127.0.0.1:3306/linban_shadow?timezone=UTC"');
  console.error('       若只想做不连库的离线结构比对，请用：npm run prisma:migrate:check');
  process.exit(2);
}

let exitCode = 0;
let stdout = '';
let stderr = '';
try {
  stdout = execFileSync(
    process.execPath,
    [
      PRISMA_CLI, 'migrate', 'diff',
      '--from-migrations', MIGRATIONS_DIR,
      '--to-schema-datamodel', SCHEMA_PATH,
      '--shadow-database-url', shadowUrl,
      '--exit-code',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  // Prisma 的 --exit-code：有差异时 exit 2（此时 stdout 是差异 SQL），属正常结果
  exitCode = typeof err.status === 'number' ? err.status : 1;
  stdout = String(err.stdout || '');
  stderr = String(err.stderr || err.message || '');
}

if (stdout.trim()) {
  console.log(stdout.trim());
}
if (stderr.trim()) {
  console.error(stderr.trim());
}

if (exitCode === 0) {
  console.log('[PASS] 迁移链 === 当前 schema（Prisma 官方比对，无漂移）');
  process.exit(0);
}
if (exitCode === 2) {
  console.error('[FAIL] 迁移链与当前 schema 存在漂移（差异 SQL 见上）。');
  console.error('       修复方式：新增一个迁移目录（npm run prisma:migrate:dev），不要改历史迁移。');
  process.exit(1);
}

console.error(`[FAIL] 迁移比对命令异常退出（code=${exitCode}）。`);
process.exit(exitCode);
