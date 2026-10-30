// ============================================================================
// 路由路径对账门禁 —— 防「注释和契约都写对了，唯独运行时挂载少一层」
// ----------------------------------------------------------------------------
// 本测试的存在理由是一起**真实的、真机 404、且没有任何测试能抓到**的事故
// （2026-10-22，苏映棠核出；team-lead 记入契约 §5.4 缺口块）：
//
//   契约 §5.4 写`/admin/risk/events`
//   服务端源码注释写 `GET /admin/risk/events`（risk.routes.ts:274）
//   前端 API 层写 `/admin/risk/events`
//   ── 而运行时实际路径是 `/admin/events` ──
//
//   根因：`riskAdminRouter` 里注册的是**相对路径** `/events`，
//   而 `routes/index.ts:59` 只挂了一层 `apiRouter.use('/admin', riskAdminRouter)`。
//
//   为什么三处都对、错了却没人发现：
//   ① 注释与契约是「人类可读的意图」，路由挂载是「运行时的事实」。
//      两者不一致时，只读注释/契约**永远**发现不了。
//   ② 服务端没有任何集成测试调过这两个端点（当时零命中）。
//   ③ mock router 自己认旧路径，mock 模式下页面完全正常 —— 只有真机 404。
//
// ---------------------------------------------------------------------------
// 本测试的设计要点（都是踩过的坑）
// ---------------------------------------------------------------------------
// 1. **读运行时 `router.stack`，不解析源码文本**。
//    前几轮我们在「正则扒源码」上栽了 5 次：命中注释、命中函数体内部的 if、
//    嵌套交替匹配空串、锚点带冒号…… 每一 次都是「断言看着在跑，实际恒真」。
//    Express 的 `router.stack` 是**运行时事实**：注释写什么都不影响它。
//
// 2. 挂载前缀从 `routes/index.ts` 的 `apiRouter.use('<prefix>', XRouter)`
//    语句里读 —— 但只读**挂载语句**（稳定、正则可靠），
//    不用它读模块内的 `router.get('/xxx')`（那才是易碎的部分）。
//    模块内路径一律走 router.stack。
//
// 3. 契约路径从 `docs/API-CONTRACT.md` 的表格里抽`| GET | `/path` |` 行。
//    这是「契约驱动实现」的门禁形态：改任一端都会红。
//
// 4. ⚠️ 端点集合有**故意不实现**的（W7+ 启用、待排期端点等），
//    所以不能断言「契约里每一条都必须已注册」—— 那会让门禁恒红，
//    恒红的守卫比没有守卫更危险（训练人忽略红灯）。
//    故方向是：**凡已注册的后台路径，必须在契约里能查到**（防止实现跑偏），
//    加上**契约点名的关键路径必须真的注册**（防止漏实现）。
//    两个方向分别有独立断言，不混在一起 —— 混起来会出现「A 集合漏 B 集合」
//    时无法判断是哪边的问题。
// ============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { apiRouter } from '../routes/index';

const CONTRACT_PATH = fileURLToPath(new URL('../../../../docs/API-CONTRACT.md', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../routes/index.ts', import.meta.url));

// ---------------------------------------------------------------------------
// 1. 从运行时 router.stack 枚举真实注册的路径
// ---------------------------------------------------------------------------

/** Express 4 的 layer 里，路由层才有 layer.route；中间件层只有 handle */
interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

function pathsOf(router: unknown): Array<{ method: string; path: string }> {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (enabled) out.push({ method: method.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

/**
 * 挂载前缀表：`apiRouter.use('/admin', riskAdminRouter)` → { riskAdminRouter: '/admin' }
 *
 * ⚠️ 同一个 router 可能被挂在多个前缀下（当前不会，但形态上支持）。
 * 所以存数组而不是字符串。
 */
function mountPrefixes(): Map<string, string[]> {
  const src = readFileSync(INDEX_PATH, 'utf8');
  const map = new Map<string, string[]>();
  const re = /apiRouter\.use\(\s*'(\/[^']*)'\s*,\s*([A-Za-z0-9_]+Router)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // 正则有两个捕获组，TS 的 noUncheckedIndexedAccess 下仍是 string|undefined。
    // 这里显式收窄 —— 若真的 undefined 说明正则写坏了，宁可抛错也不要静默跳过。
    const pfx = m[1];
    const varName = m[2];
    if (pfx === undefined || varName === undefined) {
      throw new Error(`mountPrefixes 正则捕获组缺失，命中片段：${m[0]}`);
    }
    const list = map.get(varName) ?? [];
    list.push(pfx);
    map.set(varName, list);
  }
  return map;
}

/**
 * 枚举**全量已注册路径**（含挂载前缀）。
 * apiRouter 本身是顶层 Router，其 stack 里混着：
 *   - layer.route            → 自己直接挂的路由（当前为 0，全走子 router）
 *   - layer.handle 是 Router → 子router，其 path 是挂载前缀
 */
function allRegisteredPaths(): Array<{ method: string; path: string }> {
  const prefixes = mountPrefixes();
  const out: Array<{ method: string; path: string }> = [];
  const stack = (apiRouter as unknown as { stack: Array<RouteLayer & { handle?: unknown; name?: string }> }).stack ?? [];

  for (const layer of stack) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) out.push({ method: method.toUpperCase(), path: layer.route.path });
      }
      continue;
    }
    const handle = layer.handle as { stack?: RouteLayer[] } | undefined;
    if (!handle || !handle.stack) continue;

    // 找到这个子 router 的变量名 → 取它的挂载前缀
    const name = routerVarNames().find((n) => {
      try {
        return require_router(n) === handle;
      } catch {
        return false;
      }
    });
    if (!name) continue;
    const pfx = prefixes.get(name) ?? [];
    for (const p of pfx) {
      for (const r of pathsOf(handle)) {
        // express 的挂载前缀不含尾斜杠；子路由 path 以 / 开头
        out.push({ method: r.method, path: `${p}${r.path === '/' ? '' : r.path}` });
      }
    }
  }
  return out;
}

/** 从 routes/index.ts 的 import 语句里抽出全部 `xxxRouter` 变量名 */
function routerVarNames(): string[] {
  const src = readFileSync(INDEX_PATH, 'utf8');
  const names = new Set<string>();
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\.\/modules'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const namesRaw = m[1];
    if (namesRaw === undefined) {
      throw new Error(`routerVarNames 正则捕获组缺失，命中片段：${m[0].slice(0, 80)}`);
    }
    for (const raw of namesRaw.split(',')) {
      const t = raw.trim();
      if (/^[A-Za-z0-9_]+Router$/.test(t)) names.add(t);
    }
  }
  return [...names];
}

/**
 * 运行时拿到模块里的 router 对象。
 * 用动态 import 的静态字符串形式让 esbuild/tsx 能静态分析 —— 不用变量路径。
 */
function require_router(name: string): unknown {
  switch (name) {
    case 'activityAdminRouter': return activityAdminRouterRef;
    case 'activityRouter': return activityRouterRef;
    case 'adminRouter': return adminRouterRef;
    case 'companionAdminRouter': return companionAdminRouterRef;
    case 'companionRouter': return companionRouterRef;
    case 'fileAdminRouter': return fileAdminRouterRef;
    case 'fileRouter': return fileRouterRef;
    case 'insuranceAdminRouter': return insuranceAdminRouterRef;
    case 'insuranceRouter': return insuranceRouterRef;
    case 'marketingAdminRouter': return marketingAdminRouterRef;
    case 'marketingRouter': return marketingRouterRef;
    case 'notificationRouter': return notificationRouterRef;
    case 'paymentAdminRouter': return paymentAdminRouterRef;
    case 'paymentRouter': return paymentRouterRef;
    case 'riskAdminRouter': return riskAdminRouterRef;
    case 'riskRouter': return riskRouterRef;
    case 'supportAdminRouter': return supportAdminRouterRef;
    case 'supportRouter': return supportRouterRef;
    default: throw new Error(`未登记的 router：${name}`);
  }
}

import {
  activityAdminRouter as activityAdminRouterRef,
  activityRouter as activityRouterRef,
  adminRouter as adminRouterRef,
  companionAdminRouter as companionAdminRouterRef,
  companionRouter as companionRouterRef,
  fileAdminRouter as fileAdminRouterRef,
  fileRouter as fileRouterRef,
  insuranceAdminRouter as insuranceAdminRouterRef,
  insuranceRouter as insuranceRouterRef,
  marketingAdminRouter as marketingAdminRouterRef,
  marketingRouter as marketingRouterRef,
  notificationRouter as notificationRouterRef,
  paymentAdminRouter as paymentAdminRouterRef,
  paymentRouter as paymentRouterRef,
  riskAdminRouter as riskAdminRouterRef,
  riskRouter as riskRouterRef,
  supportAdminRouter as supportAdminRouterRef,
  supportRouter as supportRouterRef,
} from '../modules';

// ---------------------------------------------------------------------------
// 2. 从契约抽路径
// ---------------------------------------------------------------------------

/** 契约里的方法表行：`| GET | `/admin/xxx` | `perm:*` | 说明 |` */
function contractPaths(): Set<string> {
  const src = readFileSync(CONTRACT_PATH, 'utf8');
  const out = new Set<string>();
  const re = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const verb = m[1];
    const rawPath = m[2];
    if (verb === undefined || rawPath === undefined) {
      throw new Error(`contractPaths 正则捕获组缺失，命中行：${m[0].slice(0, 80)}`);
    }
    out.add(`${verb.toUpperCase()} ${normalisePath(rawPath)}`);
  }
  return out;
}

/** 契约里路径带 `:param`，Express 也是 `:param`；但有的写成 `{param}` */
function normalisePath(p: string): string {
  return p.replace(/\{(\w+)\}/g, ':$1').replace(/\/$/, '') || '/';
}

const REGISTERED = allRegisteredPaths();
const CONTRACT = contractPaths();

describe('路由路径对账：运行时注册 ≡ 契约登记', () => {
  it('0. 前置：枚举器本身有效（防空集合导致后续断言恒真）', () => {
    //⚠️ 这一条是整个测试的地基。若allRegisteredPaths() 返回空，
    //   下面「已注册路径都必须在契约里」会**恒真通过** —— 空集合是任何集合的子集。
    //   所以必须先证明枚举器真的抓到了东西。
    expect(REGISTERED.length).toBeGreaterThan(50);
    expect(CONTRACT.size).toBeGreaterThan(50);
    // 至少要能抓到不同 router 的路径（证明挂载前缀拼接生效，而不是全空）
    const prefixes = new Set(REGISTERED.map((r) => r.path.split('/')[1]));
    expect(prefixes.size).toBeGreaterThanOrEqual(8);
  });

  it('1. 契约点名的风控路径必须真的注册在运行时（本次修复的回归守卫）', () => {
    const paths = new Set(REGISTERED.map((r) => `${r.method} ${r.path}`));
    expect(paths.has('GET /admin/risk/events')).toBe(true);
    expect(paths.has('POST /admin/risk/events/:eventNo/handle')).toBe(true);
  });

  it('2. 举报处置路径必须仍是 /admin/reports/*（不许被顺手加上 /risk 层）', () => {
    const paths = new Set(REGISTERED.map((r) => `${r.method} ${r.path}`));
    expect(paths.has('POST /admin/reports/:reportNo/handle')).toBe(true);
    //反向：加了 /risk 层就错
    expect(paths.has('POST /admin/risk/reports/:reportNo/handle')).toBe(false);
  });

  it('3. 已注册的后台路径必须能在契约里查到（防实现跑偏到未登记路径）', () => {
    const orphans = REGISTERED
      .filter((r) => r.path.startsWith('/admin/'))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !CONTRACT.has(key));
    expect(
      orphans,
      `以下已注册路径在契约里查不到（契约 §5 未登记 = 前端无从对齐，必然真机 404）：\n${orphans.join('\n')}`,
    ).toEqual([]);
  });

  it('4. 已注册路径不得含空段（// 开头写法会静默变成别的路径）', () => {
    const bad = REGISTERED.filter((r) => r.path.includes('//') || r.path.length > 1 && r.path.endsWith('/'));
    expect(bad.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('5. 挂载前缀不得为空串或 / （否则契约里所有 /admin 路径都对不上）', () => {
    for (const [name, pfx] of mountPrefixes()) {
      for (const p of pfx) {
        expect(p.length, `${name} 挂在 "${p}"`).toBeGreaterThan(0);
        expect(p, `${name} 不应挂在根`).not.toBe('/');
      }
    }
  });
});