// ============================================================================
// 邻伴 · GET /admin/activity/revenue 接线契约测试（静态溯源式）
// ----------------------------------------------------------------------------
// 为什么用静态溯源而不是起服务打请求：
//   本项目无MySQL 实例（team-lead 已裁定 Docker 不可用），
//   起真服务的集成测试跑不起来；而「把断言写在测试里复刻一份」
//   是本项目已吃过亏的自欺做法（见 auth.ts 注释里 permGranted 那段）。
//   所以这里改成**读真源文件 + 断言其结构**：
//   文件被改坏 → 断言红；测试自己写错 → tsc 与review 能看出来。
//
// 与 domain/revenue.test.ts 的分工：
//   domain 那份锁「算得对不对」（纯函数，可注��反例）；
//   本份锁「接得对不对」（权限点、路径、科目隔离、窗口语义）。
//
// ⚠️ **B 档声明：断言的是源码文本匹配，不保证运行时行为**（2026-10 分诊落笔）
//   主理人裁定「不整份挪成运行时断言，按脆性分诊」后，本文件定级 **B 档**：
//   - **本文件只保证「源码里有这段文本」**，**不保证「运行时真的这样」**。
//     例：`not.toContain('risk:')` 证明「源码里没写 risk 权限点」，
//     但不证明「运行时 RBAC 判定确实拒了 risk 角色」—— 后者由
//     `admin-perm-guard.test.ts` 守。
//   - **为什么仍用源码断言**：部分契约**运行时拿不到** ——
//     路由出参结构是 handler 内拼装出来的，不是某个函数能返回的；
//     RBAC 三处双写面（seed / auth.ts / admin-web）也只存在于源码文本里。
//     硬改成运行时断言会把有效断言删掉换成跑不动的断言 —— **降低覆盖率比脆更糟**。
//   - **不覆盖什么**（明确声明，避免后来人误以为「查过了，没事」）：
//     ① 运行时实际行为（见上）
//     ② 被测代码改缩进/改命名风格导致假红 —— 已用**字面量断言**（非缩进量正则）规避
//     ③ 取不到路由块时的行为 —— **抛错而非降级**（见下方 routeBlock 注释）
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SERVER_ROOT, rel), 'utf8');

const routes = read('modules/activity/activity.routes.ts');
const svc = read('modules/activity/revenue.service.ts');
const domain = read('domain/revenue.ts');
const seed = read('../prisma/seed.ts');
const auth = read('middlewares/auth.ts');
const webPerms = read('../../admin-web/src/shared/permissions.ts');

/**
 * 剥掉块注释与行注释。
 *
 * **为什么每条「不得出现 X」类断言都必须先剥注释**：
 * 本文件写第一版时，service 的文件头注释里明明白白写着
 *「不进 orders / payments / profit_sharing_records / commissions」，
 * 结果「不得 import 分账表」这条断言被注释里的字样触发 ——
 * 一个专门防资损的守卫，因为注释提到了资损表名而恒红。
 * 恒红的守卫比没有守卫更危险：它训练人忽略红灯。
 * 同理，auth.ts 的 cs 角色注释「刻意不给 revenue:read」也会误触「cs 不得持有」断言。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 取某个路由注册语句的源码（从 `.get(`/`.post(` 到匹配的 `);\n` ）
 *
 * ⚠️ 2026-10 A 档修正（主理人「66 条按三档分诊」裁定 · 宋砚秋落笔）：
 *   **原实现找不到终点时退化成固定 400 字符截断**（`end < 0 ? idx + 400 : end`），
 *   且**不报错**。这个降级对**否定断言**是致命的：
 *   本文件 `:118` 的断言形如
 *     `expect(stripComments(routeBlock(routes, "'/activity/revenue'"))).not.toContain('risk:')`
 *   —— 若 routeBlock 取样不全（只截到 400 字符），`risk:` 恰好在被截掉的后面，
 *   断言就会**假通过**：门禁全绿，而被测代码其实写了 `risk:read`。
 *
 *   **「因为工具切歪了所以断言没生效」与「断言写错」一样危险**
 *   （`companion-income-contract.test.ts` 的同款函数早就是「找不到就 throw」，
 *   两份文件同批代码做法相反 —— 本条是那侧正确、这侧错误）。
 *
 *   改法：**找不到终点就抛错**，不降级。
 *   「找不到」是一个**需要人看的信息**（被测代码结构变了），
 *   不是可以静默兜底的正常路径。
 */
function routeBlock(src: string, path: string): string {
  const idx = src.indexOf(path);
  if (idx < 0) throw new Error(`路径未找到：${path}`);
  const start = src.lastIndexOf('.get(', idx) >= 0 ? src.lastIndexOf('.get(', idx) : idx - 120;
  const end = src.indexOf('\n);', idx);
  // 找不到终点 → 抛错，**不降级为固定长度截断**（降级会让否定断言假通过）
  if (end < 0) throw new Error(`未找到注册终点（\\n);）：${path}`);
  return src.slice(start, end);
}

/**
 * 取某个函数体的源码，支持三种形态：
 *   function f(a: T): R { ... }      —— 返回类型可能是内联对象字面量
 *   const f = (a: T) => { ... }
 *   obj.map((d) => ({ ... }))
 *
 * 前两版工具各踩一个坑，都记在这里免得重犯：
 *   ① 从 `function f` 找第一个 '{' → 命中**内联返回类型** `{ windowStart: Date; ... }`，
 *      扫出一个只有类型声明的空壳体；
 *   ② 用 `indexOf(') {')` 定位函数体 → 命中函数体**内部**第一个 if 的 `) {`。
 * 正确做法：用正则一次性吃掉签名（含可选返回类型），再从其末尾的 '{' 起深度扫描。
 */
function bodyOf(src: string, anchor: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`锚点未找到：${anchor}`);
  const afterAnchor = src.slice(start);
  const patterns = [
    // 返回类型若是内联对象字面量（`): { a: T } {`），必须整体吃掉再落真正的函数体 '{'。
    // 用 [^{}]* 而非 [\s\S]*?：后者会在内联类型的 '{' 处就收工，扫出空壳体。
    /^(?:async\s+)?function\s+[A-Za-z0-9_]*\s*\([^)]*\)\s*(?::\s*(?:\{[^{}]*\}|[^{}]+?)\s*)?\{/,
    /^\([^)]*\)\s*=>\s*\{/,
    /^\([^)]*\)\s*=>\s*\(\{/,
    /^[A-Za-z0-9_.]+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/,
    // 形如 `x.map((d) => ({ ... }))`：回调带括号包裹的返回对象。
    // 用 .*? 而非嵌套交替 `(?:[^)(]|\([^)(]*\))*`：后者内层 `[^)(]*` 可匹配空串，
    // 整组变成「可匹配但不前进」，实测对 `x.map((d) => ({` 恒不匹配。
    /^[A-Za-z0-9_.]+\(.*?\)\s*=>\s*\(\{/,
    // 锚点已含 `.map(`：只剩回调本身
    /^\(.*?\)\s*=>\s*\(\{/,
    /^[A-Za-z0-9_.]+\(.*?\)\s*\{/,
  ];
  for (const re of patterns) {
    const m = re.exec(afterAnchor);
    if (!m) continue;
    const open = start + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(open + 1, i);
      }
    }
    throw new Error(`括号未配平：${anchor}`);
  }
  throw new Error(`签名形态未识别：${anchor}`);
}

describe('§1 路径与权限点', () => {
  it('端点挂在 activityAdminRouter 且路径为 /activity/revenue', () => {
    expect(routes).toContain("'/activity/revenue'");
  });

  it('挂载前缀 /admin 由 routes/index.ts 提供（activityAdminRouter 挂在 /admin）', () => {
    expect(read('routes/index.ts')).toContain("apiRouter.use('/admin', activityAdminRouter)");
  });

  it('权限点是 revenue:read（契约 §13.6 硬要求，不复用分账权限）', () => {
    const block = routeBlock(routes, "'/activity/revenue'");
    expect(block).toContain("adminPermGuard('revenue:read')");
  });

  it('**不复用** payment:*/config:read/risk:* 作营收权限（复用会让隔离在RBAC 层是假的）', () => {
    const block = stripComments(routeBlock(routes, "'/activity/revenue'"));
    for (const forbidden of ['payment:', 'config:read', 'risk:']) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('必须挂 adminAuthMiddleware（后台端点不鉴权等于全站泄漏）', () => {
    expect(routeBlock(routes, "'/activity/revenue'")).toContain('adminAuthMiddleware');
  });

  it('revenue:read 在三处 RBAC 双写面里都存在（seed / auth / admin-web）', () => {
    expect(seed).toContain("'revenue:read'");
    expect(auth).toContain("'revenue:read'");
    expect(webPerms).toContain("'revenue:read'");
  });

  it('finance 角色持有 revenue:read，cs 角色刻意不持有（职责隔离）', () => {
    const clean = stripComments(auth); // cs 块注释里有「刻意不给 revenue:read」，不剥会误判
    expect(clean).toMatch(/finance:\s*\[[^\]]*'revenue:read'/);
    const csBlock = clean.slice(clean.indexOf('cs: ['));
    expect(csBlock.slice(0, csBlock.indexOf(']'))).not.toContain('revenue:read');
  });
});

describe('§2 账务隔离（Q8 / PRD §5）：订阅收入不进分账池', () => {
  it('service 层只 import activity_subscriptions 相关模型，不 import 任何分账表', () => {
    // 一次 import 就开一条资损通道：将来有人加一行 join 就是分账池被动过账。
    // 断言前必须剥注释——文件头那段隔离声明里就写着这些表名。
    const clean = stripComments(svc);
    for (const forbidden of [
      'profit_sharing_records',
      'commissions',
      'prisma.orders',
      'prisma.payments',
    ]) {
      expect(clean).not.toContain(forbidden);
    }
  });

  it('service 层显式读activity_subscriptions（真读，不是占位）', () => {
    expect(svc).toContain('prisma.activity_subscriptions.findMany');
  });

  it('出参带科目隔离声明（前端须原样展示）', () => {
    expect(svc).toContain('accountingNote');
    expect(svc).toContain('不进陪聊分账池');
  });

  it('domain 层同样不出现任何分账标识符', () => {
    const clean = stripComments(domain);
    for (const forbidden of ['payment', 'profit_sharing', 'commission']) {
      expect(clean).not.toContain(forbidden);
    }
  });
});

describe('§3 窗口语义（财务按月对账，不是「近 N 天」）', () => {
  const win = bodyOf(routes, 'function resolveWindow');

  it('默认取本自然月 [月初, 次月初)', () => {
    expect(win).toContain('getUTCMonth(), 1');
    expect(win).toContain('getUTCMonth() + 1, 1');
  });

  it('结束日期按「含当日」处理：终点 +1 天，否则漏掉当天订阅', () => {
    expect(win).toContain('86_400_000');
  });

  it('终点排他：注释明写闭开区间 [start, end)', () => {
    expect(routes).toContain('闭开区间 [start, end)');
  });

  it('取数 where 不卡 start_at >= 窗口起（跨界订阅必须计入）', () => {
    // 若where 卡 start_at，年费/长期订阅会被整批漏掉 → 老用户越多营收越低
    expect(svc).toContain('start_at: { lt: windowEnd }');
    expect(svc).toContain('end_at: { gt: windowStart }');
  });

  it('end <= windowStart 或 start >= windowEnd 的行被排除（无交集）', () => {
    expect(svc).toContain('end_at <= 窗口起 或 start_at >= 窗口止');
  });

  it('非法窗口（end <= start）抛 10001 而非静默返回空报表', () => {
    // 这里要的是整个路由注册块（bodyOf 不适用：handler 是 async 箭头，
    // 前面还挂着两个中间件），所以用 routeBlock
    const block = routeBlock(routes, "'/activity/revenue'");
    expect(block).toContain('10001');
    expect(block).toContain('windowEnd.getTime() <= windowStart.getTime()');
  });
});

describe('§4 金额出参纪律（BigInt → string，绝不经 Number）', () => {
  it('所有分金额出参都 toString 化', () => {
    for (const field of ['totalAmountFen', 'avgPriceFen', 'proratedFen', 'priceFen']) {
      expect(svc).toContain(`${field}: `);
    }
    expect(svc).toContain('.totalAmountFen.toString()');
  });

  it('客单价可为 null（无付费用户）而非 0——两种运营含义不同', () => {
    expect(svc).toContain('avgPriceFen === null ? null');
  });

  it('domain 层金额全程 bigint，不用 number 承载分值', () => {
    expect(domain).toContain('proratedFen: bigint');
    expect(domain).toContain('totalAmountFen: bigint');
  });
});

describe('§5 排障可解释性（报表数与在册数差额必须有说法）', () => {
  it('出参带 excludedReasons 排除原因分布', () => {
    expect(svc).toContain('excludedReasons');
  });

  it('出参带summary.excludedCount', () => {
    expect(svc).toContain('excludedCount');
  });

  it('明细行带 totalDays / overlapDays（财务能自己手算复核）', () => {
    expect(svc).toContain('totalDays: Number(d.totalDays)');
    expect(svc).toContain('overlapDays: Number(d.overlapDays)');
  });

  it('取数触顶 2 万行时打 warn 日志（不静默出残缺报表）', () => {
    expect(svc).toContain('revenue-row-cap-hit');
  });
});

describe('§6 明细单号不错位（资损方向的静默错误）', () => {
  it('domain 行结构携带 subscriptionNo（不靠 service 按下标配）', () => {
    expect(domain).toMatch(/interface RevenueSubscriptionRow[\s\S]*?subscriptionNo: string;/);
  });

  it('details 出参直接用 d.subscriptionNo，不使用 rows[i] 下标', () => {
    // 锚点只取调用表达式本身：写成 'details: detailSlice.map' 会带上冒号，
    // 标识符模式 [^A-Za-z0-9_.]+ 无法匹配，bodyOf 直接抛「签名形态未识别」。
    const block = bodyOf(svc, 'detailSlice.map');
    expect(block).toContain('d.subscriptionNo');
    expect(block).not.toContain('rows[');
  });
});

describe('§7 红线纪律：营收端点不得携带健康活动状态字段', () => {
  it('营收出参不含 status 五级活动状态（那是活动域的出参契约）', () => {
    // 这里的 status 指活动状态；本端点无任何活动状态字段
    expect(svc).not.toContain('ACTIVITY_DISCLAIMER');
    expect(svc).not.toContain('explainCode');
  });

  it('service 不 import 活动日报模块（营收不需要 disclaimer，但也不该顺手带上）', () => {
    expect(svc).not.toContain('report.service');
  });
});