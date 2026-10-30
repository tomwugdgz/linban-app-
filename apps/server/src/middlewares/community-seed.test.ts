// ============================================================================
// 社区种子一致性测试（2026-10）
// ----------------------------------------------------------------------------
// 为什么这组测试必须有：
//
//  `community_code` 是漏斗归因的**业务主键**（主理人裁定，不用自增 id 也不用下标）。
//  一旦 seed 里的 code 与前端 admin-web 的 funnelChannels 对不上：
//   ·后端种了 `GZ_TH_HUA YING`（多一个空格），前端按 `GZ_TH_HUAYING` 查 → 查不到
//   · 运营看到「该小区投放归因全为 0」
//   · **不报错**。功能看起来正常，数据是错的。
//
// 这是典型的「静默失败」：两端各自自洽，拼起来不一致。
// 所以必须机器比对，且比的是**数据本身**而不是两边各自的格式。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SEED_PATH = fileURLToPath(new URL('../../prisma/seed.ts', import.meta.url));
// 本文件在 apps/server/src/middlewares/ → 上溯 3 级到 apps/ → 进 admin-web
const WEB_MOCK_PATH = fileURLToPath(
  new URL('../../../admin-web/src/api/mock/db-activity.ts', import.meta.url),
);
const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

const seedSrc = readFileSync(SEED_PATH, 'utf8');
const webSrc = readFileSync(WEB_MOCK_PATH, 'utf8');
const schemaSrc = readFileSync(SCHEMA_PATH, 'utf8');

/** 从 seed.ts 的 COMMUNITY_SEED 抽出 {code, name} */
function parseSeedCommunities(): Array<{ code: string; name: string }> {
  const block = /const COMMUNITY_SEED[^=]*=\s*\[([\s\S]*?)\n\];/.exec(seedSrc);
  if (!block?.[1]) throw new Error('未能在 seed.ts 定位 COMMUNITY_SEED');
  const out: Array<{ code: string; name: string }> = [];
  const re = /code:\s*'([^']+)',\s*name:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1])) !== null) {
    const code = m[1];
    const name = m[2];
    if (code && name) out.push({ code, name });
  }
  return out;
}

/** 从前端 mock 的 funnelChannels 抽出 {channelKey, channelLabel} */
function parseWebChannels(): Array<{ channelKey: string; channelLabel: string }> {
  const out: Array<{ channelKey: string; channelLabel: string }> = [];
  const re = /channelKey:\s*'([^']+)',\s*channelLabel:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(webSrc)) !== null) {
    const channelKey = m[1];
    const channelLabel = m[2];
    if (channelKey && channelLabel) out.push({ channelKey, channelLabel });
  }
  return out;
}

const SEED = parseSeedCommunities();
const WEB = parseWebChannels();

describe('社区种子 · 两端逐条一致（漏斗归因的业务主键）', () => {
  it('解析器有效：seed 与前端各取到 7 条（解析失效会导致这条红）', () => {
    expect(SEED.length).toBe(7);
    expect(WEB.length).toBe(7);
  });

  it('community_code 集合逐值一致（顺序不敏感，归因靠 code 不靠位置）', () => {
    expect([...SEED.map((c) => c.code)].sort()).toEqual([...WEB.map((c) => c.channelKey)].sort());
  });

  it('社区名称也逐条一致（看板展示名不一致会让运营以为是两个小区）', () => {
    const seedMap = new Map(SEED.map((c) => [c.code, c.name]));
    for (const w of WEB) {
      expect(seedMap.get(w.channelKey), `${w.channelKey} 的名称不一致`).toBe(w.channelLabel);
    }
  });

  it('七个 code 逐条列出核对（防解析器只匹配到部分）', () => {
    expect(SEED.map((c) => c.code).sort()).toEqual([
      'GZ_BY_SANYUANLI',
      'GZ_HZ_CHIGANGJIE',
      'GZ_LW_JINHUAJIE',
      'GZ_PY_SHIQIAOJIE',
      'GZ_TH_HUAYING',
      'GZ_TH_SHIPAIJIE',
      'GZ_YX_BEIJINGJIE',
    ]);
  });

  it('code 格式统一 GZ_<区>_<街道拼音>（区首字母大写，无分隔歧义）', () => {
    for (const c of SEED) {
      expect(c.code, `${c.code} 不符合 GZ_XX_YYY 格式`).toMatch(/^GZ_[A-Z]{2}_[A-Z]+$/);
      // 长度不超过 schema 的 VarChar(32)
      expect(c.code.length).toBeLessThanOrEqual(32);
    }
  });

  it('code 无重复（community_code 有 @unique，重复会让 seed 第二条覆盖第一条）', () => {
    expect(new Set(SEED.map((c) => c.code)).size).toBe(SEED.length);
    expect(new Set(SEED.map((c) => c.name)).size).toBe(SEED.length);
  });
});

describe('社区种子 · 不编造坐标（编坐标比空值更危险）', () => {
  it('seed 里不出现 lng/lat 赋值', () => {
    const block = /const COMMUNITY_SEED[\s\S]*?\n\];/.exec(seedSrc);
    const body = block?.[0] ?? '';
    // 只允许 code / name 两个字段
    expect(body).not.toMatch(/\blng\s*:/);
    expect(body).not.toMatch(/\blat\s*:/);
    expect(body).not.toMatch(/distributor_id\s*:/);
  });

  it('seedCommunities 的 create 里也不设坐标（数据在 create 时才落库）', () => {
    const fn = /async function seedCommunities[\s\S]*?\n\}/.exec(seedSrc);
    const body = fn?.[0] ?? '';
    expect(body).toContain('city: \'广州市\'');
    expect(body).not.toMatch(/\blng\s*:/);
    expect(body).not.toMatch(/\blat\s*:/);
  });

  it('schema 侧 lng/lat 确实是可空（上面两条的前提）', () => {
    const block = /model communities \{([\s\S]*?)\n\}/.exec(schemaSrc);
    const body = block?.[1] ?? '';
    expect(body).toMatch(/lng\s+Decimal\?\s+@db\.Decimal\(10,\s*6\)/);
    expect(body).toMatch(/lat\s+Decimal\?\s+@db\.Decimal\(10,\s*6\)/);
    expect(body).toMatch(/distributor_id\s+BigInt\?/);
  });
});

describe('社区种子 · 幂等', () => {
  it('按 community_code upsert（该列有唯一索引，可作 upsert 键）', () => {
    const fn = /async function seedCommunities[\s\S]*?\n\}/.exec(seedSrc);
    const body = fn?.[0] ?? '';
    expect(body).toContain('where: { community_code: c.code }');
    expect(body).toContain('prisma.communities.upsert');
  });

  it('seedCommunity_code 上确有 @unique（upsert 键的前提）', () => {
    const block = /model communities \{([\s\S]*?)\n\}/.exec(schemaSrc);
    const body = block?.[1] ?? '';
    expect(body).toMatch(/community_code\s+String\s+@unique/);
    expect(body).toMatch(/community_name\s+String\s+@unique/);
  });

  it('update 只覆盖名称，不覆盖 city（运营可能在后台改过城市）', () => {
    const fn = /async function seedCommunities[\s\S]*?\n\}/.exec(seedSrc);
    const body = fn?.[0] ?? '';
    const updateLine = /update:\s*\{([^}]*)\}/.exec(body);
    expect(updateLine?.[1]).toBeDefined();
    // 不该在 update 里改 city / 坐标
    expect(updateLine?.[1]).not.toMatch(/city/);
    expect(updateLine?.[1]).not.toMatch(/lng|lat/);
  });
});

describe('社区种子 · seed 已挂进main', () => {
  it('main() 调用了 seedCommunities（漏调则种子写了但没人执行）', () => {
    expect(seedSrc).toMatch(/const communityCount = await seedCommunities\(\)/);
    expect(seedSrc).toMatch(/communities:\s*communityCount/);
  });
});