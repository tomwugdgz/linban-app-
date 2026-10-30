// ============================================================================
// 邻伴 · 种子数据（DATABASE.md §8 + §8 说明）
// ----------------------------------------------------------------------------
// 内容：
//   1. system_configs 全量（与 packages/shared 的 SYSTEM_CONFIG_DEFAULTS
//      单一事实源同值，遍历 upsert，新增键自动落库；后台热更新过的行不被覆盖
//      ——update 留空）。含健康活动感知 11 项activity_* 键（架构 §13.11，
//      不建 activity_insight_configs 表）；
//   2. RBAC：权限点 16 个 + 四角色（admin/ops/finance/cs）+ 角色权限关联
//      （与 middlewares/auth.ts 的 ROLE_PERMISSIONS 静态映射保持一致；
//       动态角色进 roles 表后以 DB 为准，MVP 双写）；
//   3. 超级管理员账号（bcrypt；生产环境必须显式传 ADMIN_SEED_PASSWORD）；
//   4. 优惠券模板：COUPON_REPORT_REWARD（risk 模块举报奖励券引用同键，
//      两侧 upsert 同参数，seed 先建、运行期兜底互不冲突）。
//
// 幂等约定：全部 upsert，可重复执行；不动历史数据（配置/角色/权限/超管）。
// 执行：npm run prisma:seed（package.json 已配 tsx prisma/seed.ts）
// ============================================================================

import bcrypt from 'bcryptjs';
import { SYSTEM_CONFIG_DEFAULTS, REPORT_REWARD_FEN } from '@linban/shared';
import { prisma } from '../src/infra/prisma';
import { moduleLogger } from '../src/common/logger';

const log = moduleLogger('seed');

// ---------------------------------------------------------------------------
// RBAC 定义（perm_key 与 middlewares/auth.ts adminPermGuard 的使用面一一对应）
// ---------------------------------------------------------------------------

interface PermissionSeed {
  perm_key: string;
  module: string;
  name: string;
  description?: string;
}

const PERMISSIONS: PermissionSeed[] = [
  { perm_key: 'order:read', module: 'order', name: '订单查看', description: '订单列表/详情（只读）' },
  { perm_key: 'order:*', module: 'order', name: '订单管理', description: '订单派单/取消/裁决等全量操作' },
  { perm_key: 'companion:*', module: 'companion', name: '陪聊员管理', description: '入驻四审/信用分/保证金/状态' },
  { perm_key: 'verification:*', module: 'verification', name: '核销管理', description: '到岗核销记录查看与补录' },
  { perm_key: 'risk:*', module: 'risk', name: '风控处置', description: '风控事件队列与处置' },
  { perm_key: 'risk:read', module: 'risk', name: '风控查看', description: '风控事件只读' },
  { perm_key: 'report:*', module: 'report', name: '举报处理', description: '飞单举报核查与奖励发放' },
  { perm_key: 'complaint:*', module: 'complaint', name: '投诉处理', description: '投诉工单处理与补偿' },
  { perm_key: 'review:*', module: 'review', name: '评价管理', description: '评价审核/隐藏/置顶' },
  { perm_key: 'payment:*', module: 'payment', name: '支付分账管理', description: '分账冻结/手动结算/支付单查询' },
  { perm_key: 'withdrawal:*', module: 'withdrawal', name: '提现审核', description: '陪聊员提现申请审核' },
  { perm_key: 'recon:*', module: 'recon', name: '对账执行', description: '每日对账触发与批次查询' },
  { perm_key: 'commission:*', module: 'commission', name: '佣金结算', description: '分销佣金结算（月结）' },
  { perm_key: 'config:read', module: 'config', name: '配置查看', description: '系统配置读取与后台修改入口校验' },
  { perm_key: 'support:*', module: 'support', name: '客服工单', description: '回访任务/派单超时候补/订单裁决' },
  { perm_key: 'user:read', module: 'user', name: '用户查看', description: '用户资料只读（脱敏）' },
  // ---- 营销域后台侧（主理人裁定 2026-10：营销后台权限面原本完全空白）----
  // 缺口背景：后台 12 个营销端点（时长卡/团长/优惠券/老带新）此前无任何权限点，
  // 属权限面空白而非"未登记"。此处补 marketing:* 与 marketing:read 两档。
  { perm_key: 'marketing:read', module: 'marketing', name: '营销查看', description: '时长卡/团长/优惠券/老带新只读' },
  { perm_key: 'marketing:*', module: 'marketing', name: '营销管理', description: '券创建发放暂停恢复/时长卡发放/团长佣金结算/老带新规则' },
  // ---- 活动感知 + 营收隔离（主理人裁定 2026-10）----
  // revenue:read 的隔离理由（Q8）：订阅收入走独立科目、不进 profit_sharing_records，
  // 若复用 payment:* 或 config:read，营收与分账的隔离在 RBAC 层就是假的——
  // 能看分账的人顺手就能看营收，财务对账时分不开。
  { perm_key: 'revenue:read', module: 'revenue', name: '订阅营收查看', description: '感知订阅营收只读报表（独立科目，不进分账池）' },
  // complaint:handle 与 complaint:* 分开：*含补偿/裁决（动钱），handle 仅工单处置（不动钱）。
  // 客服能处置工单不等于能批补偿——权限粒度失真比缺权限更危险。
  { perm_key: 'complaint:handle', module: 'complaint', name: '投诉工单处置', description: '投诉工单受理与结论填写（不含补偿/赔付裁决）' },
];

interface RoleSeed {
  role_key: string;
  name: string;
  description: string;
  is_system: boolean;
  /** 授予的 perm_key；'*' 表示全部（仅 admin） */
  perms: string[];
}

const ROLES: RoleSeed[] = [
  {
    role_key: 'admin',
    name: '超级管理员',
    description: '平台超管：全部权限（代码层 "*" 通配；DB 侧显式全量关联，供后台角色管理展示）',
    is_system: true,
    perms: ['*'],
  },
  {
    role_key: 'ops',
    name: '运营',
    description: '订单/陪聊员/核销/风控/举报/投诉/评价运营工作台',
    is_system: true,
    perms: ['order:*', 'companion:*', 'verification:*', 'risk:*', 'risk:read', 'report:*', 'complaint:*', 'complaint:handle', 'review:*', 'marketing:*', 'marketing:read'],
  },
  {
    role_key: 'finance',
    name: '财务',
    description: '支付分账/提现/对账/佣金 + 配置查看 + 订阅营收查看',
    is_system: true,
    // revenue:read 给财务：订阅营收是财务科目（Q8），但**独立于分账**
    perms: ['payment:*', 'withdrawal:*', 'recon:*', 'commission:*', 'config:read', 'risk:read', 'marketing:read', 'revenue:read'],
  },
  {
    role_key: 'cs',
    name: '客服',
    description: '订单查看/投诉处理/客服工单/用户查看/风控查看',
    is_system: true,
    // cs 不给revenue:read：客服无营收查看职责，避免客服看到平台收入数字
    perms: ['order:read', 'complaint:*', 'complaint:handle', 'support:*', 'user:read', 'risk:read', 'marketing:read'],
  },
];

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function seedSystemConfigs(): Promise<number> {
  let count = 0;
  for (const [key, seed] of Object.entries(SYSTEM_CONFIG_DEFAULTS)) {
    await prisma.system_configs.upsert({
      where: { config_key: key },
      // create 落默认值；update 留空——后台热更新过的值不被 seed 覆盖
      create: {
        config_key: key,
        config_value: seed.value,
        value_type: seed.valueType,
        description: seed.description,
      },
      update: {},
    });
    count += 1;
  }
  return count;
}

async function seedRbac(): Promise<{ permissions: number; roles: number; links: number }> {
  // 1) 权限点
  for (const p of PERMISSIONS) {
    await prisma.permissions.upsert({
      where: { perm_key: p.perm_key },
      create: p,
      update: { module: p.module, name: p.name, description: p.description ?? null },
    });
  }
  const allPerms = await prisma.permissions.findMany();

  // 2) 角色 + 角色权限关联
  let linkCount = 0;
  for (const r of ROLES) {
    const role = await prisma.roles.upsert({
      where: { role_key: r.role_key },
      create: {
        role_key: r.role_key,
        name: r.name,
        description: r.description,
        is_system: r.is_system,
      },
      update: { name: r.name, description: r.description },
    });
    const permIds =
      r.perms[0] === '*'
        ? allPerms.map((p) => p.id) // admin：DB 侧显式全量
        : allPerms.filter((p) => r.perms.includes(p.perm_key)).map((p) => p.id);
    for (const permission_id of permIds) {
      await prisma.role_permissions.upsert({
        where: { role_id_permission_id: { role_id: role.id, permission_id } },
        create: { role_id: role.id, permission_id },
        update: {},
      });
      linkCount += 1;
    }
  }
  return { permissions: PERMISSIONS.length, roles: ROLES.length, links: linkCount };
}

async function seedSuperAdmin(): Promise<string> {
  const username = process.env.ADMIN_SEED_USERNAME ?? 'admin';
  const isProd = process.env.NODE_ENV === 'production';
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (isProd && !password) {
    throw new Error('生产环境种子必须显式设置 ADMIN_SEED_PASSWORD（禁止使用默认开发密码）');
  }
  const finalPassword = password ?? 'admin123';
  if (!password) {
    log.warn({ event: 'seed-default-admin-password' }, '未设置 ADMIN_SEED_PASSWORD，使用开发默认密码 admin123（仅限开发环境）');
  }
  const adminRole = await prisma.roles.findUniqueOrThrow({ where: { role_key: 'admin' } });
  const password_hash = await bcrypt.hash(finalPassword, 10);
  const admin = await prisma.admins.upsert({
    where: { username },
    create: {
      username,
      password_hash,
      real_name: '超级管理员',
      role_id: adminRole.id,
      status: 'ACTIVE',
    },
    // 已存在则不重置密码（避免重复执行覆盖运维改过的口令）
    update: {},
  });
  return admin.username;
}

async function seedCouponTemplates(): Promise<number> {
  // 举报奖励券（risk 模块兜底 upsert 同键同参；seed 先建）
  await prisma.coupons.upsert({
    where: { coupon_no: 'COUPON_REPORT_REWARD' },
    create: {
      coupon_no: 'COUPON_REPORT_REWARD',
      name: '飞单举报奖励券',
      type: 'FULL_REDUCTION',
      value: REPORT_REWARD_FEN,
      min_spend_fen: 0n,
      valid_days: 90,
      status: 'ACTIVE',
    },
    update: {},
  });
  return 1;
}

// ---------------------------------------------------------------------------
// 社区种子（7 条· 广州单城 MVP）
// ---------------------------------------------------------------------------

/**
 * 社区种子数据。
 *
 * 为什么必须是 `community_code` 而非自增 id（这是本轮主理人裁定的关键口径）：
 *  ① **绝不能用自增 id**：换库/重建数据 id 就变，运营的投放归因与去重口径会断。
 *  ② **绝不能用数组下标**：真接后端后社区表返回顺序由 SQL 决定（无 ORDER BY 时
 *     MySQL 不保证顺序），同一份代码在不同环境产出不同归因结果，**且这种不一致
 *     任何测试都发现不了 —— 因为每个环境里它都是自洽的**。
 *  `community_code` 是稳定业务主键，与前端 admin-web 的 funnelChannels 逐字对齐。
 *
 * 为什么 lng/lat 留空（不编造坐标）：
 *  schema 是 `Decimal?` 可空，运营还没填。**编出来的坐标比空值更危险** ——
 *  它会被派单「就近」算法当真，把订单派到错误的社区，且不报错。
 *  空值时就近算法应跳过该社区，这是比"假坐标静默错派"更可接受的状态。
 *
 * city 统一「广州市」（单城 MVP）。distributor_id 留空：一个团长可管多个小区，
 * 团长归属由运营在后台维护，seed 不预设。
 *
 * 幂等：按 community_code upsert（该列有@unique）。
 */
const COMMUNITY_SEED: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'GZ_TH_HUAYING', name: '天河区华颖社区' },
  { code: 'GZ_YX_BEIJINGJIE', name: '越秀区北京街' },
  { code: 'GZ_HZ_CHIGANGJIE', name: '海珠区赤岗街' },
  { code: 'GZ_LW_JINHUAJIE', name: '荔湾区金花街' },
  { code: 'GZ_BY_SANYUANLI', name: '白云区三元里' },
  { code: 'GZ_TH_SHIPAIJIE', name: '天河区石牌街' },
  { code: 'GZ_PY_SHIQIAOJIE', name: '番禺区市桥街' },
];

async function seedCommunities(): Promise<number> {
  for (const c of COMMUNITY_SEED) {
    await prisma.communities.upsert({
      where: { community_code: c.code },
      create: {
        community_code: c.code,
        community_name: c.name,
        city: '广州市',
        // lng/lat/distributor_id 刻意留空，见上方注释
      },
      // 名称以代码为准（代码是事实源）；city 可被运营改，不覆盖
      update: { community_name: c.name },
    });
  }
  return COMMUNITY_SEED.length;
}

async function main(): Promise<void> {
  log.info({ event: 'seed-start' }, '开始执行种子（幂等 upsert）');

  const configCount = await seedSystemConfigs();
  const rbac = await seedRbac();
  const adminUsername = await seedSuperAdmin();
  const couponCount = await seedCouponTemplates();
  const communityCount = await seedCommunities();

  log.info(
    {
      event: 'seed-done',
      systemConfigs: configCount,
      permissions: rbac.permissions,
      roles: rbac.roles,
      rolePermissions: rbac.links,
      superAdmin: adminUsername,
      couponTemplates: couponCount,
      communities: communityCount,
    },
    '种子执行完成',
  );
}

main()
  .catch((e) => {
    log.error({ event: 'seed-failed', err: (e as Error).message }, '种子执行失败');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
