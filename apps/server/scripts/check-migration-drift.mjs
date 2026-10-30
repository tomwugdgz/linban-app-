// ============================================================================
// 迁移链漂移校验（离线版）——「真实基线」vs「当前 schema」
// ----------------------------------------------------------------------------
// 为什么需要这个脚本：
//   旧脚本 `prisma migrate diff --from-schema-datamodel X --to-schema-datamodel X`
//   是**同文件自比**，恒退出 0 —— 恒真命题，不能算验证通过。
//   本脚本改为：把 migrations/ 目录里**真实存在的迁移历史**（baseline + 增量）
//   逐条解析、合成出「迁移链末态结构」，再与「当前 schema 从空库重建的结构」
//   做**结构级比对**（表集合 / 列集合 / 索引集合 / 外键集合 / NOT NULL 约束）。
//
//   判定：迁移链末态 === 当前 schema  →  exit 0（无漂移）
//         有任何差异                        →  exit 1（并逐条打印差异）
//
// 用法（无需数据库）：
//   node scripts/check-migration-drift.mjs
//   node scripts/check-migration-drift.mjs --migrations prisma/migrations \
//                                            --schema prisma/schema.prisma
//
// 与官方命令的分工：
//   · 本脚本：离线、不连库、结构级比对，用于 CI 快速门禁与本地自查。
//   · `npm run prisma:migrate:diff`：Prisma 官方 --from-migrations 比对，
//     需要 SHADOW_DATABASE_URL（本机无 MySQL 时不可用，故另备本脚本）。
// ============================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
function argOf(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
}

const MIGRATIONS_DIR = resolve(argOf('--migrations', 'prisma/migrations'));
const SCHEMA_PATH = resolve(argOf('--schema', 'prisma/schema.prisma'));

/* ------------------------------------------------------------------ *
 * 1. SQL 解析：把一份 migration.sql 解析成结构模型
 * ------------------------------------------------------------------ */

/**
 * 结构模型：
 *   tables: Map<tableName, {
 *     columns:  Set<"colName TYPE">,      // 列名 + 归一化类型（可空性单列，见 notNull）
 *     notNull:  Set<"colName">,           // NOT NULL 的列（可空性单独比对）
 *     indexes:  Set<"idxName|col1,col2">, // 索引名 + 列
 *     fks:      Set<"col->tbl2.col2">,
 *   }>
 */
function emptyState() {
  return { tables: new Map() };
}

function tableOf(state, name) {
  let t = state.tables.get(name);
  if (!t) {
    t = { columns: new Set(), notNull: new Set(), indexes: new Set(), fks: new Set() };
    state.tables.set(name, t);
  }
  return t;
}

/**
 * 解析列规格为 { type, notNull }。
 * 输入形如 "BIGINT NULL" / "VARCHAR(64) NOT NULL" / "DECIMAL(10, 7)" /
 * "TINYINT(1) NOT NULL DEFAULT false" / "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)"。
 *
 * 为什么可空性必须与类型拆开存：迁移链里增量列走 "ADD COLUMN ... NULL"，
 * 而 from-empty 建表走表内列定义（同样带 NULL 标记但位置不同）。
 * 若把 null 混进类型串，两处归一化不一致就会误报「列缺失 + 多余列」双份假漂移。
 */
function parseColSpec(raw) {
  let s = raw.replace(/\s+/g, ' ').trim();
  // 去掉 DEFAULT 子句（DEFAULT 值里可能带括号与逗号，故用首个 ' DEFAULT ' 切）
  const dIdx = s.search(/\sDEFAULT\s/i);
  if (dIdx >= 0) s = s.slice(0, dIdx).trim();
  let notNull = false;
  if (/\sNOT\sNULL$/i.test(s)) {
    notNull = true;
    s = s.replace(/\sNOT\sNULL$/i, '').trim();
  } else if (/\sNULL$/i.test(s)) {
    s = s.replace(/\sNULL$/i, '').trim();
  }
  return { type: s.toLowerCase(), notNull };
}

const RE_CREATE_TABLE = /^CREATE TABLE `(\w+)` \($/;
const RE_CREATE_TABLE_END = /^\) (?:DEFAULT CHARACTER SET|ENGINE)/;
const RE_ADD_COLUMN = /^ALTER TABLE `(\w+)` ADD COLUMN `(\w+)` (.+?)(?:,\s*)?;$/;
const RE_CREATE_INDEX = /^CREATE (UNIQUE )?INDEX `(\w+)` ON `(\w+)`\((.+)\);$/;
const RE_ADD_FK = /^ALTER TABLE `(\w+)` ADD CONSTRAINT `(\w+)` FOREIGN KEY \((.+?)\) REFERENCES `(\w+)`\((.+?)\).*?;$/;
const RE_DROP_TABLE = /^DROP TABLE `(\w+)`;$/;
const RE_RENAME = /^ALTER TABLE `(\w+)` RENAME TO `(\w+)`;$/;
const RE_DROP_COLUMN = /^ALTER TABLE `(\w+)` DROP COLUMN `(\w+)`;$/;
const RE_DROP_INDEX = /^DROP INDEX `(\w+)` ON `(\w+)`;$/;

const RESERVED_COL_PREFIX = ['PRIMARY', 'UNIQUE', 'INDEX', 'KEY', 'CONSTRAINT'];

/** 解析一份 SQL 文本，合并进 state（支持多次 ALTER 累积） */
function parseSqlInto(text, state) {
  const lines = text.split(/\r?\n/);
  let curTable = null;
  let inCreate = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (inCreate) {
      if (RE_CREATE_TABLE_END.test(line)) {
        inCreate = false;
        curTable = null;
        continue;
      }
      // 表内列定义：`col` TYPE [NULL|NOT NULL] [DEFAULT ...]
      const cm = /^`(\w+)`\s+(.+?)(?:,)?$/.exec(line);
      if (cm && !RESERVED_COL_PREFIX.includes(cm[1])) {
        const spec = parseColSpec(cm[2]);
        const t = tableOf(state, curTable);
        t.columns.add(`${cm[1]} ${spec.type}`);
        if (spec.notNull) t.notNull.add(cm[1]);
        continue;
      }
      // 表内索引：`UNIQUE INDEX `name`(`a`, `b`)` / `INDEX `name`(`a`)`
      const im = /^(UNIQUE )?INDEX `(\w+)`\((.+)\)(?:,)?$/.exec(line);
      if (im) {
        const cols = im[3].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
        tableOf(state, curTable).indexes.add(`${im[2]}|${cols}`);
        continue;
      }
      // 表内主键：`PRIMARY KEY (`id`)`
      const pm = /^PRIMARY KEY \((.+)\)(?:,)?$/.exec(line);
      if (pm) {
        const cols = pm[1].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
        tableOf(state, curTable).indexes.add(`PRIMARY|${cols}`);
        continue;
      }
      // 表内外键：`CONSTRAINT `name` FOREIGN KEY (`a`) REFERENCES `b`(`id`)`
      const fkm = /^CONSTRAINT `(\w+)` FOREIGN KEY \((.+?)\) REFERENCES `(\w+)`\((.+?)\)/.exec(line);
      if (fkm) {
        const cols = fkm[2].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
        const rcols = fkm[4].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
        tableOf(state, curTable).fks.add(`${cols}->${fkm[3]}.${rcols}`);
        continue;
      }
      continue;
    }

    let m;
    if ((m = RE_CREATE_TABLE.exec(line))) {
      inCreate = true;
      curTable = m[1];
      tableOf(state, curTable);
      continue;
    }
    if ((m = RE_ADD_COLUMN.exec(line))) {
      const spec = parseColSpec(m[3]);
      const t = tableOf(state, m[1]);
      t.columns.add(`${m[2]} ${spec.type}`);
      if (spec.notNull) t.notNull.add(m[2]);
      continue;
    }
    if ((m = RE_CREATE_INDEX.exec(line))) {
      const cols = m[4].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
      tableOf(state, m[3]).indexes.add(`${m[2]}|${cols}`);
      continue;
    }
    if ((m = RE_ADD_FK.exec(line))) {
      const cols = m[3].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
      const rcols = m[5].split(',').map((s) => s.trim().replace(/`/g, '')).join(',');
      tableOf(state, m[1]).fks.add(`${cols}->${m[4]}.${rcols}`);
      continue;
    }
    if ((m = RE_DROP_TABLE.exec(line))) {
      state.tables.delete(m[1]);
      continue;
    }
    if ((m = RE_RENAME.exec(line))) {
      const t = state.tables.get(m[1]);
      if (t) {
        state.tables.delete(m[1]);
        state.tables.set(m[2], t);
      }
      continue;
    }
    if ((m = RE_DROP_COLUMN.exec(line))) {
      const t = state.tables.get(m[1]);
      if (t) {
        for (const c of [...t.columns]) {
          if (c.startsWith(`${m[2]} `)) t.columns.delete(c);
        }
        t.notNull.delete(m[2]);
      }
      continue;
    }
    if ((m = RE_DROP_INDEX.exec(line))) {
      const t = state.tables.get(m[2]);
      if (t) {
        for (const i of [...t.indexes]) {
          if (i.startsWith(`${m[1]}|`)) t.indexes.delete(i);
        }
      }
      continue;
    }
  }
  return state;
}

/* ------------------------------------------------------------------ *
 * 2. 组装「迁移链末态」
 * ------------------------------------------------------------------ */

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`[FAIL] 迁移目录不存在：${MIGRATIONS_DIR}`);
  process.exit(1);
}
if (!existsSync(SCHEMA_PATH)) {
  console.error(`[FAIL] schema 不存在：${SCHEMA_PATH}`);
  process.exit(1);
}

const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (migrationDirs.length === 0) {
  console.error('[FAIL] 迁移目录为空 —— 线上无迁移历史，必须先补 baseline 迁移');
  process.exit(1);
}

const chainState = emptyState();
const applied = [];
for (const dir of migrationDirs) {
  const file = join(MIGRATIONS_DIR, dir, 'migration.sql');
  if (!existsSync(file)) {
    console.error(`[FAIL] 迁移 ${dir} 缺 migration.sql`);
    process.exit(1);
  }
  parseSqlInto(readFileSync(file, 'utf8'), chainState);
  applied.push(dir);
}

/* ------------------------------------------------------------------ *
 * 3. 产出「当前 schema 从空库重建」的结构
 * ------------------------------------------------------------------ */

// 定位 prisma CLI 入口。
// 坑一：Windows 下 npx 是 .cmd 批处理，spawnSync 直接调 npx 报 ENOENT。
// 坑二：monorepo 里 prisma 可能被提升到根 node_modules（apps/server/node_modules 下没有）。
// 坑三：.cmd 走 shell:true 时相对路径 + 中文 cwd 会出「系统找不到指定的路径」。
// 稳妥做法：用当前 node 进程去跑 prisma 的 JS 入口（build/index.js），绝对路径、无 shell。
const require_ = createRequire(import.meta.url);
const PRISMA_CLI = require_.resolve('prisma/build/index.js');

let currentSql = '';
try {
  currentSql = execFileSync(
    process.execPath,
    [
      PRISMA_CLI, 'migrate', 'diff',
      '--from-empty',
      '--to-schema-datamodel', SCHEMA_PATH,
      '--script',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  console.error('[FAIL] prisma migrate diff --from-empty 执行失败：');
  console.error(String(err.stderr || err.message));
  process.exit(1);
}

const currentState = parseSqlInto(currentSql, emptyState());

/* ------------------------------------------------------------------ *
 * 4. 结构比对
 * ------------------------------------------------------------------ */

const problems = [];

const allTables = new Set([...chainState.tables.keys(), ...currentState.tables.keys()]);
for (const t of [...allTables].sort()) {
  const a = chainState.tables.get(t);
  const b = currentState.tables.get(t);
  if (!a) {
    problems.push(`表 ${t}：迁移链无、当前 schema 有（缺迁移文件）`);
    continue;
  }
  if (!b) {
    problems.push(`表 ${t}：迁移链有、当前 schema 无（schema 删表但未写迁移）`);
    continue;
  }
  for (const c of [...b.columns].sort()) {
    if (!a.columns.has(c)) problems.push(`表 ${t} 列缺失：${c}`);
  }
  for (const c of [...a.columns].sort()) {
    if (!b.columns.has(c)) problems.push(`表 ${t} 多余列（schema 已改但迁移未改）：${c}`);
  }
  for (const n of [...b.notNull].sort()) {
    if (!a.notNull.has(n)) problems.push(`表 ${t} 列 ${n} 缺 NOT NULL 约束`);
  }
  for (const n of [...a.notNull].sort()) {
    if (!b.notNull.has(n)) problems.push(`表 ${t} 列 ${n} 多余 NOT NULL 约束`);
  }
  for (const i of [...b.indexes].sort()) {
    if (!a.indexes.has(i)) problems.push(`表 ${t} 索引缺失：${i}`);
  }
  for (const i of [...a.indexes].sort()) {
    if (!b.indexes.has(i)) problems.push(`表 ${t} 多余索引（schema 已改但迁移未改）：${i}`);
  }
  for (const f of [...b.fks].sort()) {
    if (!a.fks.has(f)) problems.push(`表 ${t} 外键缺失：${f}`);
  }
  for (const f of [...a.fks].sort()) {
    if (!b.fks.has(f)) problems.push(`表 ${t} 多余外键（schema 已改但迁移未改）：${f}`);
  }
}

/* ------------------------------------------------------------------ *
 * 5. 输出
 * ------------------------------------------------------------------ */

console.log('── 迁移链漂移校验 ──────────────────────────────────────────');
console.log(`迁移目录：${MIGRATIONS_DIR}`);
console.log(`迁移文件：${applied.length} 个 → ${applied.join(', ')}`);
console.log(`schema  ：${SCHEMA_PATH}`);
console.log(`结构规模：迁移链 ${chainState.tables.size} 表 / 当前 schema ${currentState.tables.size} 表`);
console.log('───────────────────────────────────────────────────────────');

if (problems.length === 0) {
  console.log('[PASS] 迁移链末态 === 当前 schema（无漂移）');
  process.exit(0);
}

console.log(`[FAIL] 发现 ${problems.length} 处漂移：`);
for (const p of problems) console.log(`  - ${p}`);
console.log('修复方式：新增一个迁移目录（prisma migrate dev --create-only），不要改历史迁移。');
process.exit(1);
