/**
 * 文档与代码的脱节校验（宋砚秋 2026-10）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ 本脚本「覆盖什么 / 不覆盖什么」—— 必读，别默认它覆盖了全部
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 【覆盖六项】
 *   段 1 §8 种子表 <-> shared SYSTEM_CONFIG_DEFAULTS 四维一致
 *        （键名集合双向差集、值、value_type、**声明顺序逐位一致**）
 *        为何连顺序也校验：值同序异时人工 diff 会因整段错位而淹没真差异
 *        （本脚本开发时正是如此——§8 13-17 位与 18 位起顺序与 shared 不一致，
 *        26 处全是假阳性）。顺序对齐后 diff 才能一屏看清。
 *   段 2 文档里的 GZ_ 示例 vs 前端 mock 的 GZ_ 集合必须相等
 *        示例值不一致是「文档与代码脱节」的主要形式之一，比配置项漂移更隐蔽。
 *   段 3 community_code 三处（seed.ts / admin-web mock / 文档）逐字 + 中文名一致
 *   段 4 ARCHITECTURE.md **附录 C** <-> shared（键集 + 顺序 + **默认值逐项**）
 *   段 5 文档状态性表述 vs prisma/migrations 实际目录（**弱规则，只报 WARN**）
 *        规则 A：文档说「未做」但迁移已在磁盘 → WARN
 *        规则 B：文档说「已做」但迁移不在磁盘 → WARN（更危险：接手的人不会再去查）
 *   段 6 配置域**单一事实源**（CONFIG_DOMAIN_GROUPS 6 组 / 28 键）
 *        6.1 分组扁平并集 === SYSTEM_CONFIG_DEFAULTS（双向差集为空）
 *        6.2 每键恰好归 1 组 / 6.3 前端 re-export shared（无双写面）
 *        6.4 服务端 zod 必须从 CONFIG_DOMAIN_GROUPS 派生（加组自动生效）
 *        6.5 前端 mock 的 configKey 是否真实存在（INFO：变更历史 mock 记录不算双写面）
 *        6.6 CONFIG_LABELS 无孤儿（INFO）
 *        6.7 号段登记双向核对（6.7-a 漏登记 = ERROR / 6.7-b 死键 = WARN）
 *        6.8 **探针不得变成门禁**：`scripts/probes/` 下的文件不得被任何
 *            package.json 的 script 引用（主理人裁定第 3 点）——
 *            把「探针不能变成门禁」从靠人记住变成可执行断言
 *
 * 【**不覆盖**（以下均为已知盲区，看到本脚本全绿≠ 这些方面没问题）】
 *   ✗ **`API-CONTRACT.md` 的错误码 vs `packages/shared/src/error-codes.ts`**
 *     —— 完全未做。顾图南复核报出契约 §2 速查表 11 处错配 + `9002` 不存在。
 *     这是最该补的一段（错误码错配会让前端按错误文案判错分支），但不在本脚本范围。
 *   ✗ **`ARCHITECTURE.md` 正文（附录 C 之外）的配置引用**
 *     —— 段 4 只解析「## 附录 C.」到下一个附录之间。正文里散落的配置引用
 *     （如 §13.11 的权威 11 项清单）不校验。
 *   ✗ **前端 `src/` 与契约的字段名一致性**
 *     —— 不覆盖。枚举值那类属苏映棠的枚举门禁域；而**字段名**类
 *     （如 `beforeValue` / `afterValue` 这类 DTO 字段，前端自造而非契约定义）
 *     **不在任何现有门禁范围内** —— 顾图南报出的 `ConfigChangeLog` 即此类。
 *   ✗ **`prisma/schema.prisma` 与文档的字段级一致性**（表清单、列名、类型）
 *     —— 由 `check-migration-drift.mjs`（比迁移链 vs schema）间接兜底，
 *     但**没有**「文档写的列 vs schema 实际的列」这一层直接校验。
 *   ✗ **中文名的语义正确性**（只校验逐字相等，不校验「这个键名对不对应这个意思」）
 *   ✗ **跨文档的数值口径是否合理**（如 §8 与附录 C 都写 1000，但业务上该不该是 1000）
 *   ✗ **不对 `DATABASE.md` 中的自然语言描述做事实判断**
 *     —— 段 5 规则 A/B 只比对**可结构化的**迁移名与配置键，不判断散文段落
 *     「已落盘 / 待承钧 / TODO」等自然语言的**事实真伪**。
 *     `docs/DATABASE.md:789`（变更记录 #11 · A7 落盘）那条 WARN 即属此类噪音：
 *     该行原文两处并存且互不矛盾 ——
 *       「迁移 `20261022040000_a7_communities` **已生成**并经迁移链漂移校验（exit=0）」
 *       「**遗留三处非 schema 改动待承钧/映棠处理**」
 *     即：迁移本身已落且文档已如实声明，待办指的是**代码侧**三处，与迁移无关。
 *     规则 A 触发的原因是它把「同行的迁移名」当成了「状态词所指的对象」。
 *     **刻意不豁免**（主理人 2026-10 裁定）：豁免机制本身是门禁的可信度折损 ——
 *     每加一条豁免就多一个「这里为什么不管」需要后来人重新判断；
 *     且一旦为自家文档开白名单，规则 A 就不再是通用检查。
 *     **WARN 的定位就是「提醒但不挡人」** —— 一条永远存在的 WARN 可接受
 *     （每次运行提醒读者去看一眼那一句），一条被豁免的 WARN 等于不存在。
 *     若这类「代码侧待办 + 同行 schema 迁移」以后变多，**该改的是规则语义**
 *     （判断状态词与迁移名是否指同一对象），**不是加白名单**。
 *
 * 【设计原则：弱规则不阻塞】
 *   段 5 只报 WARN 不计入退出码——机器分不清「刻意攒着一起落」（纪律）与
 *   「漏了迁移」（bug），让它阻塞会逼人改文案而不是改代码。判断权留给人。
 *
 * 【开发教训（本脚本自身踩过的坑，勿重犯）】
 *   1. **门禁的维度覆盖是「我当时想到什么」决定的，不是「什么该被检查」决定的。**
 *      段 4 第一版只比键集+顺序、漏了「值」这个维度，被反向验证当场抓出。
 *      **任何门禁的第一次反向验证失败，都不一定是破坏方法错了，
 *      很可能是门禁少了一个维度。**
 *   2. 只看「最近的一个匹配项」会漏判：规则 B 第一版只取最近迁移名，
 *      结果幽灵迁移名被同段落里另一个真实迁移掩盖 → 规则 B 形同虚设。
 *      故规则 B 改为收集邻近窗口内**全部**迁移名逐个核对。
 *   3. 别依赖 `process.cwd()`：用 `import.meta.url` 推导仓库根，
 *      否则从不同目录运行会静默读错文件。
 *   4. **破坏法注入必须自证生效**（2026-10 新增，与第 1 条同源）：
 *      给 6.8 做反向验证时，我的第一次注入是「把 package.json 里的
 *      `\"smoke\":` 替换成探针 script」—— 但 server 的 package.json **没有 smoke 键**，
 *      替换**静默失败**，注入根本没发生。而我差点把这个结果误读成
 *      「6.8 没牙齿，断言恒真」。
 *      改法：注入脚本里加 `if (s.length === before) { console.error('替换失败'); process.exit(1); }`
 *      —— 注入完必须先确认「文件真的变了」，再看门禁红不红。
 *      **推论：反向验证的「不红」有两种可能（断言没牙齿 / 注入没生效），
 *      必须先把第二种排除，否则会改坏一个本来正确的断言。**
 *      这与第 1 条是同一个错误家族：把「我没测到的东西」当成「不存在的东西」。
 *
 * 【外部注入验证记录】
 *   规则 B（文档说「已落」但磁盘没迁移）**已用外部注入样本反向验证过**：
 *     在 docs/DATABASE.md 变更记录里临时插入一行
 *     「迁移 `20261022999999_external_sync_from_other_system` 已落盘并通过验证」
 *     （模拟外部系统同步 schema 变更这一真实场景），
 *     脚本输出：`[WARN] docs/DATABASE.md:1213 完成性表述 已落盘 —
 *      提到的迁移 **不在磁盘**: 20261022999999_external_sync_from_other_system`，
 *     随后撤掉样本该 WARN 消失、EXIT=0。
 *     **意义**：此前规则 B 只在自己写的文档上验证过（自己改自己看，说服力不足），
 *     这次是用「非本人落笔的外部内容」证明它能抓真实脱节。
 *   规则 A（文档说「未落」但磁盘有迁移）已用 `value_snapshot` 那处真实矛盾验证过。
 *   规则 A 的**已知噪音**（`DATABASE.md:789`）见上方「不覆盖」清单末条，
 *   那里记了判定依据与「刻意不豁免」的理由，此处不重复。
 *
 * 用法（在 apps/server 目录下）：npx tsx scripts/verify-doc-configs.ts
 * 退出码：0 = 覆盖范围内全部一致；1 = 存在不一致（阻塞）。
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { SYSTEM_CONFIG_DEFAULTS as S } from '../../../packages/shared/src/constants';

// 以脚本文件位置为基准推导仓库根（不依赖 cwd，避免从不同目录运行时分叉）
const here = dirname(fileURLToPath(import.meta.url)); // apps/server/scripts
const repoRoot = resolve(here, '../../..');
const docPath = resolve(repoRoot, 'docs/DATABASE.md');
const doc = readFileSync(docPath, 'utf8');

console.log('── 段 1：§8 种子表<-> shared SYSTEM_CONFIG_DEFAULTS ──');

const start = doc.indexOf('INSERT INTO system_configs');
const end = doc.indexOf(';', start);
if (start < 0 || end < 0) {
  console.error('[FAIL] 未在 docs/DATABASE.md 中定位到 system_configs 的 INSERT 块');
  process.exit(1);
}
const block = doc.slice(start, end);

const rows = [...block.matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*'([A-Z]+)'/g)].map((m) => ({
  key: m[1]!,
  value: m[2]!,
  type: m[3]!,
}));
console.log(`§8 SQL 解析项数：${rows.length}`);
console.log(`shared 常量项数：${Object.keys(S).length}`);

const sqlKeys = new Set(rows.map((r) => r.key));
const sharedKeys = new Set(Object.keys(S));
const onlySql = [...sqlKeys].filter((k) => !sharedKeys.has(k));
const onlyShared = [...sharedKeys].filter((k) => !sqlKeys.has(k));
console.log(`仅 §8 有（应在 shared 无）: ${onlySql.length ? onlySql.join(', ') : '无'}`);
console.log(`仅 shared 有（应在 §8 补）: ${onlyShared.length ? onlyShared.join(', ') : '无'}`);

let diff = onlySql.length + onlyShared.length;
const sharedEntries = Object.entries(S);
rows.forEach((r, i) => {
  const s = sharedEntries[i];
  if (!s) {
    console.log(`[顺序/数量] §8 第 ${i + 1} 项 ${r.key} 在 shared 中无对应`);
    diff++;
    return;
  }
  const [sk, sv] = s;
  if (sk !== r.key) {
    console.log(`[顺序] 第 ${i + 1} 项不一致：§8=${r.key} vs shared=${sk}`);
    diff++;
  }
  if (String(sv.value) !== r.value) {
    console.log(`[值] ${r.key}: §8=${r.value} vs shared=${String(sv.value)}`);
    diff++;
  }
  const st = (sv as { valueType: string }).valueType;
  if (st !== r.type) {
    console.log(`[value_type] ${r.key}: §8=${r.type} vs shared=${st}`);
    diff++;
  }
});

console.log(
  diff === 0
    ? '[PASS] §8 与 shared 逐值一致（键名/值/value_type/顺序 全等）'
    : `[FAIL] §8 与 shared ${diff} 处不一致`,
);

// ── 段 2 + 段 3：GZ_ 示例与community_code 一致性 ──────────────────────
console.log('\n── 段 2/3：community_code 文档示例 vs 前端 mock vs seed ──');

/** 权威七条：以 admin-web mock 的 funnelChannels 为基准（前端已落地且被断言钉死） */
const CODE_RE = /GZ_[A-Z]+_[A-Z]+/g;

function collect(file: string, label: string): Map<string, string> {
  const abs = resolve(repoRoot, file);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return new Map();
  }
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    for (const code of line.match(CODE_RE) ?? []) {
      // 取该code 所在行的中文名，用于人工核对（不参与判定，只 aid定位）
      const name =
        line.match(/name:\s*'([^']+)'/)?.[1] ??
        line.match(/channelLabel:\s*'([^']+)'/)?.[1] ??
        line.match(/\|\s*\d+\s*\|\s*`GZ_[A-Z_]+`\s*\|\s*([^|]+?)\s*\|/)?.[1] ??
        '(未取到名)';
      m.set(code, name.trim());
    }
  }
  console.log(`  ${label.padEnd(18)} ${m.size} 条`);
  return m;
}

const mockCodes = collect('apps/admin-web/src/api/mock/db-activity.ts', 'admin-web mock');
const seedCodes = collect('apps/server/prisma/seed.ts', 'seed.ts');
const docCodes = collect('docs/DATABASE.md', 'DATABASE.md');
const contractCodes = collect('docs/API-CONTRACT.md', 'API-CONTRACT.md');

// 段 3：三处逐字 + 名称一致（以 mock 为基准，因前端已落地且有断言钉死）
const base = mockCodes;
for (const [name, set] of [
  ['seed.ts', seedCodes],
  ['DATABASE.md', docCodes],
] as const) {
  for (const code of new Set([...base.keys(), ...set.keys()])) {
    if (!base.has(code)) {
      console.log(`  [FAIL] ${code}: ${name} 有而前端 mock 无（前端已落地，应以 mock 为准）`);
      diff++;
    } else if (!set.has(code)) {
      console.log(`  [FAIL] ${code}: ${name} 缺（前端 mock 已落地，必须同步）`);
      diff++;
    } else if (base.get(code) !== set.get(code)) {
      console.log(
        `  [FAIL] ${code}: 名称不一致 mock="${base.get(code)}" vs ${name}="${set.get(code)}"`,
      );
      diff++;
    }
  }
}

// 段 2：契约文档若出现示例 code，必须是七条之一（防文档示例与代码脱节）
for (const code of contractCodes.keys()) {
  if (!base.has(code)) {
    console.log(`  [FAIL] API-CONTRACT.md 示例 ${code} 不在前端 mock 七条内`);
    diff++;
  }
}

console.log(
  diff === 0
    ? '[PASS] community_code 文档示例/前端 mock/seed 三处逐字一致（含名称）'
    : `[FAIL] community_code 不一致`,
);
if (diff) {
  console.log(`\n[FAIL] 合计 ${diff} 处不一致`);
  process.exit(1);
}

// ── 段 4：ARCHITECTURE.md 附录 C<-> shared SYSTEM_CONFIG_DEFAULTS ──────────
console.log('\n── 段 4：附录 C（ARCHITECTURE.md）<-> shared ──');
{
  const arch = readFileSync(resolve(repoRoot, 'docs/ARCHITECTURE.md'), 'utf8');
  const i = arch.indexOf('## 附录 C.');
  const j = arch.indexOf('## 附录 C.', i + 1);
  const sec = i < 0 ? '' : arch.slice(i, j > 0 ? j : i + 6000);
  if (!sec) {
    console.log('  [FAIL] 未在 ARCHITECTURE.md 中定位到「## 附录 C.」');
    diff++;
  } else {
    // 附录 C 是 Markdown 表格（| `key` | 默认 | 说明 |），解析器与 §8 的 SQL INSERT 不同
    const archKeys = [
      ...sec.matchAll(/^\|\s*\*{0,2}`?([a-zA-Z_]+)`?\*{0,2}\s*\|/gm),
    ]
      .map((m) => m[1]!)
      .filter((k) => k !== '键');
    console.log(`  附录 C 解析${archKeys.length} 项/ shared ${Object.keys(S).length} 项`);
    for (const k of new Set([...archKeys, ...Object.keys(S)])) {
      if (!Object.keys(S).includes(k)) {
        console.log(`  [FAIL] ${k}: 附录 C 有而 shared 无（键名可能大小写/拼写错，或 shared 未同步）`);
        diff++;
      } else if (!archKeys.includes(k)) {
        console.log(`  [FAIL] ${k}: shared 有而附录 C 缺（附录 C 漏收录）`);
        diff++;
      }
    }
    // 顺序逐位一致（与 §8 同理：顺序错位会淹没人工 diff 的真差异）
    const sharedOrder = Object.keys(S);
    const firstDiff = archKeys.findIndex((k, idx) => k !== sharedOrder[idx]);
    if (firstDiff >= 0) {
      console.log(
        `  [FAIL] 附录 C 第 ${firstDiff + 1} 项顺序不一致：附录C="${archKeys[firstDiff]}" vs shared="${sharedOrder[firstDiff]}"`,
      );
      diff++;
    }

    // 默认**值**逐项一致（仅校验键集是不够的——键名对、值错同样是真不一致。
    // 反向验证实测：把附录C 的 cancel_penalty_rate_bp 由 1000 改 10 而键集不变时，
    // 只比键集的版本会PASS 放行 → 必须比值）
    const rows = [
      ...sec.matchAll(/^\|\s*\*{0,2}`([a-zA-Z_]+)`\*{0,2}\s*\|\s*\*{0,2}([^*|]+?)\*{0,2}\s*\|/gm),
    ].map((m) => ({ key: m[1]!, val: m[2]!.trim() }));
    let valDiff = 0;
    for (const { key, val } of rows) {
      const sv = (S as Record<string, { value: string }>)[key];
      if (!sv) continue;
      // 附录 C 的默认值可能带单位后缀（如 "21600 (6h)"），取首个空白分隔 token 比较
      const norm = val.split(/\s+/)[0]!;
      if (norm !== String(sv.value)) {
        console.log(`  [FAIL] ${key}: 附录 C 默认值="${norm}" vs shared="${String(sv.value)}"`);
        valDiff++;
      }
    }
    if (valDiff === 0) {
      console.log(`  [PASS] 附录 C ${rows.length} 项默认值与 shared 逐项一致`);
    }
    diff += valDiff;
  }
  console.log(
    diff === 0
      ? '  [PASS] 附录 C 与 shared 键集 + 顺序全等'
      : '  [FAIL] 附录 C 与 shared 不一致',
  );
}

// ── 段 5：文档状态性表述 vs prisma/migrations 实际目录 ──────────────────
console.log('\n── 段 5：文档「未做」表述 vs migrations 实际 ──');
{
  // 主理人要求（2026-10）：暴露「文档声称未做、但磁盘已做」这类矛盾。
  // 两道迁移门禁都查不出这个盲区——它们只比「迁移链 vs schema」，
  // 看不见「文档承诺 vs 磁盘」。
  //
  //**本段不自动判定「该不该做」**： 「刻意未落」有时是纪律（攒着一起落），
  // 有时是漏迁移，机器分不清。故只报 WARN 不计入退出码，把判断权留给人。
  let migDirs: string[] = [];
  try {
    migDirs = readdirSync(resolve(repoRoot, 'apps/server/prisma/migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
      .map((d) => d.name);
    console.log(`  迁移目录 ${migDirs.length} 个`);
  } catch {
    console.log('  [FAIL] 未找到 prisma/migrations 目录');
    diff++;
  }

  const STATUS_RE = /(刻意未落|待落|未实现|TODO|待承钧|待映棠|待补|尚未落|待迁移)/g;
  const DONE_RE = /(已落盘|已生成|已补齐|已迁移|已实施)/g;
  const MIG_RE = /\b(20\d{12}_[a-z0-9_]+)\b/g;

  for (const f of ['docs/DATABASE.md', 'docs/API-CONTRACT.md']) {
    let text = '';
    try {
      text = readFileSync(resolve(repoRoot, f), 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');

    /** 该行是否只是在**引用状态词表**（如变更记录里描述本段门禁扫哪些词）——
     *  这类行提到「刻意未落」是为了解释规则，不是在陈述某事项未做，应跳过，否则误报。 */
    const isQuoteOfWordList = (line: string): boolean => {
      const s = STATUS_RE.test(line);
      STATUS_RE.lastIndex = 0;
      const d = DONE_RE.test(line);
      DONE_RE.lastIndex = 0;
      if (!s && !d) return false;
      // 形如「扫「待落」「刻意未落」…」/「状态性词汇（…」/ 列出多个词的清单行→ 引用而非陈述
      const quotedWords = (line.match(/[「『][^」』]{1,12}[」』]/g) ?? []).length;
      const mentionsRule = /状态性表述|状态性词汇|弱规则|扫描|扫「|扫「|门禁/.test(line);
      return quotedWords >= 2 || mentionsRule;
    };

    /** 就近（±6 行）找迁移名；which='onDisk' 只认已在磁盘的，'any' 不论在不在都返回 */
    const nearestMig = (idx: number, which: 'onDisk' | 'any'): string | null => {
      const lo = Math.max(0, idx - 6);
      const win = lines.slice(lo, Math.min(lines.length, idx + 7));
      let best: string | null = null;
      let bestDist = Infinity;
      win.forEach((l, k) => {
        for (const name of l.match(MIG_RE) ?? []) {
          if (which === 'onDisk' && !migDirs.includes(name)) continue;
          const dist = Math.abs(k - (idx - lo));
          if (dist < bestDist) {
            bestDist = dist;
            best = name;
          }
        }
      });
      return best;
    };

    lines.forEach((line, idx) => {
      if (isQuoteOfWordList(line)) return; // 跳过「引用状态词表」的行

      // 规则 A：文档说「未做」→ 若邻近迁移已在磁盘，报矛盾
      const hits = [...new Set(line.match(STATUS_RE) ?? [])];
      if (hits.length) {
        const onDisk = nearestMig(idx, 'onDisk');
        console.log(
          `  [WARN] ${f}:${idx + 1} 状态性表述 ${hits.join('/')}` +
            (onDisk
              ? ` — ⚠️ 最近的迁移 **已在磁盘**: ${onDisk}\n         → 需人工核对：文档说未做、磁盘已做？`
              : ' — 邻近无「已落盘」迁移（大概率是正常的「待落」）'),
        );
      }

      // 规则 B（主理人 2026-10 要求，与 A 对称）：文档说「已落」→ 若邻近迁移在磁盘上找不到，报矛盾。
      // **B 比 A 更危险**：文档声称已完成，接手的人不会再去查；而 A 那种「文档说未做但已做」
      // 至少还有人在盯着这条变更记录。
      const done = [...new Set(line.match(DONE_RE) ?? [])];
      if (done.length) {
        // **必须检查邻近窗口内提到的「所有」迁移名**，不能只看最近的一个：
        // 反向验证实测——把 backfill 迁移名换成磁盘上不存在的幽灵迁移后，
        // 只看「最近一个」的版本会先撞上同段落里另一个**确实存在**的迁移而放行，
        // 导致规则 B 形同虚设。故这里收集全部并逐个核对。
        const lo = Math.max(0, idx - 6);
        const win = lines.slice(lo, Math.min(lines.length, idx + 7));
        const named = new Set<string>();
        win.forEach((l) => {
          for (const name of l.match(MIG_RE) ?? []) named.add(name);
        });
        const ghosts = [...named].filter((n) => !migDirs.includes(n));
        if (ghosts.length) {
          console.log(
            `  [WARN] ${f}:${idx + 1} 完成性表述 ${done.join('/')} — ⚠️ 提到的迁移 **不在磁盘**: ${ghosts.join(', ')}\n         → 需人工核对：文档说已做、磁盘没有？`,
          );
        }
      }
    });
  }
  console.log('  [INFO]段 5 为弱规则：只报 WARN 不计入退出码（需人判断，机器无法区分「刻意攒着」与「漏迁移」）');
}

// ── 段 6：配置域单一事实源（CONFIG_DOMAIN_GROUPS）──────────────────────
console.log('\n── 段 6：配置域分组单一事实源 ──');
{
  // **直接从 shared 源文件按名取导出**（S 只是 SYSTEM_CONFIG_DEFAULTS，不是模块对象）
  const sharedSrc = readFileSync(
    resolve(repoRoot, 'packages/shared/src/constants.ts'),
    'utf8',
  );
  /** 取一个导出常量的对象字面量（只支持本仓 shared 里的 `as const` 对象形态） */
  const objLiteralOf = (name: string): Record<string, string[] | string> | null => {
    const i = sharedSrc.indexOf(`export const ${name}`);
    if (i < 0) return null;
    const start = sharedSrc.indexOf('{', i);
    if (start < 0) return null;
    let depth = 0;
    for (let k = start; k < sharedSrc.length; k++) {
      if (sharedSrc[k] === '{') depth++;
      else if (sharedSrc[k] === '}') {
        depth--;
        if (depth === 0) {
          const body = sharedSrc.slice(start + 1, k);
          const out: Record<string, string[] | string> = {};
          // 匹配 `键: ['a','b']` 与 `'键': '值'` 两种形态
          for (const m of body.matchAll(/(?:^|\n)\s*'?([A-Za-z_\u4e00-\u9fa5]+)'?\s*:\s*\[([^\]]*)\]/g)) {
            out[m[1]!] = [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
          }
          for (const m of body.matchAll(/(?:^|\n)\s*'?([A-Za-z_\u4e00-\u9fa5]+)'?\s*:\s*'([^']*)'/g)) {
            if (!(m[1]! in out)) out[m[1]!] = m[2]!;
          }
          return out;
        }
      }
    }
    return null;
  };
  /** 取顶层 `export const NAME: ... = ['a','b']` 或 Set 的字符串元素 */
  const arrOf = (name: string): string[] => {
    const i = sharedSrc.indexOf(`export const ${name}`);
    if (i < 0) return [];
    const seg = sharedSrc.slice(i, sharedSrc.indexOf('\n', i) + 400);
    return [...seg.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  };

  const CONFIG_DOMAIN_GROUPS = objLiteralOf('CONFIG_DOMAIN_GROUPS') ?? {};
  const CONFIG_LABELS = objLiteralOf('CONFIG_LABELS') ?? {};
  const BIZ_NO_PREFIX = objLiteralOf('BIZ_NO_PREFIX') ?? {};
  const FEN_CONFIGS = new Set(arrOf('FEN_CONFIGS'));
  const BP_CONFIGS = new Set(arrOf('BP_CONFIGS'));

  const GROUP_NAMES = Object.keys(CONFIG_DOMAIN_GROUPS);
  const defaults = Object.keys(S);
  /** 取某组的键数组（值可能是 string[]，本仓分组表均为数组形态） */
  const keysOf = (g: string): string[] => {
    const v = CONFIG_DOMAIN_GROUPS[g];
    return Array.isArray(v) ? v : [];
  };

  // 6.1 分组扁平并集 === SYSTEM_CONFIG_DEFAULTS 键集
  {
    const flat = GROUP_NAMES.flatMap((g) => keysOf(g));
    const uniq = [...new Set(flat)].sort();
    const dflt = [...defaults].sort();
    const missing = dflt.filter((k) => !uniq.includes(k));
    const extra = uniq.filter((k) => !dflt.includes(k));
    if (missing.length) {
      console.log(`  [FAIL] 6.1 未归组的配置键 ${missing.length} 个: ${missing.join(', ')}`);
      console.log('         → 运营筛该组时它出不来，且没人知道它属于哪一域');
      diff++;
    } else if (extra.length) {
      console.log(`  [FAIL] 6.1 分组里的键不在 SYSTEM_CONFIG_DEFAULTS: ${extra.join(', ')}`);
      diff++;
    } else {
      console.log(`  [PASS] 6.1 分组扁平并集 === SYSTEM_CONFIG_DEFAULTS（${uniq.length} 键，双向差集为空）`);
    }
  }

  // 6.2 每个配置键恰好出现在 1 个组
  {
    const flat = GROUP_NAMES.flatMap((g) => keysOf(g));
    const dup = [...new Set(flat.filter((k, i) => flat.indexOf(k) !== i))];
    if (dup.length) {
      console.log(`  [FAIL] 6.2 重复归属的键: ${dup.join(', ')}`);
      console.log('         → 运营在前端 A 组看到它、服务端却按 B 组筛（report_reward 曾踩此坑）');
      diff++;
    } else {
      console.log(`  [PASS] 6.2 ${flat.length} 键均恰好归属 1 个组（无重复）`);
    }
  }

  // 6.3 前端 config-meta.ts 不得再有 CONFIG_GROUPS 对象字面量（双写面已消除）
  {
    const p = 'apps/admin-web/src/shared/config-meta.ts';
    let src = '';
    try {
      src = readFileSync(resolve(repoRoot, p), 'utf8');
    } catch {
      console.log(`  [FAIL] 6.3 读不到 ${p}`);
      diff++;
    }
    if (src) {
      const hasLiteral = /CONFIG_GROUPS\s*(?::[^=]*)?=\s*\{/.test(src);
      const reexports = /CONFIG_DOMAIN_GROUPS/.test(src);
      if (hasLiteral) {
        console.log(`  [FAIL] 6.3 ${p} 仍在本地写 CONFIG_GROUPS 字面量（双写面未消除）`);
        diff++;
      } else if (!reexports) {
        console.log(`  [FAIL] 6.3 ${p} 既无字面量也未引用 CONFIG_DOMAIN_GROUPS（应re-export shared）`);
        diff++;
      } else {
        console.log(`  [PASS] 6.3 前端已 re-export shared（无本地字面量，双写面已消除）`);
      }
    }
  }

  // 6.4 服务端 admin.routes.ts 的 zod group 取值域 === shared 组名集合
  //     **读源码文本 + 正则提取，不 import 服务端**（import 会拉起 prisma client）
  {
    const p = 'apps/server/src/modules/admin/admin.routes.ts';
    try {
      const src = readFileSync(resolve(repoRoot, p), 'utf8');
      const derived = /Object\.keys\(CONFIG_DOMAIN_GROUPS\)/.test(src);
      const hardcoded = /group:\s*z\s*\.enum\(\s*\[([^\]]*)\]/.exec(src);
      if (hardcoded && !derived) {
        const literals = [...hardcoded[1]!.matchAll(/'([^']+)'/g)]
          .map((m) => m[1]!)
          .filter((v) => !/^[A-Z_]+$/.test(v)); // 滤掉英文 key，只看中文组名
        const extra = literals.filter((g) => !GROUP_NAMES.includes(g));
        const missing = GROUP_NAMES.filter((g) => !literals.includes(g));
        console.log(`  [FAIL] 6.4 服务端 group 仍是硬编码 zod 枚举，非派生`);
        console.log(`         zod 里的中文组名: ${literals.join(', ') || '(无)'}`);
        if (missing.length) {
          console.log(`         →🔴 ${missing.length}/${GROUP_NAMES.length} 个组会被 zod 判非法 → 运营点得到但查询 400（前端只显示通用错误）：`);
          missing.forEach((g) => console.log(`            · ${g}`));
        }
        if (extra.length) console.log(`         多余组名: ${extra.join(', ')}`);
        diff++;
      } else if (derived) {
        console.log(`  [PASS] 6.4 服务端 zod 从 CONFIG_DOMAIN_GROUPS 派生（${GROUP_NAMES.length} 组自动生效，加组永不再漂）`);
      } else {
        console.log(`  [FAIL] 6.4 服务端 group 参数形态未知（既非派生也非硬编码枚举），请人工检查`);
        diff++;
      }
    } catch {
      console.log(`  [FAIL] 6.4 读不到 ${p}`);
      diff++;
    }
  }

  // 6.5 SYSTEM_CONFIG_DEFAULTS 键集 === 前端 mock db.ts 里system_configs 键集
  {
    const p = 'apps/admin-web/src/api/mock/db.ts';
    try {
      const src = readFileSync(resolve(repoRoot, p), 'utf8');
      // db.ts 的 systemConfigs 由 Object.entries(SYSTEM_CONFIG_DEFAULTS).map 生成，
      // 故此处核的是「是否还残留手写的 configKey 数组」——若存在手写数组即双写面。
      const manualKeys = [...src.matchAll(/configKey:\s*'([a-z_]+)'/g)].map((m) => m[1]!);
      const usesDefaults = /SYSTEM_CONFIG_DEFAULTS/.test(src);
      if (manualKeys.length) {
        const unknown = manualKeys.filter((k) => !defaults.includes(k));
        console.log(
          `  [INFO] 6.5 ${p} 有 ${manualKeys.length} 处手写 configKey` +
            (unknown.length ? `，其中 ${unknown.length} 个不在 shared: ${unknown.join(', ')}` : '，全部存在于 shared'),
        );
        console.log('         → 已核实：这些是「配置变更历史 mock 记录」（带 beforeValue/afterValue/操作人），');
        console.log('           不是配置定义本身，故不属双写面。真配置键仍走 SYSTEM_CONFIG_DEFAULTS 单一来源');
      } else if (!usesDefaults) {
        console.log(`  [FAIL] 6.5 ${p} 既无手写 configKey 也未引用 SYSTEM_CONFIG_DEFAULTS`);
        diff++;
      } else {
        console.log(`  [PASS] 6.5 前端 mock system_configs 直接消费 SYSTEM_CONFIG_DEFAULTS（无双写面）`);
      }
    } catch {
      console.log(`  [FAIL] 6.5 读不到 ${p}`);
      diff++;
    }
  }

  // 6.6 组名与 CONFIG_LABELS 键集无孤儿（WARN：LABELS 里的键必须在某组内）
  {
    const orphans = Object.keys(CONFIG_LABELS ?? {}).filter((k) => {
      return !GROUP_NAMES.some((gn) => keysOf(gn).includes(k));
    });
    const unlabeled = defaults.filter((k) => !(CONFIG_LABELS ?? {})[k]);
    if (orphans.length) {
      console.log(`  [WARN] 6.6 CONFIG_LABELS 里这些键未归任何组（中文名永远不会被用到）: ${orphans.join(', ')}`);
    }
    if (unlabeled.length) {
      console.log(`  [INFO] 6.6 ${unlabeled.length} 个配置键无中文名（前端回退显示 key 原名，符合设计「不丢信息」）`);
    }
    if (!orphans.length && !unlabeled.length) {
      console.log(`  [PASS] 6.6 CONFIG_LABELS 与分组无孤儿，且全部键都有中文名`);
    }
  }

  // 6.7 号段登记：genBizNo('xxx') 调用点的 type 必须 ∈ BIZ_NO_PREFIX
  //     注：TS 编译期已由 `BizNoType = keyof typeof BIZ_NO_PREFIX` 保证正向合法性，
  //     tsc 抓不到的是**反向**——BIZ_NO_PREFIX 里登记了但全库从未使用的死键。
  //     故本条双向核对：漏登记（tsc 兜底）+ 死键（本条独有）。
  {
    const prefixKeys = Object.keys(BIZ_NO_PREFIX ?? {});
    // 扫全库 genBizNo('xxx') 字面量调用
    const calls: string[] = [];
    const walk = (dir: string) => {
      let ents: import('node:fs').Dirent[] = [];
      try {
        ents = readdirSync(resolve(repoRoot, dir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of ents) {
        const rel = `${dir}/${ent.name}`;
        if (ent.isDirectory()) walk(rel);
        else if (ent.name.endsWith('.ts')) {
          try {
            const src = readFileSync(resolve(repoRoot, rel), 'utf8');
            for (const m of src.matchAll(/genBizNo\(\s*'([a-zA-Z_]+)'/g)) calls.push(m[1]!);
          } catch {
            /* 读不到就跳过 */
          }
        }
      }
    };
    walk('apps/server/src');
    const used = [...new Set(calls)].sort();
    const dead = prefixKeys.filter((k) => !used.includes(k)).sort();
    const missing = used.filter((k) => !prefixKeys.includes(k)).sort();
    console.log(`  [INFO] 6.7 genBizNo 调用 ${calls.length} 处 / ${used.length} 个类型；BIZ_NO_PREFIX ${prefixKeys.length} 键`);
    if (missing.length) {
      console.log(`  [FAIL] 6.7 这些调用类型未登记在 BIZ_NO_PREFIX: ${missing.join(', ')}`);
      diff++;
    } else {
      console.log(`  [PASS] 6.7-a 漏登记（用了但未登记）= 0 个`);
    }

    // 6.7-b 登记未使用 = **ERROR**（主理人 2026-10 加严）
    //
    // 【为什么从 WARN 加严为 ERROR】
    //   主理人原话：「我上一轮吃过『登记了但没有调用点 = 号段空占』的亏
    //   （policy/commission 至今是死键）」「6.7-b 我已裁定加严为
    //   『登记未使用也必须为 0（除白名单）』—— 白名单要**逐条写明理由**」。
    //   之前是 WARN = 「提醒但不挡人」；现在主理人明确要求挡人。
    //
    // 【白名单：每条必须写明「为什么不需要」】
    //   硬要求（主理人原话）：「policy/commission 若要进白名单，理由必须具体
    //   （哪个业务线在规划中、预计何时接），不能写『先留着』」。
    //   故白名单项写明：① 业务线 ② 当前为何不产生该单号 ③ 接入时补什么。
    //   **白名单与 constants.ts 的形态说明是同一份事实的两处副本**
    //   （形态说明在「键的主人」那边，白名单在「检查者」这边）—— 两处都要写。
    const BIZ_NO_DEAD_ALLOWLIST: Record<string, string> = {
      policy:
        '保险产品线（规划中，MVP 不接保险）。当前保险产品/条款由 system_configs 驱动' +
        '（架构 §7 阈值配置化），不建独立 policy 单据表 → 不产生「政策单号」。' +
        '接入保险产品线时：补 policy 单据表.列名 + genBizNo 调用点，并从本白名单移除。',
      commission:
        '佣金独立成单（规划中，MVP 佣金随分账走）。当前佣金在 profit_sharing_records ' +
        '内闭环计算与落库，不存在独立的「佣金单号」业务对象 → 不产生该单号。' +
        '佣金独立成单时：补 commissions.列名 + genBizNo 调用点，并从本白名单移除。',
    };
    const deadNotAllowed = dead.filter((k) => !(k in BIZ_NO_DEAD_ALLOWLIST));
    const deadAllowed = dead.filter((k) => k in BIZ_NO_DEAD_ALLOWLIST);
    if (deadNotAllowed.length) {
      console.log(
        `  [FAIL] 6.7-b 登记未使用（登记了但全库无调用点，且不在白名单）: ${deadNotAllowed.join(', ')}`,
      );
      console.log(
        '         → 号段空占 = 有一层没人用的登记，迟早与真实口径脱节。' +
          '处置二选一：① 删掉该键 ② 补上落库表.列名 + 调用点 + 写明「为什么不需要」并进白名单',
      );
      diff++;
    } else if (deadAllowed.length) {
      console.log(
        `  [PASS] 6.7-b 登记未使用 = 0 个（白名单 ${deadAllowed.length} 项：${deadAllowed.join(', ')}）`,
      );
      for (const k of deadAllowed) {
        console.log(`         → 白名单理由：${BIZ_NO_DEAD_ALLOWLIST[k]}`);
      }
      console.log(
        '         → ⚠️ 白名单每条必须在 constants.ts 的 BIZ_NO_PREFIX 形态说明里同步写一遍' +
          '（两处副本：键的主人 + 检查者），否则改一处就漂',
      );
    } else {
      console.log(`  [PASS] 6.7-b 登记未使用 = 0 个`);
    }
  }

  // 6.8 探针不得变成门禁（主理人 2026-10 裁定第 3 点）
  //
  // 【背景】`scripts/probes/` 下是一次性诊断探针（记录「当时怎么定位到问题的」），
  //   删了就丢了排查路径；但它躺在 scripts/ 目录里，任何人看到都可能当成正式门禁去执行。
  //   故主理人裁定：**留，但改名 + 加禁止执行标记 + 用断言钉住「不得被引用」**。
  //   本条就是那个「不得被引用」的断言 —— 把纪律变成可执行的检查，而不是靠人记住。
  //
  // 【为什么这条要放在 6.x 而不是独立一段】
  //   它与 6.7 同属「登记与引用的一致性」这一族（6.7 管号段登记，6.8 管脚本登记），
  //   放一起便于对照。段号沿用主理人派单时的表述「加到段 6 里作为 6.7」——
  //   我把它编为 6.8（6.7 已被号段占用），编号差异不改变裁定内容。
  {
    const probesDir = resolve(repoRoot, 'apps/server/scripts/probes');
    let probeFiles: string[] = [];
    try {
      probeFiles = readdirSync(probesDir).filter((f) => /\.(ts|mjs|cjs|js)$/.test(f));
    } catch {
      probeFiles = [];
    }
    if (!probeFiles.length) {
      console.log('  [INFO] 6.8 scripts/probes/ 不存在或为空（无探针可校验）');
    } else {
      // 扫全仓所有 package.json 的 scripts 字段，找有没有引用 probes 下的文件
      const pkgDirs = [
        'package.json',
        'apps/server/package.json',
        'apps/admin-web/package.json',
        'apps/miniapp-user/package.json',
        'apps/miniapp-companion/package.json',
        'packages/shared/package.json',
      ];
      const violations: string[] = [];
      for (const rel of pkgDirs) {
        let raw = '';
        try {
          raw = readFileSync(resolve(repoRoot, rel), 'utf8');
        } catch {
          continue;
        }
        // 只取 "scripts" 块，避免误伤其它字段里出现的路径
        const m = raw.match(/"scripts"\s*:\s*\{([\s\S]*?)\n\s{2}\}/);
        const scriptsBlock = m?.[1] ?? '';
        for (const f of probeFiles) {
          if (scriptsBlock.includes(f)) {
            violations.push(`${rel} → ${f}`);
          }
        }
      }
      if (violations.length) {
        console.log(
          `  [FAIL] 6.8 探针被 npm script 引用 ${violations.length} 处: ${violations.join('; ')}`,
        );
        console.log('         → 探针是一次性诊断工具，被引用就意味着它变成了门禁（可能引入依赖/耗时/不稳定）');
        diff++;
      } else {
        console.log(
          `  [PASS] 6.8 探针（${probeFiles.length} 个: ${probeFiles.join(', ')}）未被任何 package.json 的 script 引用`,
        );
      }
    }
  }

  // 6.9 **门禁覆盖清单不得漂移**（2026-10-22 承钧新增，主理人裁定用 WARN 不用 ERROR）
  //
  // 【为什么需要这条】`docs/GATE-COVERAGE.md` 集中列了全仓门禁的「守什么/不守什么」。
  //   但**文档本身也会漂移** —— 新增门禁忘了加进文档，那这份文档就是过期的，
  //   而过期的门禁清单比没有更坏：它让人以为「已覆盖」而实际漏了域。
  //   故把「清单里的门禁都真的存在」变成可执行断言。
  //
  // 【两档判定 —— 与守门测试三态同源】
  //   ① 脚本在磁盘上但未挂进任何 package.json scripts → **WARN**
  //     理由：本项目常态是「先写脚本，再接线到 pretest / verify:all」，
  //     中间态必然存在。若用 ERROR，会逼人改文案而不是改代码。
  //   ② scripts 里引用了但脚本在磁盘上不存在 → **ERROR**
  //     理由：这是真事故 —— 该门禁**必然失败**（npm 报 script 不存在），
  //     且它可能挡住整条 CI 链路。
  {
    const COVERAGE_DOC = 'docs/GATE-COVERAGE.md';
    // 清单里出现的门禁命令名 → 期望能在某个 package.json 的 scripts 里找到
    let docRaw = '';
    try {
      docRaw = readFileSync(resolve(repoRoot, COVERAGE_DOC), 'utf8');
    } catch {
      docRaw = '';
    }

    if (!docRaw) {
      console.log(`  [INFO] 6.9 ${COVERAGE_DOC} 不存在，跳过清单漂移校验`);
    } else {
      // 只认「出现在反引号里、且长得像命令」的那类，避免把散文里的字眼当门禁名
      const declared = new Set<string>();
      for (const m of docRaw.matchAll(/`(npm run [\w:-]+|npx [\w@/.\- ]+)`/g)) {
        declared.add(m[1]!);
      }

      // 汇总所有 package.json 的 scripts 块
      const scriptsText: string[] = [];
      for (const rel of [
        'package.json',
        'apps/server/package.json',
        'apps/admin-web/package.json',
        'apps/miniapp-user/package.json',
        'apps/miniapp-companion/package.json',
        'packages/shared/package.json',
      ]) {
        try {
          const raw = readFileSync(resolve(repoRoot, rel), 'utf8');
          const m = raw.match(/"scripts"\s*:\s*\{([\s\S]*?)\n\s{2}\}/);
          scriptsText.push(m?.[1] ?? '');
        } catch {
          /* 读不到就跳过 */
        }
      }
      const allScripts = scriptsText.join('\n');

      // ① 清单里写了、但 scripts 里找不到 → WARN（中间态）
      const unwired: string[] = [];
      for (const cmd of declared) {
        // `npm run xxx` → 取 xxx；`npx vitest ...` 这类不参与（它们不是脚本名）
        const m = cmd.match(/^npm run ([\w:-]+)$/);
        if (!m) continue;
        if (!allScripts.includes(`"${m[1]}"`)) unwired.push(m[1]!);
      }

      // ② scripts 里引用了但脚本文件不存在 → ERROR（真事故）
      const brokenScripts: string[] = [];
      for (const rel of [
        'package.json',
        'apps/server/package.json',
        'apps/admin-web/package.json',
        'apps/miniapp-user/package.json',
        'apps/miniapp-companion/package.json',
      ]) {
        let raw = '';
        try {
          raw = readFileSync(resolve(repoRoot, rel), 'utf8');
        } catch {
          continue;
        }
        const m = raw.match(/"scripts"\s*:\s*\{([\s\S]*?)\n\s{2}\}/);
        const block = m?.[1] ?? '';
        for (const s of block.matchAll(/:\s*"([^"]*\.(?:ts|mjs|cjs|js))"/g)) {
          const cmd = s[1]!;
          // 取脚本路径：tsx xxx.ts / node xxx.mjs / node scripts/xxx.mjs
          const parts = cmd.split(/\s+/).filter(Boolean);
          const target = parts.find((p) => /\.(ts|mjs|cjs|js)$/.test(p));
          if (!target) continue;
          if (!existsSync(resolve(repoRoot, rel, '..', target))) {
            brokenScripts.push(`${rel} → ${target}`);
          }
        }
      }

      if (brokenScripts.length) {
        console.log(
          `  [FAIL] 6.9 scripts 引用了磁盘上不存在的脚本 ${brokenScripts.length} 处: ${brokenScripts.join('; ')}`,
        );
        console.log('         → 该 npm script 必然失败（module not found），且可能挡住整条 CI 链路');
        diff++;
      } else {
        console.log(
          `  [PASS] 6.9-b scripts 引用的脚本都存在于磁盘（清单内 npm run 命令 ${declared.size} 个已核）`,
        );
      }

      if (unwired.length) {
        console.log(
          `  [WARN] 6.9-a ${COVERAGE_DOC} 列了但未挂进 package.json scripts: ${unwired.join(', ')}`,
        );
        console.log(
          '         → 中间态（本项目常态是先写脚本再接线），**故意用 WARN 不用 ERROR**：'
          + '门禁已存在但还没被接进流水线，接线是待办不是事故。',
        );
      } else {
        console.log(`  [PASS] 6.9-a 清单里的 npm run 命令都已接进 package.json scripts`);
      }
    }
  }
}

process.exit(diff === 0 ? 0 : 1);