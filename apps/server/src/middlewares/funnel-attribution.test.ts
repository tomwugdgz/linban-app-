// ============================================================================
// 漏斗归因口径测试（2026-10，主理人裁定）
// ----------------------------------------------------------------------------
// 这组测试守的是「运营投放归因」的正确性。两个失败模式都是静默的：
//
//  1. **channelKey 用自增 id 或数组下标**
//     · 用 id：换库/重建数据 id 就变 → 运营的投放归因与去重口径断裂
//     · 用下标：SQL 无 ORDER BY 时 MySQL 不保证顺序 → 同一份代码在不同环境
//       产出不同归因结果，**且这种不一致任何测试都发现不了，因为每个环境
//       里它都是自洽的**
//
//  2. **触点值平行造了一套**
//     前端 mock 曾平行造 `GATE_BANNER / UNIT_DOOR / GROUP_BUY / OPEN_DOOR_APP`
//     四个值，与 schema 的七值枚举不一致。`enum-mirror` CI 门禁管得到
//     schema ↔ shared 镜像，**管不到 mock 里的平行码表** —— 所以必须自己核。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { activity_touch_channel, activity_touch_channel_values } from '@linban/shared';

const SVC_PATH = fileURLToPath(new URL('../modules/activity/admin.service.ts', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
const WEB_MOCK_PATH = fileURLToPath(
  new URL('../../../admin-web/src/api/mock/db-activity.ts', import.meta.url),
);

const svcSrc = readFileSync(SVC_PATH, 'utf8');
const schemaSrc = readFileSync(SCHEMA_PATH, 'utf8');
const webSrc = readFileSync(WEB_MOCK_PATH, 'utf8');

/**
 * 抽取 getFunnel 的**函数体**（从 `days: number` 参数之后开始）。
 *
 * 【这行注释是踩了三次坑之后写的，记录下来免得重犯】
 *  · v1 `/\n\}/` 截断 —— 函数体内有 return {...}，在 return 的 `}` 处切断，
 *    后续断言全落空而测试仍绿。
 *  · v2 「下一个 `/**`」当边界 —— 函数体内部也有 JSDoc（我自己在
 *    byCommunity 上方写了块注释），边界提前。
 *  · v3 括号深度扫描 —— **错在从函数名 `getFunnel(` 开始扫**，而返回类型
 *    `Promise<{ ... }>` 里的 `{` 提前配平，函数体被截在参数表处。
 *
 * 正确做法：函数体起点 = 返回类型闭合 `}> {` 里的那个 `{`
 * （签名是 `Promise<{...}> {`），从它之后开始算深度。
 */
function getFunnelBody(): string {
  const fnStart = svcSrc.indexOf('export async function getFunnel');
  expect(fnStart, '未找到 getFunnel').toBeGreaterThanOrEqual(0);
  // 返回类型闭合 + 函数体开括号：形如 `}> {`
  const anchor = svcSrc.indexOf('}> {', fnStart);
  expect(anchor, '未找到 getFunnel 返回类型闭合处').toBeGreaterThanOrEqual(0);
  const open = anchor + 3; // 指向 '{'

  let depth = 0;
  for (let i = open; i < svcSrc.length; i += 1) {
    const ch = svcSrc[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return svcSrc.slice(open, i + 1);
    }
  }
  throw new Error('getFunnel 函数体括号未闭合');
}

/**
 * 解析 schema 的enum 取值。
 *
 * 两个坑（都踩过）：
 *  1. schema.prisma 是 **CRLF** 且枚举值**行尾带注释**，`^\\s*([A-Z_]+)\\s*$` 会双重失配 → 解出 0 个且"看起来跑通了"。
 *  2. 非贪婪 `\\n\\}` 会把**末个枚举值**吃掉（末行后直接跟 `}`），7 个只解出 6 个。故闭合用 `\\s*\\}`。
 * 原坑：schema.prisma 里枚举值**行尾带注释**且**文件是 CRLF**，
 * `^\s*([A-Z_]+)\s*$` 会因行尾 `//注释` 与 `\r` 双重失配。
 * 所以按行解析、先剥注释、再 trim。
 */
function parseSchemaEnum(name: string): string[] {
  const block = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\s*\\}`).exec(schemaSrc);
  if (!block?.[1]) throw new Error(`未找到 schema 的 enum ${name}`);
  return block[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => /^[A-Z_][A-Z_0-9]*$/.test(l));
}

describe('漏斗 byCommunity · channelKey 口径', () => {
  it('显式 JOIN communities 取 community_code（不从别处拼）', () => {
    const body = getFunnelBody();
    // 必须出现 community_code / community_name 的 select
    expect(body).toContain('community_code: true');
    expect(body).toContain('community_name: true');
  });

  it('绝不按 community_id（自增 id）聚合（换库即断）', () => {
    const body = getFunnelBody();
    // 可以 select 到 community 对象，但不能把 id 当 channelKey 用
    expect(body).not.toMatch(/channelKey:\s*r\.community\.id/);
    expect(body).not.toMatch(/by:\s*\['community_id'\]/);
    // channelKey 必须来自 community_code
    expect(body).toMatch(/r\.community\?\.community_code/);
  });

  it('绝不按数组下标聚合（下标在真接后端后不稳定）', () => {
    const body = getFunnelBody();
    expect(body).not.toMatch(/channelKey:\s*(String\()?index/);
    expect(body).not.toMatch(/channelKey:\s*\w+\[\d+\]/);
  });

  it('有稳定 ORDER BY（出参顺序是口径的一部分，不是性能优化）', () => {
    const body = getFunnelBody();
    // SQL 层排序
    expect(body).toContain("orderBy: { community: { community_code: 'asc' } }");
    // 应用层聚合后再排一次（groupBy 聚合后顺序不保证）
    expect(body).toContain('.sort((a, b)');
  });

  it('排序键是 community_code 而非 count（count 随数据量变，会让渠道互换位置）', () => {
    const body = getFunnelBody();
    const sortLine = /\.sort\(\(a, b\) =>[^\n]*/.exec(body);
    expect(sortLine?.[0]).toBeDefined();
    expect(sortLine?.[0]).not.toMatch(/\.count/);
    expect(sortLine?.[0]).toMatch(/channelKey/);
  });

  it('社区维度不复用 source_channel（那是采集通道，语义不同）', () => {
    const body = getFunnelBody();
    expect(body).not.toMatch(/by:\s*\['source_channel'\]/);
    expect(body).not.toContain('sourceChannel');
  });

  it('未关联社区归入 UNASSIGNED 桶而非丢弃（丢弃会让"未关联"看起来像"没投放"）', () => {
    const body = getFunnelBody();
    expect(body).toContain("'UNASSIGNED'");
    expect(body).toContain('未关联社区');
  });

  it('出参字段名是 channelKey / channelLabel / count（契约口径）', () => {
    // 出参类型注解在**函数体之外**（签名 `Promise<{...}>` 里），
    // 故这段查签名段而非函数体 —— 两者都是契约的一部分，分开断言更清晰。
    const fnStart = svcSrc.indexOf('export async function getFunnel');
    const sig = svcSrc.slice(fnStart, svcSrc.indexOf('}> {', fnStart) + 3);
    expect(sig).toContain(
      'byCommunity: Array<{ channelKey: string; channelLabel: string; count: number }>',
    );
    // 函数体内也必须真的构造这三个字段（签名与实现不得脱节）
    const body = getFunnelBody();
    expect(body).toMatch(/channelKey,\s*channelLabel:\s*v\.label/);
  });
});

describe('触点渠道七值（enum-mirror 管不到 mock 平行码表）', () => {
  it('shared 七值与主理人裁定完全一致', () => {
    expect([...activity_touch_channel_values].sort()).toEqual([
      'DISTRIBUTOR',
      'IM',
      'MEDIA_SCREEN',
      'MEDIA_STICKER',
      'OPENING_APP',
      'PUSH',
      'SMS',
    ]);
  });

  it('四个线下触点值逐个核对（前端曾平行造了 GATE_BANNER 等四个值）', () => {
    expect(activity_touch_channel.MEDIA_SCREEN).toBe('MEDIA_SCREEN');   // 门禁广告屏
    expect(activity_touch_channel.MEDIA_STICKER).toBe('MEDIA_STICKER'); // 单元门贴纸
    expect(activity_touch_channel.DISTRIBUTOR).toBe('DISTRIBUTOR');    // 社区团长地推
    expect(activity_touch_channel.OPENING_APP).toBe('OPENING_APP');    // 亲邻开门App 跳转
  });

  it('前端 mock 里不再有平行造的四个值（enum-mirror 覆盖不到 mock）', () => {
    // 注意：mock 里有**注释**提到这四个历史值（说明改回的原因），
    // 所以不能简单 grep not.toContain —— 要剥掉注释行后再查代码部分。
    // 顺序要紧：先整块剥 /* */（含行内 * 前缀），再剥行注释 //，
    // 否则 /* 之后到 */ 之间的行会漏掉（行首是 '* ' 而非 '*/'）
    const codeOnly = webSrc
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    for (const bogus of ['GATE_BANNER', 'UNIT_DOOR', 'GROUP_BUY', 'OPEN_DOOR_APP']) {
      expect(codeOnly, `前端 mock 代码里仍有平行值 ${bogus}`).not.toContain(bogus);
    }
    // 反向：代码里真的在用七值（证明不是"删掉了事"）
    expect(codeOnly).toContain('MEDIA_SCREEN');
    expect(codeOnly).toContain('OPENING_APP');
  });

  it('schema 的 activity_touch_channel 枚举与 shared 逐值一致', () => {
    const schemaVals = parseSchemaEnum('activity_touch_channel');
    expect(schemaVals.length).toBeGreaterThanOrEqual(7);
    expect(schemaVals.sort()).toEqual([...activity_touch_channel_values].sort());
  });

  it('七个枚举值长度都不超过 32（防 VarChar 截断）', () => {
    expect(schemaSrc).toMatch(/touch_channel\s+activity_touch_channel\?/);
    for (const v of activity_touch_channel_values) {
      expect(v.length).toBeLessThanOrEqual(32);
    }
  });
});

describe('触点与采集通道语义分离', () => {
  it('schema 里 source_channel 与 touch_channel 是两列（不可复用同一列）', () => {
    expect(schemaSrc).toMatch(/source_channel\s+activity_channel\?/);
    expect(schemaSrc).toMatch(/touch_channel\s+activity_touch_channel\?/);
  });
});