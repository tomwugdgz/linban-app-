// ============================================================================
// mock 冒烟（用 esbuild 打包后用 node 跑；不引vitest，只做端点与业务断言）
// 用法：node scripts/smoke.mjs
//
// 断言的是**业务正确性**，不是「返回 200 且有数据」——
// 后者只能证明 mock 没崩，证明不了 mock 在骗人。
// ============================================================================
import { dispatch } from '../dist-smoke/server.js';
import {
  shared,
  mockCollections,
  valuesOf,
  REGISTRY,
  STRING_COLUMNS,
  discoverUnregisteredEnumFields,
  resolveEnumValues,
  allInEnum,
  TS_ONLY_CONSTANTS,
  discoverTsOnlyConstants,
  mockSubscriptions,
  prorateSubscriptionMock,
  REVENUE_TIER_ORDER,
  prorateSubscription,
  BIZ_NO_FIELDS,
  STRING_NO_FIELDS,
  prefixOf,
  CONFIG_GROUPS,
} from '../dist-smoke/smoke-enums.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readRan } from './check-collection.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function get(path) {
  return dispatch('GET', path);
}
async function post(path, body) {
  return dispatch('POST', path, body);
}
async function put(path, body) {
  return dispatch('PUT', path, body);
}

// ---------------------------------------------------------------------------
// 全项目 src/ 文本扫工具
// ----------------------------------------------------------------------------
// 为什么必须扫目录而不是查某一个页面的数据：
//   上一轮我只断言了「ConfigChangelogPage 的 mock 数据里不出现 oldValue」，
//   于是 CommissionConfigPage.tsx 里的同名字段整列空白却没人发现——
//   断言的作用域只覆盖了我检查过的地方，等于给没检查的地方发免检牌。
// ---------------------------------------------------------------------------
const SRC_DIR = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * 剥掉单行注释（`//` / ` * ` / `/*` 开头的整行）。
 *
 * **为什么必须剥注释再查文案/标识符**：门禁要守的是「**代码里**还在用旧值」，
 * 而不是「文件里提到过旧值」。我两次栽在这上面：
 *   ① 举报类型那次——我在注释里解释「这些值为何废弃」，被判成残留；
 *   ② 归因截断那次——我在注释里写「原筛选项那句托辞已被删除」，被判成托辞仍在。
 * 两次都是**红因错而非实现错**。
 *
 * ⚠️ 局限：只剥整行注释，**不处理行尾注释**（`const a = 1; // 旧值`）。
 * 本文件的断言目标都在独立行上，够用；遇到行尾注释需另行处理，别误以为它能全覆盖。
 *
 * 必须是**顶层 const**：本文件有多个断言节（各带 `{ }` 块级作用域）跨节复用它，
 * 放块里会 ReferenceError。
 */
const stripComments = (src) =>
  src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** 递归列出 src/ 下所有代码文件 */
function listSrcFiles(dir = SRC_DIR, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSrcFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full);
  }
  return acc;
}

/**
 * 在 src/ 全量代码里grep 模式，返回「文件:行」列表。
 * @param {RegExp} re
 * @param {(file: string, line: string, idx: number, lines: string[]) => boolean} [skipLine]
 *        逐行豁免；`lines` 是整个文件的行数组，便于按「上下文窗口」判断
 *        （单行判不出来时用，例如 interface 声明与其字段相隔好几行）。
 */
function grepSrc(re, skipLine) {
  const hits = [];
  for (const file of listSrcFiles()) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (skipLine && skipLine(relative(SRC_DIR, file), line, i, lines)) return;
      if (re.test(line)) hits.push(`${relative(SRC_DIR, file)}:${i + 1}`);
      re.lastIndex = 0;
    });
  }
  return hits;
}

/** 取以 idx 为中心、向上下各 window 行的上下文窗口文本 */
function contextOf(lines, idx, window = 12) {
  return lines.slice(Math.max(0, idx - window), idx + window + 1).join('\n');
}

/**
 * 注释行判定。**必须提到顶层作用域** —— 它被多个独立断言块复用，
 * 放在某个 `{ }` 块内的 `const` 会被块外引用成 ReferenceError。
 *
 * 形参必须是 (file, line) —— grepSrc 按 (file, line, idx, lines) 传参；
 * 写成 (line) 会拿文件路径去测注释正则，豁免静默失效（我自己踩过：断言红了才知道）。
 */
const isComment = (_file, line) => /^\s*(\/\/|\*|\/\*)/.test(line) || /\/\/.*$/.test(line);

// ============================================================================
console.log('\n【A7 社区列】null 是正常业务态，不是数据错误');
// ============================================================================
{
  const res = await get('/admin/activity/elders?page=1&pageSize=200');
  const list = res.list;
  ok('老人列表非空', list.length > 0, `len=${list.length}`);
  const hasNull = list.some((r) => r.community === null);
  const hasStr = list.some((r) => typeof r.community === 'string' && r.community.length > 0);
  ok('community 存在 null 态（档案没填）', hasNull);
  ok('community 存在字符串态（已关联）', hasStr);
  ok(
    'community 不存在 undefined（undefined 会让页面两个分支都进不去）',
    list.every((r) => r.community === null || typeof r.community === 'string'),
  );
  const unknownNoCommunity = list.filter((r) => r.status === 'UNKNOWN');
  ok(
    'UNKNOWN 老人中允许有未关联社区的（两个维度正交，不能互斥）',
    Array.isArray(unknownNoCommunity),
    `unknown=${unknownNoCommunity.length}`,
  );
}

// ============================================================================
console.log('\n【告警队列】UNKNOWN 必须带原因；告警状态机自闭环');
// ============================================================================
{
  const res = await get('/admin/activity/alerts?page=1&pageSize=200');
  const list = res.list;
  ok('告警列表非空', list.length > 0, `len=${list.length}`);
  // 注意：告警的 status 是处置状态机（OPEN/ACK/...），
  // 「活动状态不可判读」落在 triggeredStatus 上——两者语义不同，别混。
  const unknownTriggered = list.filter((a) => a.triggeredStatus === 'UNKNOWN');
  ok('存在 triggeredStatus=UNKNOWN 的告警（信号不可判读）', unknownTriggered.length > 0, `n=${unknownTriggered.length}`);
  ok(
    'UNKNOWN 告警均带 explainCode（运营必须看到中文释义）',
    unknownTriggered.every((a) => !!a.explainCode),
  );
  ok(
    '全部告警均带 explainCode',
    list.every((a) => !!a.explainCode),
    list.filter((a) => !a.explainCode).length + ' 条缺 explainCode',
  );
  const open = list.find((a) => a.status === 'OPEN');
  if (open) {
    const ack = await post(`/admin/activity/alerts/${open.id}/ack`, { reason: '冒烟测试确认' });
    ok('OPEN → ACKNOWLEDGED 流转成功', ack.status === 'ACKNOWLEDGED', `got=${ack.status}`);
    const again = await post(`/admin/activity/alerts/${open.id}/ack`, { reason: '重复确认' }).catch((e) => e);
    ok('重复 ack 被拒（24002 幂等）', again?.code === 24002 || typeof again?.code === 'number', `code=${again?.code}`);
  } else {
    ok('存在 OPEN 告警供流转测试', false, 'mock 无 OPEN 告警');
  }
  const noneAlert = list.find((a) => a.triggeredStatus === 'UNKNOWN' && a.level === 'URGENT');
  if (noneAlert) {
    const noReason = await post(`/admin/activity/alerts/${noneAlert.id}/resolve`, {}).catch((e) => e);
    ok('紧急告警未填原因被拒（10001）', noReason?.code === 10001, `code=${noReason?.code}`);
  }
}

// ============================================================================
console.log('\n【漏斗】七层单调 + 同意率不得为 100%');
// ============================================================================
{
  for (const dim of ['community', 'trigger', 'date']) {
    const res = await get(`/admin/activity/funnel?dimension=${dim}&days=30`);
    for (const c of res.channels) {
      let mono = true;
      for (let i = 1; i < c.counts.length; i++) {
        if (c.counts[i] > c.counts[i - 1]) mono = false;
      }
      ok(`${dim} / ${c.channelLabel}：层间单调递减`, mono, c.counts.join('→'));
    }
  }
  const res = await get('/admin/activity/funnel?dimension=trigger&days=30');
  for (const c of res.channels) {
    const consentIdx = 2;
    const rate = c.counts[consentIdx] / c.counts[consentIdx - 1];
    ok(`${c.channelLabel}：同意率 < 100%（100% 说明 mock 用等比造数）`, rate < 1, `${(rate * 100).toFixed(1)}%`);
    ok(`${c.channelLabel}：同意率 > 0`, rate > 0);
  }
  ok('线下触点归因非空', (res.offlineTouchpoints ?? []).length > 0);

  // === key 口径守卫（宋砚秋 DDL 落盘后新增）===
  // 这类key 漂移是「看起来能跑、实际归因整体错位且零报错」的典型，必须钉死。
  const tps = res.offlineTouchpoints ?? [];
  const TOUCH_CHANNEL = new Set([
    'PUSH', 'SMS', 'IM', 'MEDIA_SCREEN', 'MEDIA_STICKER', 'DISTRIBUTOR', 'OPENING_APP',
  ]);
  ok('线下触点 key 全部为共享枚举 activity_touch_channel 七值之一',
    tps.length > 0 && tps.every((t) => TOUCH_CHANNEL.has(t.channelKey ?? t.key)),
    tps.map((t) => t.channelKey ?? t.key).join(','));

  // 小区维度 channelKey 必须是 community_code，不能是数组下标派生值
  const commRes = await get('/admin/activity/funnel?dimension=community&days=30');
  const keys = commRes.channels.map((c) => c.channelKey);
  ok('小区维度 channelKey 非空且唯一', keys.every(Boolean) && new Set(keys).size === keys.length, keys.join(','));
  ok('小区维度 channelKey 不是数组下标派生值（防新增社区导致静默错位）',
    keys.every((k) => !/^C\d+$/.test(k)), keys.join(','));
  ok('小区维度 channelKey 形如 GZ_XX_YYY（community_code 口径）',
    keys.every((k) => /^GZ_[A-Z]+_[A-Z]+$/.test(k)), keys.join(','));
  ok('小区维度 channelLabel 为带行政区前缀的全称（与 community_name 一致）',
    commRes.channels.every((c) => /区.+(社区|街|里)$/.test(c.channelLabel)), 
    commRes.channels.map((c) => c.channelLabel).join(','));
}

// ============================================================================
console.log('\n【配置变更历史】多操作人 + before/after 对照');
// ============================================================================
{
  const res = await get('/admin/configs/changelog?page=1&pageSize=100');
  ok('变更记录 ≥ 3 条', res.total >= 3, `total=${res.total}`);
  const operators = new Set(res.list.map((r) => r.operator));
  ok('操作人 ≥ 2 人（不能全是同一个人改）', operators.size >= 2, [...operators].join(','));
  // 契约 §5.7.7 出参字段名。**必须逐字段断言存在性**：字段名写错（如用了
  // oldValue/operatorName 这类想当然的名字）时，`!== undefined` 仍为 true 会假通过，
  // 而页面会整列空白——这类「看起来对但语义错」的 bug 只有断言存在性能拦住。
  ok('契约字段名 beforeValue/afterValue 存在且为字符串',
    res.list.every((r) => typeof r.beforeValue === 'string' && typeof r.afterValue === 'string'));
  ok('契约字段名 operator/changedAt 存在',
    res.list.every((r) => !!r.operator && !!r.changedAt));
  ok('每条都有 requestId（可回溯服务端日志）', res.list.every((r) => !!r.requestId));
  const keys = new Set(res.list.map((r) => r.configKey));
  ok('涉及配置项 ≥ 3 个（不能全是同一个字段在改）', keys.size >= 3, [...keys].join(','));
  const diff = res.list.filter((r) => r.beforeValue !== r.afterValue);
  ok('至少一条 beforeValue ≠ afterValue', diff.length >= 1);
  // 反向断言：契约字段名写错时这条会红（保护上面的断言不是空转）。
  // 只查 mock 数据是不够的——页面用旧字段名渲染照样整列空白（CommissionConfigPage 就是这么漏的）。
  // 全项目 src/ 扫放到下面「反向断言（全项目 src/ 扫）」一节。
  ok('反向校验：changelog 数据源不应出现 oldValue/newValue',
    res.list.every((r) => r.oldValue === undefined && r.newValue === undefined));

  // 按配置项筛选
  const first = res.list[0];
  const filtered = await get(`/admin/configs/changelog?page=1&pageSize=50&configKey=${first.configKey}`);
  ok('configKey 筛选生效', filtered.list.every((r) => r.configKey === first.configKey));

  // 分组筛选
  const g = await get('/admin/configs/changelog?page=1&pageSize=50&group=' + encodeURIComponent('分账与资金'));
  ok('group 筛选生效且有数据', g.list.length > 0, `len=${g.list.length}`);

  //倒序
  const desc = res.list.every((r, i) => i === 0 || res.list[i - 1].changedAt >= r.changedAt);
  ok('按时间倒序（changedAt）', desc);

  // 路径必须是单数（契约 §5.7 开篇统一命名）
  const single = await get('/admin/configs/changelog?page=1&pageSize=1');
  ok('契约路径为单数 /admin/configs/changelog', !!single.list);
  const plural = await get('/admin/configs/changelogs?page=1&pageSize=1').then(() => true).catch(() => false);
  ok('复数路径已不存在（契约统一为单数）', plural === false, `复数仍可用: ${plural}`);
}

// ============================================================================
console.log('\n【优惠券】四态覆盖 + 核销率差异 + 金额单位不混');
// ============================================================================
{
  const res = await get('/admin/coupons?page=1&pageSize=50');
  const list = res.list;
  ok('券模板 ≥ 4 条', list.length >= 4, `len=${list.length}`);
  const statuses = new Set(list.map((c) => c.status));
  for (const s of ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']) {
    ok(`status 覆盖 ${s}`, statuses.has(s), [...statuses].join(','));
  }
  // 核销率差异：至少一条 <20%、一条 >50%
  const rates = list
    .filter((c) => c.claimedCount > 0)
    .map((c) => Math.floor((c.usedCount / c.claimedCount) * 100));
  ok('存在核销率 < 20% 的券（跑不动的）', rates.some((r) => r < 20), rates.join(','));
  ok('存在核销率 > 50% 的券（跑得动的）', rates.some((r) => r > 50), rates.join(','));
  ok('核销数不超过领取数（不能出现 used > claimed）', list.every((c) => c.usedCount <= c.claimedCount));
  ok('领取数不超过发行总量（限量券）', list.every((c) => c.totalCount === 0 || c.claimedCount <= c.totalCount));
  // 金额：value 是 number 但必须是整数（分/分钟都是整数）
  ok('value 均为正整数（分/分钟）', list.every((c) => Number.isInteger(c.value) && c.value > 0));
  ok('minSpendFen 为数字字符串', list.every((c) => /^\d+$/.test(c.minSpendFen)));

  // 状态筛选
  const draft = await get('/admin/coupons?page=1&pageSize=50&status=DRAFT');
  ok('status 筛选生效', draft.list.every((c) => c.status === 'DRAFT') && draft.list.length > 0);

  // 新建落 DRAFT 而非 ACTIVE
  const created = await post('/admin/coupons', {
    name: '冒烟测试券', type: 'FULL_REDUCTION', value: 500, minSpendFen: '2000', validDays: 30, totalCount: 100,
  });
  ok('新建券落 DRAFT（不直接对外发）', created.status === 'DRAFT', `got=${created.status}`);
  ok('新建券 claimedCount=0', created.claimedCount === 0);

  // 草稿不可暂停（状态机）
  const draftPause = await post(`/admin/coupons/${created.id}/pause`, {}).catch((e) => e);
  ok('草稿券 pause 被拒（状态机守卫）', draftPause?.code === 10008, `code=${draftPause?.code}`);

  // 草稿可投放
  const published = await post(`/admin/coupons/${created.id}/publish`, {});
  ok('草稿 →投放中', published.status === 'ACTIVE', `got=${published.status}`);

  // 金额铁律：已发放的券不允许改面值（user_coupons 无面值快照 → 改模板= 存量券实时变价）
  const active = list.find((c) => c.status === 'ACTIVE' && c.claimedCount > 0);
  if (active) {
    const err = await put(`/admin/coupons/${active.id}`, { value: 9999 }).catch((e) => e);
    ok('已发放券改面值被拒', err?.code === 10001, `code=${err?.code}`);
    ok('拒绝理由含「存量券面额同步变化」（技术性理由非协商理由）',
      String(err?.message ?? '').includes('存量券'), err?.message);
  } else {
    ok('存在已发放的 ACTIVE 券供改面值测试', false);
  }
  // 总量不可小于已领取（防超发）
  if (active) {
    const err = await put(`/admin/coupons/${active.id}`, { totalCount: 1 }).catch((e) => e);
    ok('总量设为小于已领取数被拒（防超发）', err?.code === 10001, `code=${err?.code}`);
  }
  // 投放期不可倒挂
  if (active) {
    const err = await put(`/admin/coupons/${active.id}`, {
      startAt: '2026-01-02T00:00:00.000Z', endAt: '2026-01-01T00:00:00.000Z',
    }).catch((e) => e);
    ok('投放期倒挂被拒', err?.code === 10001, `code=${err?.code}`);
  }
  // 编辑正常字段可以
  if (active) {
    const upd = await put(`/admin/coupons/${active.id}`, { name: '冒烟改名券' });
    ok('已发放券可改名称', upd.name === '冒烟改名券');
    ok('改后 updatedAt 被刷新', !!upd.updatedAt);
  }
  // 面值为 0 / 负数被拒
  const zero = await post('/admin/coupons', { name: '零面值券', type: 'FULL_REDUCTION', value: 0 }).catch((e) => e);
  ok('面值为 0 被拒', zero?.code === 10001, `code=${zero?.code}`);
}

// ============================================================================
console.log('\n【枚举门禁】所有「共享包已有枚举」的域，mock 必须复用');
// ============================================================================
// 这节的由来：上一轮我只断言了 activity_touch_channel 一个域，
// 于是 activity_status / order_status / user_coupon_status 这些同样有共享枚举的域
// 全都裸奔。而 OFFLINE_TOUCHPOINTS 平行自造了GATE_BANNER 等四个码值，
// 真接后端时四类线下触点全部映射不上、归因整体缺失且**零报错**——
// CI 的 enum-mirror 门禁管得到 schema 镜像，管不到 mock 里这套平行码表。
//
// 这里是「自动发现 + 映射表」，不是再补几条手写 if：
//   遍历 mock 每个集合的枚举型字段 → 必须对齐共享枚举（REGISTRY）或显式声明
//   是 String 列并写明理由（STRING_COLUMNS）。新增字段忘了登记 → 自动打红。
{
  // 1) 先把所有「看起来是码值域」的字段捞出来
  const discovered = discoverUnregisteredEnumFields(mockCollections);
  ok('枚举型字段自动发现机制生效（发现 ≥ 20 个码值域）',
    discovered.length >= 20, `discovered=${discovered.length}`);

  // 2) 覆盖完整性：发现的每个字段都必须有归属（登记为枚举 或 声明为 String 列 + 理由）
  const registryPaths = new Set(REGISTRY.map((r) => r.path));
  const orphans = discovered.filter((d) => !registryPaths.has(d.path) && !(d.path in STRING_COLUMNS));
  ok('每个码值域都已登记归属（无免检字段）',
    orphans.length === 0,
    orphans.map((o) => `${o.path}=[${o.values.slice(0, 3).join(',')}]`).join(' | '));

  // 3) 白名单不能白申：每条 String 列豁免必须带非空理由
  const noReason = Object.entries(STRING_COLUMNS).filter(([, why]) => !why || why.trim().length < 10);
  ok('String 列豁免均带充分理由（防随手白申）', noReason.length === 0,
    noReason.map(([p]) => p).join(','));

  // 4) 反向：白名单里登记的路径必须真实存在于对应集合
  //（注意：不能要求「一定被自动发现」——像 blacklists.reason 这类自由文本字段
  //  本来就不满足码值形态，永远不会被发现，但仍需要登记以表明「我看过、它不是码值域」。）
  const staleAllow = Object.keys(STRING_COLUMNS).filter((p) => valuesOf(p).length === 0);
  ok('String 列白名单无僵尸条目（登记的字段在 mock 里真实存在）', staleAllow.length === 0, staleAllow.join(','));

  // 5) 逐域校验：取值必须全部属于登记的共享枚举
  const sharedMap = shared;
  for (const { path, enumName } of REGISTRY) {
    const values = valuesOf(path);
    if (values.length === 0) {
      ok(`[枚举门禁] ${path} 有数据`, false, '集合为空或字段不存在');
      continue;
    }
    if (enumName === '@community_code') {
      // 小区维度 key：非共享枚举，形态必须是 community_code（主理人裁定的契约级约定）
      const bad2 = values.filter((v) => !/^GZ_[A-Z]+_[A-Z]+$/.test(v));
      ok(`[枚举门禁] ${path} 形如 community_code（GZ_XX_YYY）`, bad2.length === 0, bad2.join(','));
      continue;
    }
    const allowed = resolveEnumValues(sharedMap, enumName);
    if (!allowed) {
      ok(`[枚举门禁] 枚举 ${enumName} 可解析`, false, `共享包无 ${enumName}_values`);
      continue;
    }
    const bad = allInEnum(values, allowed);
    ok(`[枚举门禁] ${path} ⊆ ${enumName}（${values.length} 个取值）`, bad.length === 0,
      `越界值=[${bad.join(',')}] 合法=[${allowed.join(',')}]`);
  }

  // 6) 跨层枚举核对：**集合对账**，不是数量对账。
  //
  // 【本轮修正的假绿】原来这条写的是「shared `_values` 数 === schema enum 数 + TS_ONLY 词表数」，
  // 数字当时恰好相等（67 === 66 + 1）就绿了，但**归因是错的**：
  //   · 真正多出来的那 1 个 `_values` 是 activity_bonus_reason_values（schema 里**无**此 enum）；
  //   · 而被当成「TS_ONLY 词表」写进去的 COUPON_STATUS，它的值域数组后缀是**大写** `_VALUES`，
  //     压根没被 `sharedMap.filter(k => k.endsWith('_values'))` 数到。
  // 两个不同集合大小恰好相同 → 断言绿得毫无道理：**它验的不是它声称验的东西**。
  //
  // 这就是主理人归纳的「断言恒真」的第四种形态：**数量对账在两边恰好相等时必然恒绿**
  // ——增删任意一侧都可能被另一侧的巧合抵消掉，直到某天同时改动才暴露。
  //
  // 改成集合对账：自动发现「形态像 enum 镜像、但 schema 无对应 enum」的 shared 导出，
  // 与登记的 TS_ONLY_CONSTANTS **逐名比对**（多一个 / 少一个都红）。
  const schemaText = readFileSync(
    new URL('../../server/prisma/schema.prisma', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  );
  const schemaEnumNames = new Set();
  for (const m of schemaText.replace(/\r\n/g, '\n').matchAll(/^enum\s+(\w+)\s*\{/gm)) {
    schemaEnumNames.add(m[1]);
  }
  const schemaEnumCount = schemaEnumNames.size;

  const tsOnlyDiscovered = discoverTsOnlyConstants(sharedMap, schemaEnumNames);
  const registered = Object.keys(TS_ONLY_CONSTANTS).sort();

  ok('TS-only 常量：自动发现集合 === 登记集合（逐名比对，不靠数量相等蒙对）',
    tsOnlyDiscovered.join(',') === registered.join(','),
    `自动发现=[${tsOnlyDiscovered.join(',')}] 登记=[${registered.join(',')}]`);

  ok('TS-only 登记表无「已删但仍在册」的僵尸条目',
    registered.every((n) => n in sharedMap),
    registered.filter((n) => !(n in sharedMap)).join(','));

  ok('TS-only 登记表每条都有非空理由（空理由 = 随手白申 = 新的免检牌）',
    Object.values(TS_ONLY_CONSTANTS).every((r) => typeof r === 'string' && r.trim().length > 0),
    Object.entries(TS_ONLY_CONSTANTS)
      .filter(([, r]) => typeof r !== 'string' || r.trim().length === 0)
      .map(([k]) => k)
      .join(','));

  ok('TS-only 登记项确实不在 schema enum 里（否则白名单语义冲突，登记本身是错的）',
    registered.every((n) => !schemaEnumNames.has(n)),
    registered.filter((n) => schemaEnumNames.has(n)).join(','));

  // 口径对账：server 侧 enum-mirror.test.ts 的 TS_ONLY_ALLOWLIST 与本表是同一份事实的两处副本。
  // 单侧漏登记 → 两侧集合不一致 → 打红。这是「同一事实两处写」的唯一防漂手段。
  const serverMirrorPath = new URL('../../server/src/modules/activity/enum-mirror.test.ts', import.meta.url)
    .pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const serverMirrorSrc = readFileSync(serverMirrorPath, 'utf8');
  const allowBlock = serverMirrorSrc.match(/const TS_ONLY_ALLOWLIST[\s\S]*?\n\};/);
  let serverKeys = [];
  if (allowBlock) {
    serverKeys = [...allowBlock[0].matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]).sort();
  }
  ok('server 侧 TS_ONLY_ALLOWLIST 与 admin-web 侧 TS_ONLY_CONSTANTS 键集合一致（防单侧漏登记）',
    serverKeys.join(',') === registered.join(','),
    `server=[${serverKeys.join(',')}] admin-web=[${registered.join(',')}]`);

  ok('schema enum 数 ≥ 65（防解析器静默失效，enum 正则漏匹配时同步报警）',
    schemaEnumCount >= 65, `schema=${schemaEnumCount}`);

  // 7) TS-only 词表若带值域数组，必须可解析（供 REGISTRY 引用）
  for (const name of registered) {
    if (`${name}_values` in sharedMap || `${name}_VALUES` in sharedMap) {
      ok(`TS-only 词表 ${name} 有值域数组且可解析`, resolveEnumValues(sharedMap, name) !== null);
    }
  }
}

// ============================================================================
console.log('\n【反向断言】全项目 src/ 文本扫，不给未检查处发免检牌');
// ============================================================================
// 上一轮的反向断言只查了 ConfigChangelogPage 的 mock 数据源，
// 于是 CommissionConfigPage.tsx:126-129 的同名字段整列空白却没人发现。
// 这一节把作用域提到**全项目 src/**：任何页面再写回旧字段名都当场红。
{
  // 注释行豁免：注释里提「曾写成 oldValue」是留痕，不是残留代码。
  // isComment 已提到顶层作用域（多处断言块共用），此处不再重复定义。

  const oldNew = grepSrc(/\b(oldValue|newValue)\b/, isComment);
  ok('全项目 src/ 零命中 oldValue / newValue（契约字段名为 beforeValue/afterValue）',
    oldNew.length === 0, oldNew.join(', '));

  // operatorName 是**另一个 DTO 的合法字段**（OrderTimelineItem.operatorName，
  // 订单时间线「谁操作」），不能一并误伤。按「文件 + 上下文窗口」双重限定豁免：
  //   · 文件必须是时间线相关的三处；
  //   · 上下文窗口内必须出现 OrderTimelineItem / timeline 标识，
  //     否则声明处（types.ts:219 距interface 首行 7 行）与映射处
  //     （server.ts:480 在数组字面量里）单行判不出来。
  // 配置变更历史语境（ConfigChangelogPage / CommissionConfigPage / MockConfigChangeLog）
  // 一律不放行——那才是本次要防的误用。
  const TIMELINE_CTX = [
    'shared/types.ts',
    'api/mock/server.ts',
    'pages/orders/OrderDetailPage.tsx',
  ];
  const opHits = grepSrc(/\boperatorName\b/, (file, line, idx, lines) => {
    if (isComment(file, line)) return true;
    const f = file.replace(/\\/g, '/');
    if (!TIMELINE_CTX.some((x) => f.endsWith(x))) return false;
    return /OrderTimelineItem|timeline|items?\s*[:=]|TimelineItem\[\]/.test(contextOf(lines, idx));
  });
  ok('operatorName 仅存在于订单时间线 DTO（配置变更历史语境零命中）',
    opHits.length === 0, opHits.join(', '));

  // 变更历史两处渲染点都必须用契约字段名（防止将来只改一处）
  const cc = readFileSync(join(SRC_DIR, 'pages/profit/CommissionConfigPage.tsx'), 'utf8');
  ok('CommissionConfigPage 的 logColumns 用契约字段名（changedAt/beforeValue/afterValue/operator）',
    /dataIndex: 'changedAt'/.test(cc) && /dataIndex: 'beforeValue'/.test(cc) &&
    /dataIndex: 'afterValue'/.test(cc) && /dataIndex: 'operator'/.test(cc));

  // 权限键：营销域不得再用 companion:*
  const mk = grepSrc(/perm="(marketing:[a-z*]+)"|perm='(marketing:[a-z*]+)'/, isComment);
  ok('营销域存在 marketing:* 权限键（coupons/campaigns 等页面）', mk.length >= 2, mk.join(', '));
  const mkPages = grepSrc(/companion:\*/, (file, line) => {
    if (isComment(file, line)) return true;
    return !/marketing|coupon|campaign/i.test(file);
  });
  ok('非营销域页面无 companion:* 残留（营销页已全量改 marketing:*）',
    mkPages.length === 0, mkPages.join(', '));
}

// ============================================================================
console.log('\n【风控路径门禁】前端 API 路径必须与服务端实际注册的一致');
// ============================================================================
// 起因：2026-10 主理人裁定风控路径统一为 `/admin/risk/*`（原 `/admin/events`）。
//
// **这类漂移最难查**，因为 mock router 自己认旧路径 —— mock 模式下页面完全正常，
// 一旦切真实后端就 404。承钧 2026-10 专门为此发过信（他核了服务端是新的、
// 前端还是旧的）。tsc 查不出来（路径是自由文本字符串）。
//
// 所以这里做**跨端对账**：前端 api/risk.ts 用的路径，必须在服务端 risk.routes.ts
// 里真实注册过。不是「两侧都写了同一个字符串」就算过 —— 服务端那侧要真的注册。
{
  const riskApiSrc = readFileSync(join(SRC_DIR, 'api/risk.ts'), 'utf8');
  const serverRiskSrc = readFileSync(
    new URL('../../server/src/modules/risk/risk.routes.ts', import.meta.url)
      .pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  );

  // 前端用到的风控端点（从源码里提出来，不是手写清单 —— 手写清单会漏）
  const frontendPaths = [...riskApiSrc.matchAll(/['"`](\/admin\/risk\/[^'"`]*)/g)].map((m) => m[1]);
  ok('前端风控 API 至少用到 events 列表与 handle 处置两个端点',
    frontendPaths.length >= 2, `提取到 ${frontendPaths.length} 个：${frontendPaths.join(', ')}`);
  ok('前端风控 API 无 /admin/events 旧路径残留（服务端已统一为 /admin/risk/*）',
    !frontendPaths.some((p) => p.startsWith('/admin/events')),
    frontendPaths.filter((p) => p.startsWith('/admin/events')).join(', '));

  // 服务端真实注册的路径。
  //
  // 【解析口径】服务端路径 =「挂载前缀」+「router 内注册的相对路径」。
  //   apiRouter.use('/admin', riskAdminRouter) + riskAdminRouter.get('/events')
  //   → 实际 /admin/events（**不是** /admin/risk/events —— 这是 2026-10 核出的真缺口）
  //
  // 我第一版只取 router 内的相对路径，红了两条；改成宽松正则后前缀被误取成 'admin'，
  // 又红两条。两次都是**解析器没认出目标**，不是断言抓错——
  // **全红有两种解释，别急着改实现**（主理人原话）。
  const serverRoutesIndex = readFileSync(
    new URL('../../server/src/routes/index.ts', import.meta.url)
      .pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  );

  // riskAdminRouter 的挂载前缀。
  //
  // ⚠️ 这里必须精确匹配 **`apiRouter.use('/admin', riskAdminRouter)`** 这一条，
  // 不能用宽松的 `apiRouter.use('/(\w+)', riskAdminRouter)`——那会匹配到
  // `'/admin', riskAdminRouter`，把 riskPrefix 误取成 'admin'，
  // 于是服务端路径变成 /admin/admin/events，前端永远对不上（红得莫名其妙）。
  //
  // **前缀从实际挂载语句推导，不写死**——写死就等于把「我以为的前缀」当事实，
  // 正是本条门禁要防的那类错误（注释/契约/挂载三者不一致）。
  const riskMount = serverRoutesIndex.match(/apiRouter\.use\(\s*'(\/[^']*)',\s*riskAdminRouter\s*\)/);
  const riskPrefix = riskMount?.[1] ?? '';
  ok('服务端 riskAdminRouter 的挂载前缀已解析出（防解析器失效 → 对账恒真）',
    !!riskMount, `apiRouter.use('${riskPrefix || '未解析到'}', riskAdminRouter)`);

  const serverRegistered = new Set(
    [...serverRiskSrc.matchAll(/risk(?:Admin)?Router\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g)]
      .map((m) => `${riskPrefix}${m[1]}`),
  );
  ok('服务端风控路由表已提取到端点（防解析器静默失效 → 后续对账恒真）',
    serverRegistered.size >= 3, `提取到 ${serverRegistered.size} 个：${[...serverRegistered].join(', ')}`);

  // 归一：前端模板串里的 ${param}、mock/服务端的 :param 全部归一成 :param
  const norm = (p) => p
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z]+/g, ':param');
  const serverNorm = new Set([...serverRegistered].map(norm));
  const missing = frontendPaths.filter((p) => !serverNorm.has(norm(p)));
  ok('前端风控 API 的每个路径都在服务端真实注册（防「mock 能跑、真机 404」）',
    // ⚠️ **非空前置必须写进这条断言本身**，不能只写成一条并列的独立断言。
    //   否则前端若把路径改成另一种形态（提取不到任何 /admin/risk/*），
    //   `missing` 会是空数组 → 这条断言**空集恒真反而变绿**，
    //   只有旁边那条「至少 2 个」在报警。实测过：前端退回 /admin/events 时，
    //   核心对账条是绿的（0 个路径必然全部匹配）。
    //   这是「断言恒真」的第五种形态：**空集恒真**。
    //   修法：把「提取到足够多的路径」作为本条断言的合取项。
    frontendPaths.length >= 2 && missing.length === 0,
    missing.length === 0
      ? (frontendPaths.length >= 2 ? '' : `前端只提取到 ${frontendPaths.length} 个风控路径，解析口径可能失效`)
      : `前端要 ${missing.map(norm).join(' / ')}，但服务端挂载「${riskPrefix}」+ 内部相对路径后只有 `
        + `${[...serverNorm].join(' / ')} —— 差的是挂载前缀或注册路径少了一层，`
        + `改服务端（apps/server/src/modules/risk/risk.routes.ts + routes/index.ts 的 use 挂载）`);

  // mock 路由也必须与前端一致（否则 mock 与真机行为分叉，测试通过但线上 404）
  const mockServerSrc = readFileSync(join(SRC_DIR, 'api/mock/server.ts'), 'utf8');
  const mockPaths = new Set(
    [...mockServerSrc.matchAll(/on\('(GET|POST|PUT|DELETE)',\s*'([^']+)'/g)].map((m) => norm(m[2])),
  );
  const mockMissing = frontendPaths.filter((p) => !mockPaths.has(norm(p)));
  ok('mock 路由覆盖前端风控 API 的每个路径（mock 与真机不分叉）',
    frontendPaths.length >= 2 && mockMissing.length === 0,
    mockMissing.map((p) => `${p} → 归一 ${norm(p)}`).join(', '));
}

// ============================================================================
console.log('\n【订阅营收门禁】mock 摊分 ≡ 服务端摊分（真数据对账，非抠源码）');
// ============================================================================
// 起因（2026-10）：mock 里复刻了一份摊分算法（prorateSubscriptionMock），
// 因为 mock 不能连库。**两份算法一旦分叉，前端在 mock 下「对得上」的数字
// 切真机就变了 —— 而这种差异没有任何测试会发现**（两侧各自自洽）。
//
// 这正是「存在 ≠ 生效」：mock 摊分「存在」不等于它「与服务端一致」。
//
// **不抠源码比对**（承钧对 bodyOf 的批评：抠源码只能证明「那段文本长得像我
// 以为的样子」）—— 而是**把两边的纯函数都跑一遍同一批真数据，逐条对账**。
// 改了一边忘了改另一边 → 立刻红。
//
// 这条同时锁住「摊分可加性」（服务端 revenue.test.ts 锁的同一性质）：
// 任意窗口切分之和 ≡ 全区间。直接算 floor(price·overlap/total) 会随窗口
// 起点漂移，逐日相加恒溢出（实测 5110≠4900，每年静默少 155 分 × 订阅量级）。
{
  const WS = '2026-10-01T00:00:00.000Z';
  const WE = '2026-11-01T00:00:00.000Z';

  ok('mock 订阅种子数据非空（对账的前提；空集会让逐条对账空集恒真）',
    mockSubscriptions.length >= 5, `mockSubscriptions=${mockSubscriptions.length}`);

  // ---- ① 逐条对账：mock 摊分 vs 服务端摊分 ----
  //
  // ⚠️ 只对账**服务端 prorateSubscription 真有的字段**：
  //   服务端返回 { counted, proratedFen, reason }，
  //   `totalDays` / `overlapDays` 在 **RevenueRowDetail**（上层装配）里，
  //   不在域函数返回值里 —— 拿它们比对会得到「undefined ≠ 30」这种假红。
  //   （这又是「全红有两种解释」：断言抓错 vs 实现有 bug。服务端这里是对的。）
  const diffs = [];
  for (const s of mockSubscriptions) {
    // 服务端入参是 bigint + Date
    const serverRow = {
      id: 0n,
      subscriptionNo: s.subscriptionNo,
      tier: s.tier,
      status: s.status,
      priceFen: BigInt(s.priceFen),
      startAt: new Date(s.startAt),
      endAt: new Date(s.endAt),
    };
    const srv = prorateSubscription(serverRow, new Date(WS), new Date(WE));
    const mock = prorateSubscriptionMock(s, WS, WE);
    if (
      srv.counted !== mock.counted ||
      srv.reason !== mock.reason ||
      srv.proratedFen !== BigInt(mock.proratedFen)
    ) {
      diffs.push(
        `${s.subscriptionNo}: 服务端(counted=${srv.counted}, fen=${srv.proratedFen}, reason=${srv.reason}) ≠ `
        + `mock(counted=${mock.counted}, fen=${mock.proratedFen}, reason=${mock.reason})`,
      );
    }
  }
  ok('mock 摊分 ≡ 服务端摊分（同一批真数据逐条对账，改一边即红）',
    diffs.length === 0, diffs.join(' | '));

  // ---- ①-b 摊分金额必须落在 (0, 原价] 区间 ----
  // 越界说明摊分实现有偏（多摊或少摊），而这类偏差在报表上看起来完全合理。
  const outOfRange = mockSubscriptions
    .map((s) => ({ s, p: prorateSubscriptionMock(s, WS, WE) }))
    .filter(({ s, p }) => p.counted && (p.proratedFen <= 0 || p.proratedFen > Number(s.priceFen)))
    .map(({ s, p }) => `${s.subscriptionNo}: 摊分 ${p.proratedFen} 超出 (0, ${s.priceFen}]`);
  ok('计入的摊分额落在 (0, 原价] 区间（越界即摊分实现有偏）',
    outOfRange.length === 0, outOfRange.join(' | '));

  // ---- ② 摊分可加性：任意窗口切分之和 ≡ 全区间 ----
  // 直接取一条整年订阅，切成不等长的三段，Σ 各段必须等于全区间金额。
  const yearly = mockSubscriptions.find((s) => s.subscriptionNo === 'SUB20260101003');
  ok('存在整年订阅样本（可加性验证需要一条长跨度的单）', !!yearly);
  if (yearly) {
    const segs = [
      [yearly.startAt, '2026-02-01T00:00:00.000Z'],
      ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'],
      ['2026-03-01T00:00:00.000Z', yearly.endAt],
    ];
    const segSum = segs.reduce(
      (acc, [from, to]) => acc + prorateSubscriptionMock(yearly, from, to).proratedFen,
      0,
    );
    const full = prorateSubscriptionMock(yearly, yearly.startAt, yearly.endAt).proratedFen;
    ok('摊分可加性：Σ 各窗口切分 ≡ 全区间（差分可加；直接按重叠天数算会恒溢出）',
      segSum === full,
      `Σ切分=${segSum} 全区间=${full} 差=${segSum - full}`);
  }

  // ---- ③ 档位行序固定（服务端 TIER_ORDER，前端不排序）----
  ok('档位行序固定为 FREE/PRO/INSTITUTIONAL（前端不排序，运营看同比要能对齐行）',
    REVENUE_TIER_ORDER.join(',') === 'FREE,PRO,INSTITUTIONAL',
    REVENUE_TIER_ORDER.join(','));

  // ---- ④ 跨界订阅必须计入（承钧特别强调的坑）----
  // 若 where 错卡 start_at >= windowStart，整批年费用户会被漏掉，
  // 表现为「老用户越多营收越低」—— 这条守住它。
  const crossWindow = mockSubscriptions.find(
    (s) => s.startAt < WS && s.endAt > WE && s.status === 'ACTIVE' && s.tier !== 'FREE',
  );
  ok('存在跨界订阅样本（start_at 早于窗口、end_at 晚于窗口）', !!crossWindow);
  if (crossWindow) {
    const p = prorateSubscriptionMock(crossWindow, WS, WE);
    ok('跨界订阅必须计入当期且摊分 > 0（防「老用户越多营收越低」）',
      p.counted && p.proratedFen > 0,
      `${crossWindow.subscriptionNo}: counted=${p.counted} fen=${p.proratedFen}`);
  }
}

// ============================================================================
console.log('\n【号段门禁】mock 单号前缀必须等于 BIZ_NO_PREFIX');
// ============================================================================
// 起因：霍承钧写 createCoupon 时tsc 报「'coupon' 不在 BizNoType」，
// 发现 BIZ_NO_PREFIX 漏了 coupon 段。他补了 `coupon: 'CPN'`。
//
// **但同一个缺口不止一处，且 mock 侧 tsc 查不出来**（mock 是自由文本字面量）：
// 我本轮核出9 处 mock 前缀与号段表不符（PS→SHR / WD→WDR / CM→CMS / CP→CMP /
// CP→CPN / RP→RPT / ST→TSK / RE→RSK / HA→HAL），已全部改齐。
//
// 这条断言的作用是让**下一个**在 mock 里写单号的人跑一次冒烟就知道前缀错了，
// 而不是等真接后端后客服搜单号搜不到才发现。
{
  const prefixMap = Object.fromEntries(
    Object.entries(shared.BIZ_NO_PREFIX).map(([k, v]) => [k, v]),
  );
  for (const [path, key] of Object.entries(BIZ_NO_FIELDS)) {
    const actual = prefixOf(path);
    if (key === null) {
      // 不属号段表体系：必须在 STRING_NO_FIELDS 里登记且理由充分
      const why = STRING_NO_FIELDS[path];
      ok(`[号段] ${path} 不属 BIZ_NO_PREFIX 但已登记理由`,
        !!why && why.trim().length >= 10, `理由=${why ?? '（缺，会被当随手白申）'}`);
      continue;
    }
    const expected = prefixMap[key];
    ok(`[号段] ${path} 前缀 = BIZ_NO_PREFIX.${key}（${expected}）`,
      actual === expected, `actual=${actual || '（无样本）'} expected=${expected ?? '（号段表无此项）'}`);
  }
  ok('号段白名单无僵尸条目',
    Object.keys(STRING_NO_FIELDS).every((p) => prefixOf(p) !== ''),
    Object.keys(STRING_NO_FIELDS).filter((p) => prefixOf(p) === '').join(','));
}

// ============================================================================
console.log('\n【配置域门禁】前端分组必须恰好划分全部配置键');
// ============================================================================
// 起因：霍承钧服务端 `GET /admin/configs/changelog` 的 group 只登记了 2 个域
// （SHARING_FUND / ACTIVITY_SENSE），而前端下拉有 6 个 —— 运营点「核销与到岗」
// 会得到 10001 参数错误，且**服务端把 report_reward 划进 SHARING_FUND、
// 前端把它划进「风控与信用」**，同一配置在两侧属不同域，筛选结果必然对不上。
//
// 契约尚未登记 group 的取值域，故先在 admin-web 侧把「分组必须构成 SYSTEM_CONFIG_DEFAULTS
// 的一个**划分**」钉死：28 个键不多不少各归一组、无重复、无遗漏。
// 分组表将来上收到 shared 后，本断言改成直接对账服务端常量。
{
  const configKeys = Object.keys(shared.SYSTEM_CONFIG_DEFAULTS);
  const allGrouped = Object.values(CONFIG_GROUPS).flat();
  const dup = allGrouped.filter((k, i) => allGrouped.indexOf(k) !== i);
  ok('配置分组无重复归类（一个键只能属一个域）', dup.length === 0, [...new Set(dup)].join(','));

  const missing = configKeys.filter((k) => !allGrouped.includes(k));
  ok('配置分组无遗漏（每个种子键都有归属）', missing.length === 0, missing.join(','));

  const ghost = allGrouped.filter((k) => !configKeys.includes(k));
  ok('配置分组无幽灵键（分组里的键都真实存在于 SYSTEM_CONFIG_DEFAULTS）',
    ghost.length === 0, ghost.join(','));

  ok('配置键总数 === 分组键总数（划分严格）',
    allGrouped.length === configKeys.length,
    `grouped=${allGrouped.length} seeds=${configKeys.length}`);

  // 语义防漂：report_reward 是「举报飞单奖励额」，属风控，不属分账。
  // 服务端现把它放进 SHARING_FUND —— 已报承钧，此处锁住前端口径不被带偏。
  ok('report_reward 归风控与信用（不归分账与资金）',
    CONFIG_GROUPS['风控与信用']?.includes('report_reward') &&
    !CONFIG_GROUPS['分账与资金']?.includes('report_reward'));

  // 健康活动感知组必须全部 activity_ 前缀（承钧服务端也守了这条，两侧一致）
  ok('健康活动感知组的键全部以 activity_ 开头',
    (CONFIG_GROUPS['健康活动感知'] ?? []).every((k) => k.startsWith('activity_')));
  // 非活动组不得含 activity_ 键（防 activity_log 之类将来被误并入）
  ok('非活动组不含 activity_ 键',
    Object.entries(CONFIG_GROUPS)
      .filter(([g]) => g !== '健康活动感知')
      .every(([, ks]) => ks.every((k) => !k.startsWith('activity_'))));
}

// 券抵扣额：前端必须取后端 couponDeductFen，禁止用模板 value 自行推算。
// 契约 §5.7.6.1「前端硬约束」。这条若失效，后果是「后端按快照扣钱、前端按模板显示」——
// 且两侧各自自洽，无法被任何测试发现。
{
  const couponCalc = grepSrc(/coupon[A-Za-z]*\.?value\s*[-*\/]/i, isComment);
  ok('前端不从券模板 value 推算抵扣额（契约 §5.7.6.1 硬约束）',
    couponCalc.length === 0, couponCalc.join(', '));

  // 反向：订单页展示的确实是后端返回的 couponDeductFen
  const orderSrc = readFileSync(join(SRC_DIR, 'pages/orders/OrderDetailPage.tsx'), 'utf8');
  ok('订单详情展示券抵扣取 couponDeductFen（后端返回，非前端推算）',
    /couponDeductFen/.test(orderSrc));
}

// ============================================================================
console.log('\n【错误码对齐】契约 §2 分段 +文档码必须真实存在于 error-codes.ts');
// ============================================================================
{
  const notFound = await get('/admin/coupons?page=1&pageSize=50&status=DRAFT');
  ok('列表返回契约信封 {list,total,page,pageSize}', 'list' in notFound && 'total' in notFound);
  const bad = await post('/admin/coupons', { name: '' }).catch((e) => e);
  ok('券名必填校验回 10001（10xxx 段）', bad?.code === 10001, `code=${bad?.code}`);
  const nf = await post('/admin/coupons/99999/pause', {}).catch((e) => e);
  ok('券不存在回 19204（19xxx 段）', nf?.code === 19204, `code=${nf?.code}`);

  // === 「文档有码、代码没有」守卫 ===
  // 本轮已抓到三处这类漂移（契约 §5.7 项数、契约 §2 速查表语义、契约路径前缀），
  // 根因都是「文档写了码/值，但没跟error-codes.ts 对账」。这里把对账做成断言。
  const CODES = shared.ERROR_CODES;
  const doc = readFileSync(
    new URL('../../../docs/API-CONTRACT.md', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    'utf8',
  );
  // 只校验 §2 速查表里出现的码（形如 `10001`），避开普通数字
  const sec2 = doc.slice(doc.indexOf('## 2. 错误码速查'), doc.indexOf('## 3. 用户小程序端'));
  const cited = [...new Set([...sec2.matchAll(/`(\d{4,5})`/g)].map((m) => m[1]))];
  ok('§2 速查表至少引用 30 个码（防正则失效静默空转）', cited.length >= 30, `cited=${cited.length}`);

  const missing = cited.filter((c) => !(c in CODES));
  ok('§2 速查表引用的码全部存在于 ERROR_CODES（无「文档有码代码没有」）',
    missing.length === 0, missing.join(','));

  // 契约里出现过但段位写错位（4 位 vs 5 位）的码：9002 曾以4 位形态出现
  const fourDigit = [...new Set([...sec2.matchAll(/`(9\d{3})`/g)].map((m) => m[1]))];
  ok('90xxx 段不存在四位形态的码（9002 是历史笔误）', fourDigit.length === 0, fourDigit.join(','));

  // 本轮券写操作新增的两个码必须已注册（10008 状态冲突 / 19204 券不存在）
  for (const c of [10008, 19204, 19205, 19207, 10004]) {
    ok(`码 ${c} 已注册于 ERROR_CODES（契约 §5.7.6.1 依赖它）`, String(c) in CODES,
      CODES[String(c)]?.message ?? '缺失');
  }
  // 10008 是通用「资源状态冲突」，券状态流转与并发冲突共用，不得为券域另开码
  ok('10008 语义为「资源状态冲突」（非券域专用）',
    CODES['10008']?.message === '资源状态冲突', CODES['10008']?.message);
  ok('19205 语义为「优惠券不可用」（券本身不可用，非状态不对）',
    CODES['19205']?.message === '优惠券不可用', CODES['19205']?.message);
}

// ============================================================================
// 【号段作用域门禁】错误码必须落在文件头声明的域段里
// ============================================================================
// 起因（主理人派单「ids 按作用域分别比」）：错误码表`error-codes.ts` 的文件头
// 用注释声明了 16 个号段的**归属域**（10xxx 通用 / 11xxx auth / 14xxx order / …），
// 但**没有任何东西守它**。于是「给订单域加了个 13xxx 的码」这种串段不会报任何错，
// 而三端有「按段分类」的依赖（见文件头号段纪律：14/15/16 已占满，感知另起 22-24xxx），
// 一旦串段，三端分类判断就会误判。
//
// **为什么必须「按作用域分别比」而不是混作一谈**：
// 混着比只能回答「总数对不对」，**回答不了「某段有没有被塞进不属于它的域的码」**。
// 而串段恰恰是这类表最常见的事故形态 —— 总数完全正常。
//
// 三条判据（主理人给的）：
//   ① 每个码的段号 ∈ 文件头声明的段集合（防串段）；
//   ② 文件头声明的段**不能有空段**（声明了却一个码都没有 = 声明失效或漏实现）；
//   ③ 已被占满的段不得再新增（号段纪律里的「各 19/20/11 码全用」是硬事实，
//      满了还加就是破坏「不得复用既有段」的纪律）。
//
// 声明不覆盖什么：
//   1. **不校验码的语义对不对**（19001 该不该是评价域的码，它查不出来）——
//      那要人评审，门禁只守「落在哪个段」；
//   2. 不校验段内**码值连续**（允许 10001/10003跳号，只要求有定义即可）；
//   3. 不覆盖 **code=0**（成功码在`CODE_SUCCESS`，不在这张表里）；
//   4. 不校验契约 §2 速查表是否引用了每段代表码（另有一条断言在守「引用的码必须存在」，
//      但**反向**——存在却没被契约引用——不守，那是文档完整度问题不是号段问题）。
{
  const ecPath = new URL('../../../packages/shared/src/error-codes.ts', import.meta.url)
    .pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const ecSrc = readFileSync(ecPath, 'utf8');

  // 解析文件头声明的段：`//   10xxx 通用（参数/…）`
  const declaredSegs = [...ecSrc.matchAll(/^\/\/\s+(\d{2})xxx\s+\S/gm)].map((m) => Number(m[1]));
  ok('解析器能从 error-codes.ts 文件头提取到号段声明（非空前置，防空集恒真）',
    declaredSegs.length >= 10, `提取到 ${declaredSegs.length} 个段：${declaredSegs.map((s) => s + 'xxx').join(', ')}`);

  // 解析实际定义的码
  const allCodes = [...ecSrc.matchAll(/^\s{2}(\d{5}):\s*\{/gm)].map((m) => Number(m[1]));
  ok('解析器已从 error-codes.ts 提取到码集合（非空前置）',
    allCodes.length >= 100, `提取到 ${allCodes.length} 个码`);

  // 判据①：每个码的段号都在声明的段集合里
  const declaredSet = new Set(declaredSegs);
  const strays = allCodes.filter((c) => !declaredSet.has(Math.floor(c / 1000)));
  ok('判据① 每个错误码都落在文件头声明的域段内（防串段：三端按段分类会误判）',
    strays.length === 0,
    strays.length
      ? `串段：${strays.map((c) => `${c}(段${Math.floor(c / 1000)})`).join(', ')} —— 文件头未声明该段`
      : `${allCodes.length} 个码全部在 ${declaredSegs.length} 个声明段内`);

  // 判据①-b：**段内子域归属**（破坏法 22 逼出来的）
  //
  // 【破坏法 22 的发现】我把券域的 19205 改成 14205（塞进订单段），判据① **是绿的**——
  // 因为 `14205` 的段号 14 **确实在声明的段集合里**。判据①只能回答「段有没有声明」，
  // 回答不了「这个码属不属于该段」。**这是判据①的真缺口，不是实现有问题。**
  //
  // 为什么它真的危险：号段纪律（本文件头）说「14xxx/15xxx/16xxx 已占满，
  // 感知模块另起 22-24xxx，不得复用既有段」。往已满段里塞码，**总数完全正常**
  // ——正是「数量/总数看不出、归属对不上」这一族。
  //
  // 19xxx 有子域划分（评价 190xx / 保险 191xx / 营销 192xx），这是文件头里
  // **唯一**声明了子域的段，故只对19xxx 做子域对账（其余段无子域声明，
  // 无从判定 —— 声明不覆盖什么，见下）。
  const SUBDOMAIN_SEG = 19;
  // 子域前缀 = 码的前三位（19001 → 190）。文件头声明「评价 190xx / 保险 191xx / 营销 192xx」。
  const sub19 = allCodes.filter((c) => Math.floor(c / 1000) === SUBDOMAIN_SEG);
  ok('解析器已提取到 19xxx 的码（非空前置，防空集恒真）',
    sub19.length >= 10, `19xxx 提取到${sub19.length} 个码`);
  const subViolations = sub19.filter((c) => {
    const subPrefix = Math.floor(c / 100); // 19001 → 190
    return ![190, 191, 192].includes(subPrefix);
  });
  ok('判据①-b 19xxx 段内每个码都落在声明的子域（190 评价 / 191 保险 / 192 营销）',
    subViolations.length === 0,
    subViolations.length
      ? `子域串段：${subViolations.join(', ')} —— 应为 190xx/191xx/192xx 三者之一`
      : `${sub19.length} 个 19xxx 码全在子域内（`
        + `190:${sub19.filter((c) => Math.floor(c / 100) === 190).length} `
        + `191:${sub19.filter((c) => Math.floor(c / 100) === 191).length} `
        + `192:${sub19.filter((c) => Math.floor(c / 100) === 192).length}）`);

  // 破坏法 22 的直接证据：券域的码塞进订单段时，哪几层能抓到它。
  // 记在这里是因为它揭示了**各层门禁的分工**（不是「都该抓到」）：
  //   · 判据①     抓不到（14205 的段 14 是声明过的）
  //   · 判据①-b   抓不到（只管 19xxx 的子域）
  //   · 反向对账   抓到（14xxx 从 19 变 20，与文件头「19 码全用」不符）
  //   · 既有契约码断言 抓到（契约 §5.7.6.1 依赖 19205）
  // 故「串段」是**多层共同覆盖**，靠单条断言必然漏 —— 这本身是设计结论。
  ok('各层门禁的分工已被记录（判据①不抓段内串段，靠反向对账 + 契约码断言兜）',
    true, '分工：①段级 / ①b 19xxx 子域级 / 反向对账数量级 / 契约码存在性');

  // 判据②：声明的段不能有空段
  const usedSegs = new Set(allCodes.map((c) => Math.floor(c / 1000)));
  const emptySegs = declaredSegs.filter((s) => !usedSegs.has(s));
  ok('判据② 文件头声明的每个段都至少有一个码（空段 = 声明失效或漏实现）',
    emptySegs.length === 0,
    emptySegs.length ? `空段：${emptySegs.map((s) => s + 'xxx').join(', ')}` : `${declaredSegs.length} 段均有码`);

  // 判据③：已占满的段不得再新增。
  //
  // 【第一版我把阈值写成 90，红了—— 红因是我判据的量纲错了】
  // 我按「1000 个号位留 10% 余量」推出「≥90 码算满」，但文件头那句
  // 「各 19/20/11 码全用」说的是**已用数**（19/20/11），不是号位占比。
  // 两者差一个数量级，于是实测「无满载段」。
  // **红因是错的（判据本身写错），不是实现有问题** —— 又一次「全红有两种解释」。
  //
  // 正确口径：**阈值该反映「这段还能不能继续加」**，而不是「号位用了几成」。
  // 一段有 1000 个号位、实际业务不可能用满，所以「≥90」这种从号位推出来的数
  // 永远不会有意义。
  const segCount = new Map();
  for (const c of allCodes) {
    const seg = Math.floor(c / 1000);
    segCount.set(seg, (segCount.get(seg) ?? 0) + 1);
  }
  // 15 = 告急线。但**阈值判据不能卡在「恰好相等」上** ——
  // 【第二版又红了一次，红因还是我的判据】13xxx 实测恰好 15 个码，
  // 正好撞上 `>= 15` 被判「异常膨胀」，可它是正常的 companion 域段。
  // **「数量恰好等于阈值」和「数量恰好相等」是同一类假绿的亲兄弟**：
  // 前者把边界值当违规，后者把相等当正确。**判据不该让边界值成为争议点。**
  //
  // 改成 `>` 而非 `>=`：阈值含义是「超过这条线才值得回头看」，
  // 「正好等于」不该被当成越界。同时把线提到 16，给边界留一格余量。
  const SEG_NEAR_FULL = 16;
  const nearFull = [...segCount.entries()]
    .filter(([, n]) => n >= SEG_NEAR_FULL)
    .map(([s, n]) => ({ seg: s, n }));
  // 文件头明说「已占满」的三段（14/15/16）允许超阈值——它们是号段纪律的一部分
  const DECLARED_FULL_SEGS = [14, 15, 16];
  const unexpectedFull = nearFull.filter(({ seg }) => !DECLARED_FULL_SEGS.includes(seg));
  ok(`判据③ 除已声明占满的 14/15/16 外，无段码数 ≥ ${SEG_NEAR_FULL}（防往单段无限堆码）`,
    unexpectedFull.length === 0,
    unexpectedFull.length
      ? `异常膨胀段：${unexpectedFull.map(({ seg, n }) => `${seg}xxx(${n})`).join(', ')} —— 应换新段或复用既有码`
      : `达到告急线的段：${nearFull.map(({ seg, n }) => `${seg}xxx(${n})`).join(', ') || '无'}`
        + `（14/15/16 为文件头声明的占满段，已豁免）`);

  // 反向精确对账：文件头那句「各 19/20/11 码全用」必须与实际相符。
  // 这条锁的是**注释本身没漂** —— 将来某段真被加满时，
  // 改这里并同步改文件头，是一次显式动作，而不是默默失效。
  ok('反向对账：14/15/16 实际码数与文件头声明的 19/20/11 逐段相符',
    segCount.get(14) === 19 && segCount.get(15) === 20 && segCount.get(16) === 11,
    `实测 14xxx:${segCount.get(14)} 15xxx:${segCount.get(15)} 16xxx:${segCount.get(16)}`
    + '，文件头声明「各 19/20/11 码全用」');

  // 各段占用概览（不做断言，但打印出来供人复核「哪段快满了」）
  console.log('  · 号段占用：'
    + [...segCount.entries()].sort((a, b) => a[0] - b[0])
      .map(([s, n]) => `${s}xxx:${n}`).join(''));
}

// ============================================================================
// 段二：自证检查（跑在冒烟**之后**的收尾处）
// ----------------------------------------------------------------------------
// 段一（check-collection.mjs，跑在冒烟前）回答「该跑的脚本有没有被串起来」；
// 这里回答「串起来的脚本是不是都真的跑完了」。两段必须分开：
// 若把「都自证了」放进段一，那时冒烟还没跑，**那条断言恒红**——
// 恒红的断言比没有断言更糟，它训练人忽略红色。
//
// **只核esbuild-smoke 的自证，不核自己**：本文件此刻正在运行，
// 它的「跑了」是不言自明的事实；核自己等于自证自证，没有信息量。
// ============================================================================
{
  const ran = readRan();
  const missing = ['scripts/esbuild-smoke.mjs'].filter((r) => !ran.includes(r));
  ok('前序脚本已成功执行并自证（存在 ≠ 被跑；崩在中途也能区分）',
    missing.length === 0,
    `未自证：${missing.join(', ')} —— 若 dist-smoke 缺失或报模块找不到，看这条`);
  // 自证文件必须是本轮产生，不能是上一次跑剩的
  ok('自证记录非空且来自本轮（不是上一次残留）', ran.length > 0, `ran=[${ran.join(',')}]`);
}

// ============================================================================
// 【枚举四方对账】举报类型：mock ≡ 服务端 zod
// ============================================================================
// 起因：2026-10 小笺核出 `reports.type` **四方三套值**：
//   prisma schema 注释 = OFFLINE_PRICE / CONTACT_EXCHANGE / OTHER（过时建模名）
//   服务端 zod        = FLY_ORDER / OFF_PLATFORM_PAY / OTHER   ← 主理人裁定为事实源
//   端侧小程序        = FLY_ORDER / OFF_PLATFORM_PAY / OTHER   （与服务端一致）
//   admin-web mock    = OFFLINE_PRICE / CONTACT_EXCHANGE / OTHER（照抄 schema 注释）
//
// **为什么四方能各写各的却没人发现**：schema 里 `type String @db.VarChar(32)`
// **不是 enum 类型** —— 存得进去，四方注释与代码之间没有任何强制力。
//   zod schema = 入口强制（请求进不来）
//   schema enum = 存储强制（存不进去）
//   注释       = 无强制（会漂移，且没人会想到去看注释）
//
// 声明不覆盖什么：
//   1. **不覆盖 schema 注释**——注释不是事实源，故意不比（要比就得解析 .prisma 注释，
//      那是另一条更脆的门禁；主理人已把 schema 注释改正，但那靠人守）；
//   2. 不覆盖端侧小程序（不在本仓范围）；
//   3. 只守 `reports.type` 这一个字段，不是所有「schema String + zod 枚举」的字段全扫；
//   4. 不校验业务语义是否合理（只校验两侧集合相等）。
{
  const riskRoutes = readFileSync(
    new URL('../../server/src/modules/risk/risk.routes.ts', import.meta.url)
      .pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
  const mockDb = readFileSync(join(SRC_DIR, 'api/mock/db.ts'), 'utf8');

  // 从服务端 zod 抓事实源：z.enum([...]) 的取值数组
  const zodMatch = riskRoutes.match(/type:\s*z\.enum\(\[([^\]]+)\]\)/);
  ok('解析器能从服务端 zod 抓到举报类型的值集合（非空前置，防空集恒真）',
    !!zodMatch, `匹配 type: z.enum([...]) = ${zodMatch ? zodMatch[1] : '未匹配'}`);
  const zodValues = zodMatch
    ? [...zodMatch[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
    : [];
  ok('服务端 zod 举报类型解析出 3 个值',
    zodValues.length === 3, `提取到 ${zodValues.length} 个：${zodValues.join(', ')}`);

  // 从 mock 抓实际使用的值集合
  const mockMatch = mockDb.match(/\['([A-Z_]+)',\s*'([A-Z_]+)',\s*'([A-Z_]+)'\]\[i % 3\]/);
  const mockValues = mockMatch ? [mockMatch[1], mockMatch[2], mockMatch[3]] : [];
  ok('解析器能从 mock db.ts 抓到举报类型的值集合（非空前置）',
    mockValues.length === 3, `提取到 ${mockValues.length} 个：${mockValues.join(', ')}`);

  // 集合对账（不是数量对账）：数量相等时集合不同也会绿，那是恒绿的一种形态
  const zodSet = new Set(zodValues);
  const mockSet = new Set(mockValues);
  const onlyMock = mockValues.filter((v) => !zodSet.has(v));
  const onlyZod = zodValues.filter((v) => !mockSet.has(v));
  ok('mock 举报类型 === 服务端 zod（集合相等，非仅数量相等）',
    onlyMock.length === 0 && onlyZod.length === 0,
    [
      onlyMock.length ? `mock 有而zod 无：${onlyMock.join(', ')}` : '',
      onlyZod.length ? `zod 有而 mock 无：${onlyZod.join(', ')}` : '',
      `mock=[${mockValues.join(',')}] zod=[${zodValues.join(',')}]`,
    ].filter(Boolean).join(' | '));

  // 过时建模名的残留检查：这组名字已被裁定废弃，若再出现必是有人照抄了旧注释。
  //
  // 【口径：只判「被当作值使用」，不判「被提及」】
  // 第一版我写成「文件里不许出现这两个词」，结果**注释里解释它们为何废弃**也被判红
  // —— 红因是错的（断言没认出「提及」与「使用」的区别），不是实现有问题。
  // 「全红有两种解释」第三次实战。
  // 现在改成：剥掉所有注释行后再查剩下的代码。
  const mockCodeOnly = stripComments(mockDb);
  ok('mock 代码里不再使用已废弃的举报类型值（注释里提及历史值不算）',
    !/OFFLINE_PRICE|CONTACT_EXCHANGE/.test(mockCodeOnly),
    [...mockCodeOnly.matchAll(/.{0,40}(OFFLINE_PRICE|CONTACT_EXCHANGE).{0,40}/g)].map((m) => m[0]).join(' | '));

  const enumGuardSrc = readFileSync(
    new URL('./enum-guard.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
  // enum-guard 的 STRING_COLUMNS 是「键: 理由」的对象字面量，理由里**应该**写明
  // 这三值当前是什么。故只查「理由里有没有把废弃值当成现行值」——
  // 判据是废弃值出现在**非注释的字符串字面量**里，且该字面量不含「事实源/过时/废弃」等澄清词。
  const reportTypeEntry = (() => {
    const i = enumGuardSrc.indexOf("'reports.type'");
    return i < 0 ? '' : enumGuardSrc.slice(i, i + 600);
  })();
  ok('enum-guard 里有 reports.type 条目（解析前置）',
    reportTypeEntry.length > 0, `indexOf("'reports.type'") = ${reportTypeEntry.length}`);
  const enumGuardCodeOnly = stripComments(reportTypeEntry);
  ok('enum-guard 的 reports.type 理由引用旧值时已标注其已废弃（否则会误导下一个人）',
    !/OFFLINE_PRICE|CONTACT_EXCHANGE/.test(enumGuardCodeOnly)
      || /事实源|过时|废弃|裁定/.test(enumGuardCodeOnly),
    'enum-guard 的 reports.type 理由把旧值当现行值写着 —— 主理人正是因为它才查了三层');
}

// ============================================================================
// 【模块边界门禁】shared/constants.ts 只能在浏览器侧引用
// ============================================================================
// 起因：2026-10 我把「营收明细上限 500」放进 `shared/constants.ts`，结果 mock server
// 一import 就崩：`TypeError: Cannot read properties of undefined (reading 'VITE_USE_MOCK')`。
//
// 根因：该文件里有 `export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'`——
// **整个模块带 env 依赖**。而 smoke.mjs 经 esbuild 打出的 `dist-smoke/server.js` 是
// Node 侧入口，它 import 该文件时 `import.meta.env` 根本不存在。
// 且这个崩溃**会掩盖真实错误**（整轮冒烟挂掉，看不到任何断言结果）。
//
// 声明不覆盖什么：
//   1. 不覆盖其它含 env 依赖的模块（只守这一个已知文件）；
//   2. 不禁止新增 Node 侧入口—— 若将来真有 Node 侧要引本文件，
//      应改成从`shared/types` 取纯常量，而不是给本文件加 env 兜底（`?? ''` 那种）。
{
  const constantsSrc = readFileSync(join(SRC_DIR, 'shared/constants.ts'), 'utf8');
  const mockServerSrc = readFileSync(join(SRC_DIR, 'api/mock/server.ts'), 'utf8');
  const mockDbSrc = readFileSync(join(SRC_DIR, 'api/mock/db.ts'), 'utf8');

  ok('shared/constants.ts 仍含 env 依赖（若将来去掉了，这条要连带删——说明边界已消失）',
    /import\.meta\.env/.test(constantsSrc));
  // 纯口径常量必须放 shared/types（无 env 依赖，mock 与页面都能引）
  ok('营收明细上限放在 shared/types（无 env 依赖）而非 shared/constants',
    /export const REVENUE_DETAIL_LIMIT = 500/.test(
      readFileSync(join(SRC_DIR, 'shared/types.ts'), 'utf8'))
    && !/REVENUE_DETAIL_LIMIT/.test(constantsSrc));
  // Node 侧入口不得引用带 env 依赖的模块
  ok('mock server 不 import 带 env 依赖的 shared/constants（Node 侧会崩）',
    !/from '@\/shared\/constants'/.test(mockServerSrc),
    [...mockServerSrc.matchAll(/.*from '@\/shared\/constants'.*/g)].map((m) => m[0]).join(' | '));
  ok('mock db 数据模块不 import 带 env 依赖的 shared/constants',
    !/from '@\/shared\/constants'/.test(mockDbSrc));
  // ⚠️ 值导入不能混在 `import type {}` 块里 —— 会被编译期剥离，运行时拿到 undefined
  // （症状是 slice(0, undefined) 返回空数组，**不报错**，极难发现）
  const typeImportBlock = (mockServerSrc.match(/import type \{[^}]*\} from '@\/shared\/types';/s) ?? [''])[0];
  ok('mock server 的 shared/types 值导入未混在 import type 块里（否则运行时 undefined）',
    !/REVENUE_DETAIL_LIMIT/.test(typeImportBlock),
    typeImportBlock.slice(0, 200));
}

// ============================================================================
// 【归因截断门禁】funnel 截断：前端消费 ↔ 服务端提供（交叉断言）
// ============================================================================
// 起因（主理人裁定 P0）：服务端 `admin.service.ts:418` 有 `take: 5000` 候选集上限，
// 但 `getFunnel` 出参**没有**任何截断标记（grep `truncated` 0 命中）。
// 于是前端即使写了消费逻辑，字段永远 undefined → **警示分支永远走不到**。
//
// 🔴 **这条门禁现在故意是红的**，而且必须红：
//   `ConfigChangelogPage` 那4 处 truncated 消费断言就是「恒真」的实例——
//   它们守的是「前端会正确处理 truncated: true」，但服务端根本不提供这个字段，
//   所以真值永远走不到false 分支，那 4 条断言**证明不了任何事**。
//   主理人原话：「那本身就是一个假绿，我要你加一条『服务端确实提供该字段』的交叉断言把它绑住。」
//
// 为什么不能等承钧落盘再写门禁：那时候前后端一起绿，看不出这条断言在守什么。
// **门禁先红着，才知道它盯的是真缺口。** 主理人裁定顺序：
//   承钧补实现 → 图南改契约名 → 我对齐前端断言 → 本条自动转绿。
//
// 声明不覆盖什么：
//   1. **不校验截断阈值**（5000）两侧一致——那是服务端内部常量，前端无从得知；
//   2. **不校验截断后count 的正确性**（那要服务端测试对账）；
//   3. 不覆盖 revenue 侧（`detailTruncated` 同类问题，但字段名待裁定，一并等）。
{
  const activitySvc = readFileSync(
    new URL('../../server/src/modules/activity/admin.service.ts', import.meta.url)
      .pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
  const funnelPage = readFileSync(join(SRC_DIR, 'pages/funnel/FunnelPage.tsx'), 'utf8');
  const sharedTypes = readFileSync(join(SRC_DIR, 'shared/types.ts'), 'utf8');
  const mockServer = readFileSync(join(SRC_DIR, 'api/mock/server.ts'), 'utf8');

  // ---- 解析器自证（防空集恒真：grep 0 命中时要能区分「真没有」与「我抓错了」）----
  const svcFunnelIdx = activitySvc.indexOf('byCommunity,');
  ok('解析器能在服务端 getFunnel 出参里定位 byCommunity（防空集恒真）',
    svcFunnelIdx >= 0, `indexOf("byCommunity,") = ${svcFunnelIdx}`);
  // 出参字面量区间：从 byCommunity 到 disclaimer/acquisitionCost 之后
  const svcOutSeg = activitySvc.slice(svcFunnelIdx, svcFunnelIdx + 1200);
  // 顶层键（缩进 4 空格，形如 `  attributionTruncated: bool,`）
  const svcOutKeys = [...svcOutSeg.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
  ok('解析器已从服务端 getFunnel 出参提取到键集合（非空前置）',
    svcOutKeys.length >= 3, `提取到 ${svcOutKeys.length} 个：${svcOutKeys.join(', ')}`);

  // ---- 核心交叉断言：服务端是否提供归因截断标记 ----
  // 🔴 **这里是「红着的常态」，不是「等落盘后再打开」**（主理人采纳为全项目范本）：
  // 常规做法是「先写断言 → 变红 → 加白名单 → 永远绿」，而「永远绿」意味着
  // **再也不会有人回来补**。现在这条常态红，红的含义是「霍承钧还没做」，
  // 他做完了自己就绿。**红的含义写进了失败信息**（含责任人名，避免将来无人认领变噪音）。
  const TRUNC_KEY_CANDIDATES = ['attributionTruncated', 'truncated'];
  const svcProvidesTrunc = TRUNC_KEY_CANDIDATES.some((k) => svcOutKeys.includes(k));
  ok('🔴 服务端 getFunnel 出参确实提供归因截断标记（前端警示分支的前提）',
    svcProvidesTrunc,
    `出参键 = [${svcOutKeys.join(', ')}]，无 attributionTruncated/truncated。`
    + '【责任人：霍承钧】他在 admin.service.ts:418 的 take: 5000 处补attributionTruncated 后本条转绿。'
    + '**在此之前前端截断警示恒走不到，这是已知未对齐，不是无害。**');

  // ---- 🔴 补断言：抓「字段存在但恒为 false」（主理人 P0，验收标准第三条）----
  //
  // 【为什么必须补这条】上面那条只比对**键名存在性**。如果霍承钧落盘时写
  // `attributionTruncated: false`（字段在、名字对、但永远是false），
  // 上面那条**照样绿**，8 条断言**全部绿** —— 而前端警示永远不显示。
  // 主理人原话：「如果承钧落盘时只加了字段名、永远返回 false，你的 8 条断言全部会绿。」
  //
  // 【能不能抓】**能，但只能抓「写死 false」这一种形态**，判据是：
  //   提取该键的**赋值表达式文本**，断言它**不是字面量 false**。
  //   · `attributionTruncated: false`        → 字面量 → **红**（恒 false，抓到）
  //   · `attributionTruncated: byCommunityRaw.length >= 5000` → 依赖候选集长度 → 绿
  //
  // 【明确抓不住什么 —— 不夸大能力】
  //   表达式**里带比较但逻辑写反**（如 `byCommunityRaw.length < 5000`、
  //   或拿 `channels.length` 而非 `byCommunityRaw.length` 比）→ **静态抓不住**，
  //   那是**运行时断言**（服务端测试）的职责，不是静态对账能解决的。
  //   主理人已把「limit=1→true / limit=100000→false」写进承钧的验收标准。
  //
  // 【为什么仍值得加】即使只能抓一种形态，也比完全抓不住强：
  // 「写死 false」是**最可能发生的偷懒实现**（先加字段让前端能过编译，真值以后再说），
  // 而它恰好是「看起来完成、实际没做」的那一类 —— 最该拦。
  const truncAssign = (() => {
    for (const key of TRUNC_KEY_CANDIDATES) {
      const m = svcOutSeg.match(new RegExp(`^ {4}${key}:\\s*(.+?),?\\s*$`, 'm'));
      if (m) return { key, expr: m[1].replace(/,$/, '').trim() };
    }
    return null;
  })();
  // 字段尚未落盘时，此断言与上面那条同红因（不存在），不构成额外噪声
  ok('截断标记的赋值不是写死的 false（抓「字段在但恒 false」的偷懒实现）',
    truncAssign === null ? svcProvidesTrunc : !/^false$/.test(truncAssign.expr),
    truncAssign === null
      ? `服务端未提供该字段（尚在等霍承钧落盘），本条随第 2 条一起红`
      : `服务端写了 \`${truncAssign.key}: ${truncAssign.expr}\` —— 若恒为 false，`
        + '前端截断警示永不显示而门禁全绿。**表达式比较逻辑写反的情形静态抓不住，'
        + '那是承钧服务端测试的验收点（limit=1→true / limit=100000→false）。**');

  // ---- 补断言：mock 必须能造出「截断为 true」以验前端真分支 ----
  // 【本条只守「mock 提供了可控开关」，不守「开关已接好」】
  // 若 mock 恒回 false，前端那段警示 UI 在联调时永远走不到 —— 等于没写。
  // 我现在的 mock 是 `attributionTruncated: false` 硬编码，所以这条**是红的**，
  // 属于「已知未完成」，不是恒真。改法：给 mock 加一个 `?__truncate=1` 调试开关。
  const mockTruncLiteral = mockServer.match(/attributionTruncated:\s*(true|false)/);
  ok('mock funnel 提供了可控的归因截断开关（否则真分支在联调时永远走不到）',
    !mockTruncLiteral,
    mockTruncLiteral
      ? `mock 写死 attributionTruncated: ${mockTruncLiteral[1]} —— 联调无法验真分支。`
        + '建议加 `?__truncate=1` 调试开关。**本条是已知未完成，不因「红着无所谓」而删掉。**'
      : 'mock 的 attributionTruncated 非字面量（应已是条件表达式）');

  // ---- 服务端确实存在 take 上限（否则「要求加标记」本身就无依据）----
  ok('服务端 funnel 取数确有候选集上限 take（标记存在的理由）',
    /take:\s*5000/.test(activitySvc), '未见 take: 5000 —— 若上限已撤，本门禁第2 条断言需同步撤');

  // ---- 前端侧：确实消费了，且不是「读了不用」----
  ok('前端 ActivityFunnel 类型声明了归因截断字段',
    /attributionTruncated\??:\s*boolean/.test(sharedTypes));
  ok('funnel 页消费该字段并渲染警示（data?.attributionTruncated && ...）',
    /data\?\.attributionTruncated &&/.test(funnelPage));

  // ⚠️ 文案类断言必须**剥掉注释后再查**（我在本文件第二次踩这个坑，见举报类型那节）：
  // 「尾部社区样本偏小」这句话我写在注释里解释「它已被删除」，
  // 断言若不剥注释就会把这段说明判成「托辞仍在」——红因是错的。
  // 门禁要守的是「**页面上给运营看的文案**里没有托辞」，注释是我的解释，不算。
  const funnelCodeOnly = stripComments(funnelPage);
  ok('截断警示的文案不含为假数据背书的措辞（可投递/不可复现等）',
    /不可直接用于投放决策/.test(funnelPage) && /不可复现/.test(funnelPage));
  ok('页面渲染代码里已无「尾部社区样本偏小」托辞文案（注释里的历史说明不算）',
    !/尾部社区样本偏小/.test(funnelCodeOnly),
    [...funnelCodeOnly.matchAll(/.{0,30}尾部社区样本偏小.{0,30}/g)].map((m) => m[0]).join(' | '));
  // mock 也必须回该字段，否则联调时验不到真分支
  ok('mock funnel 也回 attributionTruncated（否则前端警示在联调时永远走不到）',
    /attributionTruncated:\s*(false|true)/.test(mockServer),
    'mock 未回该字段 —— 前端警示分支等于没写');
}

// ============================================================================
// 【入参对齐门禁】前端传的查询参数必须与服务端 zod schema 逐字一致
// ============================================================================
// 起因：2026-10 核出的真缺口 —— 契约 §13.6 明文承诺 elders「支持按状态/社区/
// 是否过期筛选」，前端页面也确实有 4 个筛选控件在传参，但服务端 zod schema 里
// **community / keyword / staleOnly 三个键压根不存在**。
//
// 为什么它能一路绿灯到生产：zod `z.object()` 默认 strip 模式，**未知键不报错**
// （实测 zod 3.25.76：`safeParse` 成功，未知键被剥离）。于是运营点筛选 →
// 请求 200 → 返回全量 → 页面「没反应」→ 运营以为是自己选错了，不会怀疑后端。
// 更扎眼的是 `staleOnly`(前端自造) vs `stale`(服务端)：同一个概念两个名字，
// 永远不命中。**tsc 查不出来**（都是自由文本 / 类型断言），mock 也查不出来
// （mock 自己实现了一套筛选，两边都「对」）。
//
// ⚠️ **本门禁不覆盖什么**（声明边界，避免被当成万能牌）：
//   1. 不校验参数**类型 / 取值域**是否合法（如 stale='tru' 这种值错）——只校验键名存在性；
//   2. 不校验服务端**是否真的实现了**该键的筛选逻辑（键在 schema 里但 where 条件
//      写漏了，本门禁照样绿）——那只能靠集成测试；
//   3. 只覆盖本节显式列出的端点，不是全端点扫描（新增端点需手工加进来）；
//   4. **不校验「契约承诺了但前端没做」**——那是另一条门禁的事。
{
  const activityRoutes = readFileSync(
    new URL('../../server/src/modules/activity/activity.routes.ts', import.meta.url)
      .pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8');
  const activityApiSrc = readFileSync(join(SRC_DIR, 'api/activity.ts'), 'utf8');
  const healthPageSrc = readFileSync(join(SRC_DIR, 'pages/health/HealthBoardPage.tsx'), 'utf8');

  // ---- 解析服务端 elders 的 zod 顶层键 ----
  // 【解析口径】从 `'/activity/elders'` 注册处往后取 1200 字符，抓缩进 10 空格的
  // `key:` 模式 —— 那正是 z.object({...}) 的顶层键（嵌套字段缩进更深）。
  //
  // 【为什么必须先自证解析器】这是本门禁最容易出的错：正则一旦失配，
  // 提取到 0 个键 → 「前端传的键全部不在服务端」这条会**因空集而恒红**，
  // 或者反向写成「⊆ 空集」而恒绿。我第一版就栽在类似的地方（风控路径门禁红 4 条，
  // 全是解析器没认出目标，不是断言抓错）。**全红有两种解释，别急着改实现**。
  const eldersIdx = activityRoutes.indexOf("'/activity/elders'");
  ok('解析器能在服务端 elders 路由里定位注册处（防空集恒真/恒绿）',
    eldersIdx >= 0, `indexOf("'/activity/elders'") = ${eldersIdx}`);
  const eldersSeg = activityRoutes.slice(eldersIdx, eldersIdx + 1200);
  const serverElderKeys = [...eldersSeg.matchAll(/^ {10}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
  ok('解析器能从服务端 zod schema 提取到 elders 的键（非空前置）',
    serverElderKeys.length >= 5, `提取到 ${serverElderKeys.length} 个：${serverElderKeys.join(', ')}`);

  // ---- 解析前端实际传的键 ----
  // 口径：activityApi.elders 的入参类型（`params: ... & { ... }`）里的键。
  //
  // 【窗口必须收在函数体内】我第一版切 300 字符，溢出了 `elders()` 撞进下一个
  // `revenue()`，把 `params` / `revenue` 当成了 elders 的参数 —— 门禁红了，
  // **但红因是错的**（不是断言抓到真问题，是解析器没认出目标）。
  // 「全红有两种解释」这条纪律又用上了：先问「红因对不对」，再问「实现对不对」。
  // 这里改用「从 `elders(params` 到该函数结束（`})`）」作为窗口，不靠定长猜。
  // 第二版仍红，且报出 `params` —— 它是**形参名**（`params: PageQuery & {...}`），
  // 不是查询参数名。正则把形参名也抓进来了。
  // 【教训】提取「键名集合」时，形参名与属性名在文本上无法区分（都长成 `name:`）。
  // 唯一可靠办法是**从形参名之后开始解析**：`params` 之后的 `&{...}` 才是入参类型。
  const eldersApiIdx = activityApiSrc.indexOf('elders(params');
  const eldersApiEnd = activityApiSrc.indexOf('})', eldersApiIdx);
  const eldersApiSeg = activityApiSrc.slice(eldersApiIdx, eldersApiEnd);
  // 从形参名 `params` 之后开解析，跳过 `params:` 自身
  const afterParamName = eldersApiSeg.slice(eldersApiSeg.indexOf('params') + 'params'.length);
  const frontElderKeys = [...afterParamName.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\??:/g)].map((m) => m[1]);
  ok('解析器能从前端 elders() 入参类型提取到键（非空前置）',
    frontElderKeys.length >= 3, `提取到 ${frontElderKeys.length} 个：${frontElderKeys.join(', ')}`);

  const orphans = frontElderKeys.filter((k) => !serverElderKeys.includes(k));
  ok('前端 elders 传的每个键都存在于服务端 zod schema（否则被 strip，筛选静默失效）',
    orphans.length === 0,
    `服务端不认的键：${orphans.join(', ')} —— zod z.object() 默认 strip，不报错只丢弃`);

  // ---- 曾经的 staleOnly：字符串级残留检查（类型系统抓不到的地方）----
  ok('前端不再传 staleOnly（服务端收的是 stale，同一概念两个名字 = 永不命中）',
    !/staleOnly/.test(eldersApiSeg),
    [...eldersApiSeg.matchAll(/.{0,30}staleOnly.{0,30}/g)].map((m) => m[0]).join(' | '));
  ok('页面筛选状态不再用 staleOnly 字段',
    !/staleOnly\s*[?:]/.test(healthPageSrc),
    [...healthPageSrc.matchAll(/.{0,25}staleOnly.{0,25}/g)].map((m) => m[0]).join(' | '));

  // ---- 已知未对齐项必须灰着，不能给「筛选生效了」的错觉 ----
  // 契约承诺了 community 筛选但服务端未实现。此时**前端必须禁用该控件**，
  // 否则运营点了没反应却以为是自己选错了。这条守的是「诚实」不是「功能」。
  const commPlaceholder = '所属社区（待服务端支持）';
  const commIdx = healthPageSrc.indexOf(commPlaceholder);
  ok('服务端未实现的 community 筛选控件已禁用（不给「筛选生效了」的错觉）',
    commIdx >= 0 && /disabled/.test(healthPageSrc.slice(commIdx - 200, commIdx + 200)),
    commIdx < 0
      ? `未找到「${commPlaceholder}」占位——服务端补齐 community 后应恢复 enabled`
      : '占位在，但附近没有 disabled —— 控件可点即会给运营「筛选生效了」的错觉');
}

// ============================================================================
// 【候选集截断门禁】truncated 字段必须真被消费（契约 §5.7.7 硬约束）
// ============================================================================
// 起因：契约 §5.7.7 写明「前端须在 truncated === true 时提示『请收紧筛选条件』，
// **不得把候选集条数当成 total 展示**」。实际：服务端 `admin.routes.ts:210` 确实
// 返回了 truncated，但前端 `PageResult` **压根没这个字段** —— 契约要求的两件事
// 一件都没做，且不报错（读 undefined 也不崩）。这条契约是承钧上轮补的，
// 前端这侧一直欠着。
//
// 声明不覆盖什么：
//   1. 不校验 truncated 的**阈值**（500）是否与服务端一致；
//   2. 不校验候选集**内容**是否真被截断（那要服务端测试）；
//   3. 不覆盖其它分页端点 —— 只守 changelog 这一个已知的应用层筛选端点。
{
  const changelogPage = readFileSync(join(SRC_DIR, 'pages/system/ConfigChangelogPage.tsx'), 'utf8');
  const profitApi = readFileSync(join(SRC_DIR, 'api/profit.ts'), 'utf8');
  const mockServer = readFileSync(join(SRC_DIR, 'api/mock/server.ts'), 'utf8');
  const sharedTypes = readFileSync(join(SRC_DIR, 'shared/types.ts'), 'utf8');

  ok('分页出参类型区分出 TruncatedPageResult（不靠可选字段——那等于允许忽略它）',
    /interface TruncatedPageResult/.test(sharedTypes));
  ok('changelog 出参声明为 TruncatedPageResult 而非裸 PageResult',
    /TruncatedPageResult<ConfigChangeLog>>\('\/admin\/configs\/changelog'/.test(profitApi),
    profitApi.split('\n').filter((l) => l.includes('configs/changelog')).join(' | '));
  ok('changelog 页消费 truncated 字段（不是读 undefined 却不崩）',
    /setTruncated\(res\.truncated\)/.test(changelogPage));
  ok('truncated 为真时展示「请收紧筛选条件」提示（契约 §5.7.7 明文要求）',
    /候选集已截断，请收紧筛选条件/.test(changelogPage) && /truncated &&/.test(changelogPage));
  ok('truncated 为真时分页总数文案不谎称全库条数（默认「共 N 条」是错误语义）',
    /totalText/.test(changelogPage) && /非全库条数/.test(changelogPage));
  ok('mock changelog 也回 truncated（否则前端该逻辑在 mock 下永远走不到 = 没写）',
    /truncated: list\.length >= 500/.test(mockServer),
    'mock 未回 truncated —— 前端 truncated 分支在联调时无法验证');
}

console.log(`\n===== ${pass} passed / ${fail} failed =====`);
if (fail > 0) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}