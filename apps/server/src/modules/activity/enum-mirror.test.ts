// ============================================================================
// 枚举镜像守卫：schema.prisma ↔ packages/shared/src/enums.ts 逐字一致
// ----------------------------------------------------------------------------
// 为什么要有这个测试：shared 是「无 Prisma 依赖端」（两个 Taro 小程序 / admin-web）
// 唯一可引用的枚举来源，但它与 schema 是**手工双写**的。schema 加了枚举而 shared
// 忘了补，端上就会出现「值拼错但两边都编译通过」的静默BUG——落库时 Prisma 直接
// 抛枚举错误，或者更糟：写入成功但前端判不出来。
//
// 本测试把这份同步从「纪律」变成「CI 门禁」：
//   1. schema 每个enum 都必须在 shared 有同名 const，且取值集合逐字一致；
//   2. 顺序也须一致（schema 是可执行单一事实源，顺序影响遍历展示）；
//   3. shared 侧多出来的必须是**显式白名单**里的纯 TS 常量（无 Prisma 对应），
//      否则说明shared 写错了名字。
//
// 例外白名单：activity_bonus_reason——它落 orders.dispatch_reason_code
// （VarChar(32) 字符串列，非 Prisma enum），故不在 schema 的 enum 列表内。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sharedEnums from '@linban/shared';

const SCHEMA_PATH = fileURLToPath(
  new URL('../../../prisma/schema.prisma', import.meta.url),
);

/** shared 有、schema 无 Prisma enum 对应的合法项（纯 TS 枚举，逐项说明理由） */
const TS_ONLY_ALLOWLIST: Record<string, string> = {
  activity_bonus_reason:
    '落 orders.dispatch_reason_code（VarChar(32) 字符串列），schema 侧刻意不用 enum，避免 ALTER TYPE 锁表',
  COUPON_STATUS:
    'coupons.status 为 String 列（避免 ALTER 锁表），常量即其唯一口径来源',
  QUEUE_NAMES: 'BullMQ 队列名常量（Redis 侧约定，非落库枚举）',
  BIZ_NO_PREFIX: '业务单号前缀（genBizNo 用，落orders.biz_no 等字符串列）',
  SPLIT_MODE: '分账模式标识（落 profit_sharing_records.split_mode 字符串列）',
  ACTIVITY_COPY_SCENE: '推荐话术场景码（A6 话术库选句键，落activity_touchpoints 之外的内存映射）',
  CONFIG_LABELS:
    '配置项中文名表（纯展示用 Record<string,string>）。system_configs.key 是 VarChar 字符串列，'
    + '不是落库枚举；本表的值域由 SYSTEM_CONFIG_DEFAULTS 的键集合约束，'
    + '而非由 schema enum 约束（键集合一致性另有 config-changelog-group.test.ts 守）。',
};

/** 解析 schema 里的enum 名 → 取值数组 */
function parseSchemaEnums(): Map<string, string[]> {
  // schema 是 CRLF；先归一化，否则行尾 \r 会让「整行只有标识符」的判断失效
  const text = readFileSync(SCHEMA_PATH, 'utf8').replace(/\r\n/g, '\n');
  const result = new Map<string, string[]>();
  const re = /^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    // noUncheckedIndexedAccess：正则捕获组在类型上可能是 undefined
    if (name === undefined || body === undefined) continue;
    const values: string[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      // schema 枚举值是裸标识符（可能带 /// 文档注释，已被上面剥掉）
      const vm = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
      if (vm?.[1] !== undefined) values.push(vm[1]);
    }
    result.set(name, values);
  }
  return result;
}

/** 从 shared 侧取出所有「枚举形状」的导出（xxx / xxx_values 成对） */
function collectSharedEnums(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [key, value] of Object.entries(sharedEnums)) {
    if (key.endsWith('_values')) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const vals = Object.values(value as Record<string, unknown>);
    // 枚举 const 的值全是 string；非枚举（如常量对象）会被这里过滤掉一部分，
    // 剩下的若含非string 则跳过
    if (vals.length === 0 || !vals.every((v) => typeof v === 'string')) continue;
    result.set(key, vals as string[]);
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// ⚠️ 本判定的「安全边界」—— 改这段代码前必读（霍承钧 2026-10 提出，宋砚秋落笔）
// ───────────────────────────────────────────────────────────────────────────
//
// 【为什么这条注释在「工具侧」而不是只在「对象侧」】
//   约束的真正主人是 `CONFIG_DOMAIN_GROUPS`（shared 侧的定义处），
//   但**执行检查的是这个函数** —— 两处都写才防得住单向漂移：
//   若只在对象侧写，将来有人为了「支持更多常量形态」把第 78 行的判定放宽
//   （如改成「任意对象都收」），对象侧的注释会提醒他回来登记；
//   若只在这里写，将来有人新增一个「对象套数组」的常量，对象侧没有任何提示。
//   霍承钧的判断我采纳：**约束应该写在被约束的对象旁边**（他的原话），
//   所以 `constants.ts` 的 `CONFIG_DOMAIN_GROUPS` 定义上方也有一份对应说明 ——
//   **两边都要有，缺一边就是单向漂移。**
//
// 【当前哪些 shared 导出依赖第 78 行这个判定才「不被误收集」】
//   `CONFIG_DOMAIN_GROUPS`：形态是「对象套 string[]」
//     → `Object.values()` 得到的是**数组**，数组的 `typeof` 是 `'object'` 而非 `'string'`
//     → 第 78 行的 `!vals.every(v => typeof v === 'string')` 成立 → 被 `continue` 跳过
//     → **不会**被误登记为 schema 枚举，故**无需**进 TS_ONLY_ALLOWLIST
//   实测结论见 `scripts/probes/probe-enum-collect.ts`（一次性诊断探针，非门禁）。
//
// 【⚠️ 若将来放宽本判定（例如改成「任意对象都收」）】
//   上面那些常量会**立刻**被误收集 → enum-mirror 会报
//   「shared 有但 schema 无，且未登记到 TS_ONLY_ALLOWLIST」。
//   **正确处置是登记进 TS_ONLY_ALLOWLIST 并写明理由**（不是回退本判定 ——
//   本判定放宽本身可能是为了支持别的合法形态）。
//   受影响的清单（本判定放宽时需逐个复核登记）：
//     CONFIG_DOMAIN_GROUPS / CONFIG_GROUP_KEYS(数组，本就非对象) /
//     FEN_CONFIGS / BP_CONFIGS(Set，本就非对象) /
//     SYSTEM_CONFIG_DEFAULTS（对象套对象，值非 string，同样靠本判定跳过）
//
// 【为什么用探针实测而不是读代码推断】
//   「对象套数组」的 `typeof` 判定很容易读错（数组 typeof 是 'object' 不是 'array'），
//   靠推断容易得出相反结论。实测五种形态（对象套 string / 对象套 string[] /
//   纯数组 / Set / 对象套对象）逐个跑，比推断可靠。
//

const schemaEnums = parseSchemaEnums();
const sharedMap = collectSharedEnums();

describe('schema ↔ shared 枚举镜像守卫', () => {
  it('schema 枚举数量应与已知基线一致（防解析器失效而非真实变更）', () => {
    // 解析器一旦静默失效，下面所有断言都会假通过，所以先给个数设底线
    expect(schemaEnums.size).toBeGreaterThanOrEqual(65);
  });

  it('schema 的每个枚举在 shared 都有同名同值的镜像', () => {
    const problems: string[] = [];
    for (const [name, values] of schemaEnums) {
      const sharedVals = sharedMap.get(name);
      if (!sharedVals) {
        problems.push(`${name}: shared 缺失（schema 值 [${values.join(', ')}]）`);
        continue;
      }
      if (sharedVals.join(',') !== values.join(',')) {
        const s = new Set(values);
        const t = new Set(sharedVals);
        const onlySchema = values.filter((v) => !t.has(v));
        const onlyShared = sharedVals.filter((v) => !s.has(v));
        problems.push(
          `${name}: 取值不一致`
          + `｜schema 独有 [${onlySchema.join(', ')}]`
          + `｜shared 独有 [${onlyShared.join(', ')}]`
          + `｜顺序${sharedVals.join(',') === values.join(',') ? '一致' : '不一致'}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('shared 的枚举要么有 schema 对应，要么在 TS_ONLY_ALLOWLIST 里显式登记', () => {
    const problems: string[] = [];
    for (const name of sharedMap.keys()) {
      if (schemaEnums.has(name)) continue;
      if (!(name in TS_ONLY_ALLOWLIST)) {
        problems.push(
          `${name}: shared 有但 schema 无，且未登记到 TS_ONLY_ALLOWLIST`
          + '（若确为纯 TS 常量，请补登记并写明理由）',
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('白名单里的每一项都真的存在于 shared（防止白名单条目被删后静默通过）', () => {
    for (const name of Object.keys(TS_ONLY_ALLOWLIST)) {
      expect(sharedMap.has(name), `${name} 应存在于 shared`).toBe(true);
      expect(schemaEnums.has(name), `${name} 不应同时存在于 schema（白名单语义冲突）`).toBe(false);
    }
  });

  it('每个 schema 镜像枚举都同时导出 _values 数组（供 zod / 单测遍历）', () => {
    const missing: string[] = [];
    for (const name of schemaEnums.keys()) {
      const vals = (sharedEnums as Record<string, unknown>)[`${name}_values`];
      if (!Array.isArray(vals)) {
        missing.push(`${name}_values`);
        continue;
      }
      const expected = schemaEnums.get(name) ?? [];
      if ((vals as string[]).join(',') !== expected.join(',')) {
        missing.push(`${name}_values 取值与 const 不一致`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('health_alert_status 六态齐全（契约 §13.5 与 schema 逐字一致）', () => {
    expect(sharedEnums.health_alert_status_values).toEqual([
      'OPEN', 'ACKNOWLEDGED', 'PROCESSING', 'RESOLVED', 'DISMISSED', 'ESCALATED',
    ]);
  });

  it('activity_purge_status 四态齐全且 CONFIRMED 可被service 层引用', () => {
    expect(sharedEnums.activity_purge_status_values).toEqual([
      'NOT_STARTED', 'RUNNING', 'CONFIRMED', 'FAILED',
    ]);
  });

  it('user_role 含 SYSTEM（主理人裁定 A2：系统服务账号）', () => {
    expect(sharedEnums.user_role_values).toContain('SYSTEM');
  });

  it('activity_bonus_reason 三值（orders.dispatch_reason_code 口径）', () => {
    expect(sharedEnums.activity_bonus_reason_values).toEqual([
      'NONE', 'ACTIVITY_LOW', 'ACTIVITY_STILL',
    ]);
  });
});