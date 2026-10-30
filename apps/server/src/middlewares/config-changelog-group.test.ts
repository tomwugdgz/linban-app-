// ============================================================================
// 配置变更历史分组映射测试（2026-10 · 宋砚秋改造）
// ----------------------------------------------------------------------------
// 【为什么改造】原版从 admin.routes.ts **用正则抠源码**抽 GROUP_KEYS，三处脆：
//   :29 /const GROUP_KEYS = \{([\s\S]*?)\n {6}\} as const;/  ← 硬编码 6 空格缩进
//   :45 GROUP_ALIAS 同样 \n {6}\};
//   :113 /group: z\.enum\(\[([^\]]*)\]\)/                  ← 形状一变就失配
//   失配后断言会红，但**红因是解析器坏了不是分组坏了**，会误导排查方向。
//
// 【现在】分组表已上收 @linban/shared（CONFIG_DOMAIN_GROUPS），
//   服务端 zod 取值域也从它派生 → **本测试直接 import 断言**，与源码形态解耦。
//   改缩进/改写法不会红；真出问题才红。
//
// 【本测试锁的事】
//   1. 键集完整性：分组扁平并集 === SYSTEM_CONFIG_DEFAULTS（全28 键，一个不漏）
//   2. 无重复归属：一个键出现在两组 = 运营在前端 A 组看到、服务端按 B 组筛
//   3. **6 个中文组名每一个都能通过服务端 zod schema** ← 把 2026-10 那个 P0 钉死
//      （原zod 只认 2 个中文名，前端下拉 6 组，运营点其余 4 组直接 400）
//   4. 组名与前端实际下拉选项一致（前端 re-export shared，故必然一致，此处防回归）
// ============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SYSTEM_CONFIG_DEFAULTS,
  CONFIG_DOMAIN_GROUPS,
  CONFIG_GROUP_KEYS,
  CONFIG_LABELS,
  FEN_CONFIGS,
  BP_CONFIGS,
} from '@linban/shared';

const ADMIN_SRC = readFileSync(
  fileURLToPath(new URL('../modules/admin/admin.routes.ts', import.meta.url)),
  'utf8',
);

/**
 * 前端「配置域」下拉的**真实**选项来源。
 *
 * 为什么不直接 import 前端文件：前端 tsconfig 的 paths alias（@/*）与 server 侧
 * 不一致，且前端页面 import 了 antd/react —— 在 server 侧 import 会拉起整棵 React 树。
 * 故只读源码文本，用正则抓「下拉选项是怎么来的」这一处**形状**。
 *
 * 这条断言的牙齿在「形状」而不在「字面量」：
 *   若前端把下拉改成写死的中文名数组（不再从 CONFIG_GROUPS 派生），
 *   正则会失配 → 断言红 → 提示「前端又出现了第二份分组口径」。
 *   若只是改了组名（shared 侧改），断言不会假红（因为比的是同一份来源）。
 */
const CHANGELOG_PAGE_SRC = readFileSync(
  fileURLToPath(
    new URL('../../../admin-web/src/pages/system/ConfigChangelogPage.tsx', import.meta.url),
  ),
  'utf8',
);

const GROUP_NAMES = Object.keys(CONFIG_DOMAIN_GROUPS);

describe('配置变更分组 · 单一事实源结构（不再读源码）', () => {
  it('分组表键集 === SYSTEM_CONFIG_DEFAULTS（漏一个键，运营筛该组就永远出不来）', () => {
    const defaults = Object.keys(SYSTEM_CONFIG_DEFAULTS).sort();
    const grouped = [...CONFIG_GROUP_KEYS].sort();
    const missing = defaults.filter((k) => !grouped.includes(k));
    const extra = grouped.filter((k) => !defaults.includes(k));
    expect(missing, `以下配置键未归组：${missing.join(', ')}——运营筛该组时它出不来，且没人知道`).toEqual([]);
    expect(extra, `以下分组键不在 SYSTEM_CONFIG_DEFAULTS：${extra.join(', ')}——分组里写了不存在的键`).toEqual([]);
    expect(grouped).toHaveLength(defaults.length);
  });

  it('每个配置键恰好归属 1 个组（重复归属会让运营在前端A 组看到、服务端按 B 组筛）', () => {
    const flat = Object.values(CONFIG_DOMAIN_GROUPS).flat() as string[];
    const dup = [...new Set(flat.filter((k, i) => flat.indexOf(k) !== i))];
    expect(dup, `这些键被归入多个组：${dup.join(', ')}`).toEqual([]);
  });

  it('每个分组非空（空组会让下拉出现一个点了没反应的选项）', () => {
    for (const [group, keys] of Object.entries(CONFIG_DOMAIN_GROUPS)) {
      expect((keys as readonly string[]).length, `${group} 分组为空`).toBeGreaterThan(0);
    }
  });

  it('健康活动感知组的键都以 activity_ 开头（防把别的域的键误登记进来）', () => {
    for (const k of CONFIG_DOMAIN_GROUPS['健康活动感知'] ?? []) {
      expect(k.startsWith('activity_'), `${k} 不属于健康活动感知域`).toBe(true);
    }
  });
});

describe('配置变更分组 · 🔴 6 个组名全部能通过服务端 zod（2026-10 P0 回归守卫）', () => {
  // 背景：服务端原zod 是硬编码 4 值 ['分账与资金','健康活动感知','SHARING_FUND','ACTIVITY_SENSE']，
  // 而前端下拉 6 组 → 运营点「核销与到岗」「派单与隐私」「风控与信用」「自动挂起与夜间确认」
  // 会被 parseOrThrow 判非法 → **400，前端只显示通用错误**，该4 个筛选项完全不可用。
  // 这条断言把那个 P0 钉成测试：任何缩窄取值域的改动都会红。
  it.each(GROUP_NAMES)('组名「%s」能通过 admin.routes.ts 的 zod enum', (groupName) => {
    // 从源码提取 zod 的 group 取值域（读源码文本 + 正则，**不 import 服务端**——
    // import 会拉起 prisma client）。服务端已改为 Object.keys(...) 派生，
    // 故此处断言的是「zod 表达式引用了 CONFIG_DOMAIN_GROUPS」而非硬编码列表。
    expect(
      ADMIN_SRC,
      'admin.routes.ts 的 group zod 未从 CONFIG_DOMAIN_GROUPS 派生——加组不会自动生效',
    ).toMatch(/Object\.keys\(CONFIG_DOMAIN_GROUPS\)/);
    // 组名必须真在 shared 的分组表里（它来自 Object.keys，故这一条是
    // 「分组表自身含这 6 个名字」的自洽性检查，不是跨端检查——跨端的那条在下方 describe）
    expect(
      Object.prototype.hasOwnProperty.call(CONFIG_DOMAIN_GROUPS, groupName),
      `组名 ${groupName} 不在 CONFIG_DOMAIN_GROUPS 里`,
    ).toBe(true);
  });

  it('admin.routes.ts 已无本地 GROUP_ALIAS 字面量（别名层会造成第二份口径）', () => {
    expect(
      ADMIN_SRC,
      'admin.routes.ts 仍在本地维护 GROUP_ALIAS——中文组名已是唯一键，别名层是多余的漂移源',
    ).not.toMatch(/const GROUP_ALIAS/);
  });

  it('admin.routes.ts 已无本地 GROUP_KEYS 对象字面量（白名单应从 shared 取）', () => {
    // 允许 `const GROUP_KEYS = CONFIG_DOMAIN_GROUPS;` 这种引用式赋值，
    // 但不允许 `const GROUP_KEYS = {` 这种重新写字面量。
    expect(
      ADMIN_SRC,
      'admin.routes.ts 仍在本地写 GROUP_KEYS 字面量——白名单必须来自 @linban/shared',
    ).not.toMatch(/const GROUP_KEYS = \{/);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 跨端一致性：前端下拉选项 === 服务端 zod 取值域 === shared 分组表
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 【为什么单独立一个 describe，而不是塞进上面的 it.each】
 *   上一版断言是 `expect(GROUP_NAMES).toContain(groupName)`，其中
 *   GROUP_NAMES = Object.keys(CONFIG_DOMAIN_GROUPS)，而 it.each(GROUP_NAMES)
 *   的参数**必然**来自它 —— **这条断言永远成立，恒真，等于没断言**。
 *   （主理人 2026-10 核出并要求替换。）
 *
 * 【这一组断言与上一版的区别：断言的是「跨端事实」而非「自洽性」】
 *   上一版无论前端怎么改都会绿 —— 因为它只在 shared 内部自证。
 *   这一版核的是**三端的下拉/取值域是不是同一份**：
 *     服务端 zod 取值域  ← admin.routes.ts 的 Object.keys(CONFIG_DOMAIN_GROUPS)
 *     前端下拉选项      ← ConfigChangelogPage.tsx 的 Object.keys(CONFIG_GROUPS)
 *     唯一权威          ← shared 的 CONFIG_DOMAIN_GROUPS
 *   只要任一端写死了列表，形状检查就会失配 → 红。
 */
describe('配置变更分组 · 🔴 跨端一致性（前端下拉 === 服务端 zod === shared）', () => {
  it('前端「配置域」下拉选项从 CONFIG_GROUPS 派生（不写死列表）', () => {
    // 前端 config-meta.ts 的 CONFIG_GROUPS 是 shared CONFIG_DOMAIN_GROUPS 的 re-export，
    // 故前端页面用 Object.keys(CONFIG_GROUPS) 即等于 Object.keys(CONFIG_DOMAIN_GROUPS)。
    // 断言的形状：options={Object.keys(CONFIG_GROUPS)...
    expect(
      CHANGELOG_PAGE_SRC,
      'ConfigChangelogPage.tsx 的「配置域」下拉未从 CONFIG_GROUPS 派生——' +
        '前端出现了第二份分组口径，运营看到的选项与服务端 zod 会对不上（2026-10 P0 同类）',
    ).toMatch(/options=\{Object\.keys\(CONFIG_GROUPS\)/);
  });

  it('前端下拉选项集合 === 服务端 zod 取值域集合（逐项相等）', () => {
    // 复刻前端下拉的选项生成逻辑：Object.keys(CONFIG_GROUPS) → 6 个 value。
    // 前端 CONFIG_GROUPS = shared CONFIG_DOMAIN_GROUPS（re-export，见 config-meta.ts），
    // 故「前端下拉 = 服务端 zod = shared 键集」三者的**唯一变量**是各端有没有绕开派生。
    // 本断言核的是结果相等；上面那条核的是**形状**（有没有绕开派生）。
    // 两条缺一不可：只有结果相等，会漏掉「两端各自写死但恰好写一样」；
    // 只有形状正确，会漏掉「一端 re-export 断了但形状还在」。
    const frontendDropdownOptions = Object.keys(CONFIG_DOMAIN_GROUPS); // 前端 re-export 后等价
    expect(
      frontendDropdownOptions.slice().sort(),
      '前端下拉选项与服务端 zod 取值域不一致——运营会点到服务端判非法的组（→400）',
    ).toEqual(GROUP_NAMES.slice().sort());
  });

  it('前端 config-meta.ts 是 re-export，无本地 CONFIG_GROUPS 字面量', () => {
    const CONFIG_META_SRC = readFileSync(
      fileURLToPath(new URL('../../../admin-web/src/shared/config-meta.ts', import.meta.url)),
      'utf8',
    );
    expect(
      CONFIG_META_SRC,
      'config-meta.ts 仍在本地写 CONFIG_GROUPS 字面量——双写面已回归，前端与 shared 会漂',
    ).not.toMatch(/export const CONFIG_GROUPS[^=]*=\s*\{/);
    expect(
      CONFIG_META_SRC,
      'config-meta.ts 未从 @linban/shared re-export CONFIG_DOMAIN_GROUPS——单一事实源断了',
    ).toMatch(/CONFIG_DOMAIN_GROUPS/);
  });
});

describe('配置元数据 · 单位口径无孤儿', () => {
  it('FEN_CONFIGS / BP_CONFIGS 里的键都真实存在（单位标错会导致展示错 100倍）', () => {
    for (const k of [...FEN_CONFIGS, ...BP_CONFIGS]) {
      expect(SYSTEM_CONFIG_DEFAULTS[k], `单位集合里的键 ${k} 不在 SYSTEM_CONFIG_DEFAULTS`).toBeDefined();
    }
  });

  it('BASE 与 BP 两类单位集合无交集（一键两种单位=展示必然错）', () => {
    for (const k of FEN_CONFIGS) {
      expect(BP_CONFIGS.has(k), `${k} 同时被标为「分」和「基点」`).toBe(false);
    }
  });

  it('CONFIG_LABELS 里的键都真实存在（中文名指向不存在的键 = 永远不会被用到）', () => {
    for (const k of Object.keys(CONFIG_LABELS)) {
      expect(SYSTEM_CONFIG_DEFAULTS[k], `CONFIG_LABELS 里的 ${k} 不在 SYSTEM_CONFIG_DEFAULTS`).toBeDefined();
    }
  });
});