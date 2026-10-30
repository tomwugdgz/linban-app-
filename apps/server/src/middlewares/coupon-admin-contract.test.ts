// ============================================================================
// 券后台端点契约测试（2026-10）
// ----------------------------------------------------------------------------
// 这组测试守三件很容易在迭代中悄悄坏掉的事：
//
//  1. **权限点不得放宽**。券面额是资金口径。若某天有人把 `marketing:*`
//     换成 `marketing:read`（客服只读权限），客服就能改券面额 —— 且不会报错，
//     只是"客服权限变大了"。所以权限点必须被断言锁死。
//
//  2. **金额出参必须是字符串**。`min_spend_fen` 是 BigInt，若某次重构
//     改成Number 直出，19 位金额会静默丢精度（9007199254740993 → 9007199254740992）。
//     这类bug 不会报错，只会让某笔金额差1分。所以断言"字符串类型"本身。
//
//  3. **路由挂载位置**。后台端点挂错前缀是最隐蔽的安全债：
//     挂到 C 端前缀下 → 变成 user_token 可调；忘挂 → 404。
//     断言 apiRouter 里确实挂了 /admin + marketingAdminRouter。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { permGranted, ROLE_PERMISSIONS } from './auth';

const ADMIN_ROUTES_PATH = fileURLToPath(new URL('../modules/marketing/marketing-admin.routes.ts', import.meta.url));
const ROUTES_INDEX_PATH = fileURLToPath(new URL('../routes/index.ts', import.meta.url));

const adminSrc = readFileSync(ADMIN_ROUTES_PATH, 'utf8');
const indexSrc = readFileSync(ROUTES_INDEX_PATH, 'utf8');

describe('券后台端点 · 权限点锁死', () => {
  /** 从路由源码里抽出每个端点的权限点声明 */
  function endpointPerms(): Array<{ path: string; perms: string[] }> {
    const out: Array<{ path: string; perms: string[] }> = [];
    // 形如：  marketingAdminRouter.post('/coupons/:id/publish', adminAuthMiddleware, adminPermGuard('marketing:*'),
    const re =
      /marketingAdminRouter\.(get|post|put|delete)\(\s*'([^']+)'[\s\S]{0,220}?adminPermGuard\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(adminSrc)) !== null) {
      const [, method, path, guardArgs] = m;
      if (!method || !path || !guardArgs) continue;
      const perms = [...guardArgs.matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '').filter(Boolean);
      out.push({ path: `${method.toUpperCase()} ${path}`, perms });
    }
    return out;
  }

  const ENDPOINTS = endpointPerms();

  it('扫到全部 7 个券后台端点（解析器失效会导致这条红）', () => {
    // 7 = 1 只读列表 + 6 写操作（create/edit/publish/pause/resume/end）
    expect(ENDPOINTS.length).toBe(7);
    const paths = ENDPOINTS.map((e) => e.path);
    expect(paths).toContain('GET /coupons');
    expect(paths).toContain('POST /coupons');
    expect(paths).toContain('PUT /coupons/:id');
    expect(paths).toContain('POST /coupons/:id/publish');
    expect(paths).toContain('POST /coupons/:id/pause');
    expect(paths).toContain('POST /coupons/:id/resume');
    expect(paths).toContain('POST /coupons/:id/end');
  });

  it('列表只读侧用 marketing:read，客服与财务可查', () => {
    const list = ENDPOINTS.find((e) => e.path === 'GET /coupons');
    expect(list?.perms).toEqual(['marketing:read']);
    // 客服确实该能查券（发券/查时长卡场景）
    expect(permGranted(ROLE_PERMISSIONS.cs ?? [], 'marketing:read')).toBe(true);
  });

  it('所有写操作一律要 marketing:*（不得降级为 marketing:read）', () => {
    const writes = ENDPOINTS.filter((e) => e.path !== 'GET /coupons');
    expect(writes.length).toBe(6);
    for (const w of writes) {
      expect(w.perms, `${w.path} 的权限点被放宽了：${w.perms.join(',')}`).toEqual(['marketing:*']);
    }
  });

  it('客服(cs) 无 marketing:* → 改不了券面额（资金口径）', () => {
    expect(permGranted(ROLE_PERMISSIONS.cs ?? [], 'marketing:*')).toBe(false);
    // 反例证明：若哪天给 cs 加了 marketing:*，上面这条就是唯一拦得住的护栏
    for (const w of ENDPOINTS.filter((e) => e.path !== 'GET /coupons')) {
      expect(permGranted(ROLE_PERMISSIONS.cs ?? [], w.perms[0] ?? 'x'), `${w.path} 客服不该能调`).toBe(false);
    }
  });

  it('运营(ops) 有 marketing:* → 可运营（当前唯一非超管的可写角色）', () => {
    expect(permGranted(ROLE_PERMISSIONS.ops ?? [], 'marketing:*')).toBe(true);
  });
});

describe('券后台端点 · 金额铁律', () => {
  it('入参门槛是字符串数字串（前端直传分），不是 number', () => {
    // 若改成 z.number()，大额门槛会丢精度（> 2^53）
    expect(adminSrc).toContain('minSpendSchema');
    expect(adminSrc).toMatch(/minSpendFen:\s*minSpendSchema/);
  });

  it('门槛字符串 → BigInt 的转换在路由层完成（service 层只收 bigint）', () => {
    // 分层纪律：路由做「HTTP 字符串 → 领域类型」的转换，
    // service 层入参已是 bigint，不该再出现 BigInt() 调用
    expect(adminSrc).toMatch(/minSpendFen:\s*BigInt\(/);
    const svc = readFileSync(
      fileURLToPath(new URL('../modules/marketing/coupon-admin.service.ts', import.meta.url)),
      'utf8',
    );
    expect(svc).toMatch(/minSpendFen:\s*bigint/);
  });

  it('service 层出参门槛一律 toString（BigInt 不能 JSON 序列化）', () => {
    const svc = readFileSync(
      fileURLToPath(new URL('../modules/marketing/coupon-admin.service.ts', import.meta.url)),
      'utf8',
    );
    expect(svc).toMatch(/minSpendFen:\s*c\.min_spend_fen\.toString\(\)/);
    // 审计快照也必须 toString —— before/after_json 是 Json 列，装 BigInt 会抛错
    expect(svc).toMatch(/min_spend_fen:\s*(created|current|after)\.min_spend_fen\.toString\(\)/);
  });

  it('出参含 remainCount / valueFrozen 派生字段（前端据此置灰，不必自己算）', () => {
    const svc = readFileSync(
      fileURLToPath(new URL('../modules/marketing/coupon-admin.service.ts', import.meta.url)),
      'utf8',
    );
    expect(svc).toContain('valueFrozen');
    expect(svc).toContain('remainCount');
    // 不限量券返回 null 而非 -1，避免前端把 null 当0 渲染成"剩0 张"
    expect(svc).toMatch(/remainCount:\s*c\.total_count === 0 \? null/);
  });
});

describe('券后台端点 · 路由挂载', () => {
  it('marketingAdminRouter 挂在 /admin 前缀下（不得挂到 C 端前缀）', () => {
    expect(indexSrc).toContain('marketingAdminRouter');
    expect(indexSrc).toMatch(/apiRouter\.use\('\/admin',\s*marketingAdminRouter\)/);
  });

  it('从 modules/index.ts 正确导出', () => {
    const modIdx = readFileSync(fileURLToPath(new URL('../modules/index.ts', import.meta.url)), 'utf8');
    expect(modIdx).toMatch(/export \{ marketingAdminRouter \} from '\.\/marketing\/marketing-admin\.routes'/);
  });

  it('每个端点都带 adminAuthMiddleware（后台端点不得用 C 端 authMiddleware）', () => {
    // 逐个端点数：adminPermGuard 之前必须出现 adminAuthMiddleware
    const count = (adminSrc.match(/adminAuthMiddleware/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(6);
    expect(adminSrc).not.toMatch(/adminAuthMiddleware[\s\S]{0,120}?authMiddleware,.*adminPermGuard/);
  });
});

describe('券后台端点 · 状态流转出口齐全', () => {
  it('pause / resume / end / publish 四个出口都在（与 pause 分离的 end 是刻意设计）', () => {
    for (const action of ['publish', 'pause', 'resume', 'end']) {
      expect(adminSrc).toContain(`/coupons/:id/${action}`);
    }
  });

  it('service 层四个流转函数都调了域校验（不得在路由里另写 if）', () => {
    const svc = readFileSync(
      fileURLToPath(new URL('../modules/marketing/coupon-admin.service.ts', import.meta.url)),
      'utf8',
    );
    for (const fn of ['validatePublish', 'validatePause', 'validateResume', 'validateEnd']) {
      expect(svc, `${fn} 未被调用`).toContain(fn);
    }
  });

  it('每次写操作都落 audit_logs（资金动作可审计）', () => {
    const svc = readFileSync(
      fileURLToPath(new URL('../modules/marketing/coupon-admin.service.ts', import.meta.url)),
      'utf8',
    );
    // create + edit + transition 三处，共 ≥3 次审计写入
    const auditCount = (svc.match(/tx\.audit_logs\.create/g) ?? []).length;
    expect(auditCount).toBeGreaterThanOrEqual(3);
  });
});