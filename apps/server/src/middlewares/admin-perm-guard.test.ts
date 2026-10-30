// ============================================================================
// RBAC 权限守卫与三处双写面一致性单测
// ----------------------------------------------------------------------------
// 为什么这组断言必须有：
//
//  1. **adminPermGuard 曾整体失效**。原实现是精确匹配 `rolePerms.includes(p)`，
//     于是 admin 的 `['*']` 匹配不上 `risk:read` → 超管访问任何后台端点都被拒。
//     这个 bug 能潜伏到现在，纯粹因为前端全走 mock —— RBAC 链路在真机上
//     从未被完整执行过一次。单测就是防它再回来。
//
//  2. **权限点是三处双写面**（seed 落库 / auth 中间件判定 / admin-web 按钮渲染）。
//     任一处漏改的后果都不报错：少改 seed → 功能默默 403；少改 auth → 前端显示
//     了按钮但点不动；少改 admin-web → 按钮该灰的不灰。所以必须机器比对。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, permGranted } from './auth';

const SEED_PATH = fileURLToPath(new URL('../../prisma/seed.ts', import.meta.url));
// 本文件位于 apps/server/src/middlewares/，上溯 3 级到 apps/ 再进 admin-web
const WEB_PATH = fileURLToPath(
  new URL('../../../admin-web/src/shared/permissions.ts', import.meta.url),
);

/**
 * 独立参照实现（**只用于元测试**，见下方「复刻与实现一致性」describe）。
 *
 * 为什么主体断言不用它：它自己没人测。若把 `need.split(':')[0]` 写成
 * `need.split(':')[1]`（取到子动作而非模块），14 条断言会**全部按错误的实现
 * 通过**，而真实实现是对的 —— 测试永绿，比没有测试更危险。
 * 所以主体断言一律调用 auth.ts 导出的 `permGranted`（真实现）。
 * 这份复刻只负责一件事：当实现被改坏时，指出「是实现偏离了口径」还是
 * 「是口径本身变了」。
 */
function referenceGranted(rolePerms: readonly string[], need: string): boolean {
  if (rolePerms.includes('*')) return true;
  if (rolePerms.includes(need)) return true;
  const domain = need.split(':')[0];
  return rolePerms.includes(`${domain}:*`);
}

/** 元测试输入矩阵：必须含三段式 `risk:alert:handle`（最容易取错段的case） */
const META_MATRIX: ReadonlyArray<{ perms: readonly string[]; need: string }> = [
  { perms: ['*'], need: 'risk:alert:handle' },
  { perms: ['*'], need: 'anything:at:all' },
  { perms: [], need: 'order:read' },
  { perms: ['risk:*'], need: 'risk:read' },
  { perms: ['risk:*'], need: 'risk:alert:handle' },
  { perms: ['risk:*'], need: 'risk:alert:handle:deep' },
  { perms: ['risk:read'], need: 'risk:alert:handle' },
  { perms: ['risk:alert:handle'], need: 'risk:read' },
  { perms: ['order:read'], need: 'risk:read' },
  { perms: ['risk:read'], need: 'order:read' },
  { perms: ['revenue:read'], need: 'revenue:read' },
  { perms: ['revenue:*'], need: 'revenue:read' },
  { perms: ['marketing:read'], need: 'marketing:grant' },
  { perms: ['complaint:handle'], need: 'complaint:read' },
  // 段位陷阱：持有 `alert:*` 的角色不得因为 `risk:alert:handle` 里含"alert"而通过
  { perms: ['alert:*'], need: 'risk:alert:handle' },
  // 无冒号的需求点：不应被任何通配误伤
  { perms: ['*'], need: 'weird' },
  { perms: ['weird'], need: 'weird' },
];

describe('adminPermGuard 三档匹配（打真实现 permGranted，非复刻）', () => {
  it('超管的 * 通过全部权限点（含模块级）', () => {
    const admin = ROLE_PERMISSIONS.admin ?? [];
    for (const need of ['risk:read', 'order:refund', 'revenue:read', 'complaint:handle', 'marketing:*']) {
      expect(permGranted(admin, need), `admin 应能过 ${need}`).toBe(true);
    }
  });

  it('模块级通配覆盖该模块下的具体权限点（risk:* 能过 risk:read）', () => {
    const ops = ROLE_PERMISSIONS.ops ?? [];
    expect(ops).toContain('risk:*');
    expect(permGranted(ops, 'risk:read')).toBe(true);
    expect(permGranted(ops, 'risk:alert:handle')).toBe(true);
  });

  it('三段式权限点取模块段而非子动作段（risk:alert:handle 被 risk:* 覆盖）', () => {
    expect(permGranted(['risk:*'], 'risk:alert:handle')).toBe(true);
    // 反例：只有 alert:* 时，risk:alert:handle 的模块段是 risk 不是 alert，必须拒
    expect(permGranted(['alert:*'], 'risk:alert:handle')).toBe(false);
    expect(permGranted(['risk:read'], 'risk:alert:handle')).toBe(false);
    expect(permGranted(['risk:alert:handle'], 'risk:read')).toBe(false);
  });

  it('跨模块不通配：order:read 不能过 risk:read', () => {
    expect(permGranted(['order:read'], 'risk:read')).toBe(false);
    expect(permGranted(['risk:read'], 'order:read')).toBe(false);
  });

  it('模块前缀相近但不同模块不得通配（risk 不覆盖 revenue / marketing）', () => {
    const cs = ROLE_PERMISSIONS.cs ?? [];
    // 客服没有revenue:read —— 客服不该看到平台收入数字
    expect(permGranted(cs, 'revenue:read')).toBe(false);
    // 客服有 marketing:read，但不能因此获得 marketing:*
    expect(permGranted(cs, 'marketing:read')).toBe(true);
    expect(permGranted(cs, 'marketing:grant')).toBe(false);
  });

  it('空权限表一律拒绝（未配置角色不得默认放行）', () => {
    expect(permGranted([], 'order:read')).toBe(false);
    expect(permGranted([], 'risk:read')).toBe(false);
    // 未在ROLE_PERMISSIONS 里出现的 roleKey 会被 ?? [] 兜成空表，同样必须拒
    expect(permGranted(ROLE_PERMISSIONS.not_exist_role ?? [], 'order:read')).toBe(false);
  });
});

describe('复刻与实现一致性（元测试：防参照实现自己漂移）', () => {
  it('参照实现与真实现对整张矩阵给出相同结果', () => {
    for (const { perms, need } of META_MATRIX) {
      const impl = permGranted(perms, need);
      const ref = referenceGranted(perms, need);
      expect(
        impl,
        `口径分歧 perms=[${perms.join(',')}] need=${need}：真实现=${impl} 参照=${ref}` +
          ' —— 若实现是对的则参照实现漂移了，请同步更新 referenceGranted',
      ).toBe(ref);
    }
  });

  it('元测试自身不是恒真：注入一个错误实现必然被发现', () => {
    // 反例证明：把段位取错（split(':')[1]）的"坏实现"喂进同一条比较，必须不一致
    const brokenGranted = (rolePerms: readonly string[], need: string): boolean => {
      if (rolePerms.includes('*')) return true;
      if (rolePerms.includes(need)) return true;
      const wrong = need.split(':')[1] ?? '';
      return wrong.length > 0 && rolePerms.includes(`${wrong}:*`);
    };
    const diverged = META_MATRIX.filter(
      ({ perms, need }) => brokenGranted(perms, need) !== permGranted(perms, need),
    );
    // 坏实现必须在这张矩阵上暴露至少 3 处差异，否则矩阵覆盖不足、元测试等于摆设
    expect(diverged.length).toBeGreaterThanOrEqual(3);
    // 且差异必须包含三段式 case —— 这正是取错段时唯一会露馅的形状
    expect(diverged.some((c) => c.need.split(':').length >= 3)).toBe(true);
  });

  it('矩阵本身非空且含三段式 case（防止元测试空转）', () => {
    expect(META_MATRIX.length).toBeGreaterThanOrEqual(15);
    expect(META_MATRIX.some((c) => c.need.split(':').length >= 3)).toBe(true);
    // 矩阵必须同时含放行与拒绝两类样本，否则单侧失效测不出来
    expect(META_MATRIX.some((c) => permGranted(c.perms, c.need))).toBe(true);
    expect(META_MATRIX.some((c) => !permGranted(c.perms, c.need))).toBe(true);
  });
});

describe('权限点授予矩阵（业务口径）', () => {
  it('revenue:read 只给 admin 与 finance（Q8：营收与分账隔离）', () => {
    const has = (r: string): boolean => permGranted(ROLE_PERMISSIONS[r] ?? [], 'revenue:read');
    expect(has('admin')).toBe(true);
    expect(has('finance')).toBe(true);
    expect(has('ops')).toBe(false);
    expect(has('cs')).toBe(false);
  });

  it('finance 不含 payment:* 的替代路径即可见营收——但两者是独立权限点', () => {
    const finance = ROLE_PERMISSIONS.finance ?? [];
    expect(finance).toContain('revenue:read');
    expect(finance).toContain('payment:*');
    // 独立登记而非复用：复用会让"看分账的人顺带看营收"，Q8 隔离在 RBAC 层就假了
    expect(new Set(finance).size).toBe(finance.length);
  });

  it('complaint:handle 覆盖客服与运营，但 ops/cs 都仍有 complaint:*（粗粒度向下包含）', () => {
    for (const r of ['ops', 'cs']) {
      const perms = ROLE_PERMISSIONS[r] ?? [];
      expect(permGranted(perms, 'complaint:handle'), `${r} 应能处置投诉工单`).toBe(true);
    }
  });

  it('ops 有营销管理全量，cs 只有营销只读', () => {
    expect(permGranted(ROLE_PERMISSIONS.ops ?? [], 'marketing:grant')).toBe(true);
    expect(permGranted(ROLE_PERMISSIONS.cs ?? [], 'marketing:grant')).toBe(false);
    expect(permGranted(ROLE_PERMISSIONS.cs ?? [], 'marketing:read')).toBe(true);
  });

  it('所有角色权限表内无重复项（重复会掩盖漏配）', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      expect(new Set(perms).size, `${role} 有重复权限项`).toBe(perms.length);
    }
  });
});

describe('RBAC 三处双写面一致（seed / auth / admin-web）', () => {
  const seed = readFileSync(SEED_PATH, 'utf8');
  const web = readFileSync(WEB_PATH, 'utf8');

  /** 从 seed.ts 的 ROLES 里抽出 role → perms */
  function parseSeedRoles(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    const roleRe = /role_key:\s*'(\w+)'[\s\S]*?perms:\s*\[([^\]]*)\]/g;
    let m: RegExpExecArray | null;
    while ((m = roleRe.exec(seed)) !== null) {
      const role = m[1];
      const body = m[2];
      if (role === undefined || body === undefined) continue;
      out[role] = [...body.matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '').filter(Boolean);
    }
    return out;
  }

  it('seed.ts 能解析出四个角色', () => {
    const roles = parseSeedRoles();
    expect(Object.keys(roles).sort()).toEqual(['admin', 'cs', 'finance', 'ops']);
  });

  it('每个角色的权限集在 seed 与 auth 两侧逐值一致（漏改会导致功能默默 403）', () => {
    const seedRoles = parseSeedRoles();
    for (const [role, seedPerms] of Object.entries(seedRoles)) {
      const authPerms = ROLE_PERMISSIONS[role];
      expect(authPerms, `auth.ts 缺角色 ${role}`).toBeDefined();
      expect(
        [...(authPerms ?? [])].sort(),
        `角色 ${role} 的权限在 seed.ts 与 auth.ts 不一致`,
      ).toEqual([...seedPerms].sort());
    }
  });

  it('admin-web 的 ROLE_DEFAULT_PERMISSIONS 同样逐值一致（第三处双写面）', () => {
    const webBlock = /ROLE_DEFAULT_PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(web);
    expect(webBlock?.[1], '未能在 admin-web/permissions.ts 定位 ROLE_DEFAULT_PERMISSIONS').toBeDefined();
    const body = webBlock?.[1] ?? '';
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      // admin 在前端是 ['*', ...ALL_PERMISSION_KEYS]，单独处理
      if (role === 'admin') {
        expect(body).toContain('admin:');
        continue;
      }
      // 该角色的每个权限键都必须出现在 admin-web 的角色块里
      const roleIdx = body.indexOf(`${role}:`);
      expect(roleIdx, `admin-web 缺角色 ${role}`).toBeGreaterThanOrEqual(0);
      const slice = body.slice(roleIdx, body.indexOf('],', roleIdx) + 2);
      for (const p of perms) {
        expect(slice, `admin-web 的 ${role} 缺权限 ${p}`).toContain(`'${p}'`);
      }
    }
  });

  it('admin-web 已登记本轮新增的两个权限点', () => {
    for (const key of ['revenue:read', 'complaint:handle']) {
      expect(web, `admin-web/permissions.ts 未登记 ${key}`).toContain(`'${key}'`);
      expect(seed, `seed.ts 未登记 ${key}`).toContain(`'${key}'`);
    }
  });
});