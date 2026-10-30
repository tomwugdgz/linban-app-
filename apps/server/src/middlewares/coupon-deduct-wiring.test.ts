// ============================================================================
// 券核销接线测试（service 层，2026-10）
// ----------------------------------------------------------------------------
// team-lead 验收明确要求三条，本文件逐条锁：
//
//   ① **快照优先**：有value_snapshot 时用快照，模板面额改动不影响存量券
//   ② **null 回退**：存量券（快照 NULL）能正常抵扣，且走 FALLBACK_TEMPLATE
//   ③ **回退打日志**：`event: 'coupon-value-snapshot-null'` 且带结构化字段
//
// 域函数口径在 `domain/coupon-deduct.test.ts`（22 条）。本文件守的是**接线**：
// 域函数对了但service 没调用它 / 调错了字段 / 忘了打日志，一样是资损。
//
// 为什么用源码静态断言而不用 mock DB：
//   Prisma client 在 vitest 里连真库才有意义，而我们无MySQL。
//   更重要的是：**接线错误是可以静态检出的**（忘了打日志、忘了带条件更新），
//   与其搭一套跑不起来的 mock，不如把可检的静态事实锁住。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SVC_PATH = fileURLToPath(new URL('../modules/order/order.service.ts', import.meta.url));
const src = readFileSync(SVC_PATH, 'utf8');

/** 抽 createOrder 里处理券的那一段（从 couponUserCouponId 分支到 calcOrderAmount） */
function couponWiringBlock(): string {
  const start = src.indexOf('if (input.couponUserCouponId) {');
  expect(start, '未找到券核销分支').toBeGreaterThanOrEqual(0);
  const end = src.indexOf('const giftDeduct', start);
  expect(end, '未找到 giftDeduct 边界').toBeGreaterThanOrEqual(0);
  return src.slice(start, end);
}

describe('① 快照优先', () => {
  it('查询时必须把 value_snapshot 一起取出来', () => {
    const block = couponWiringBlock();
    expect(block).toContain('include: { coupon:');
    expect(block, '查询未带 value_snapshot —— 快照优先无从谈起').toContain('value_snapshot');
  });

  it('把 value_snapshot 传进域函数（不是只查不用）', () => {
    const block = couponWiringBlock();
    expect(block).toMatch(/valueSnapshot:\s*uc\.value_snapshot/);
  });

  it('域函数被调用且用其返回值（不是调了但忽略结果）', () => {
    const block = couponWiringBlock();
    expect(block).toContain('const decided = calcCouponDeduct(');
    // 抵扣金额必须来自域函数返回值
    expect(block).toMatch(/couponDeductFen = decided\.deductFen/);
  });
});

describe('② null 回退', () => {
  it('回退判定走 needsBackfillLog（判据集中在一处，不散落）', () => {
    const block = couponWiringBlock();
    expect(block).toContain('needsBackfillLog(uc.value_snapshot)');
  });

  it('传 null 而不是传模板面额进域函数（回退逻辑在域函数里，不在 service）', () => {
    // 关键：service 只负责传原始快照值，回退由 domain/coupon-deduct 处理。
    // 若service 直接传 `uc.value_snapshot ?? uc.coupon.value`，
    // 域函数就永远收不到 null，回退分支与日志都成了死代码。
    const block = couponWiringBlock();
    expect(block).not.toMatch(/valueSnapshot:\s*uc\.value_snapshot\s*\?\?/);
  });

  it('抵扣金额不是占位 0n（旧实现 `BigInt(0)` 等于用户有券也扣不到钱）', () => {
    const block = couponWiringBlock();
    expect(block).not.toMatch(/const couponDeduct = input\.couponUserCouponId \? BigInt\(0\)/);
    // 默认值必须是 0n，且能被真实计算覆盖。
    // 注意这行在 `if (input.couponUserCouponId)` **之前**（默认值声明），
    // 故断言整段 createOrder 而非 couponWiringBlock。
    expect(src).toMatch(/let couponDeductFen = 0n/);
    // 且必须真的被赋值为域函数结果
    expect(block).toMatch(/couponDeductFen = decided\.deductFen/);
  });
});

describe('③ 回退打日志（回填完成度的唯一可观测手段）', () => {
  it('有结构化 warn 日志且带 event 标识', () => {
    const block = couponWiringBlock();
    expect(block).toMatch(/log\.warn\(/);
    expect(block).toContain("event: 'coupon-value-snapshot-null'");
  });

  it('日志带可grep 的结构化字段（userCouponId / couponId）', () => {
    const block = couponWiringBlock();
    // 只有这两个字段才能回答「哪些券还待回填」并按 couponId 聚合
    expect(block).toMatch(/userCouponId:\s*uc\.id\.toString\(\)/);
    expect(block).toMatch(/couponId:\s*uc\.coupon_id\.toString\(\)/);
  });

  it('日志不含面额值（快照缺失原因不需要泄漏金额进日志平台）', () => {
    const block = couponWiringBlock();
    const warnIdx = block.indexOf('log.warn(');
    const warnEnd = block.indexOf(');', warnIdx);
    const warnBlock = block.slice(warnIdx, warnEnd);
    expect(warnBlock).not.toMatch(/value:\s*uc\.coupon\.value/);
    expect(warnBlock).not.toMatch(/effectiveValue/);
  });
});

describe('防双花 · 券核销必须条件更新', () => {
  it('用 updateMany 带status: UNUSED 前置条件（不是无条件 update）', () => {
    // 无条件 update 的并发后果：两笔订单同时把同一张券置 USED，
    // 两单都抵扣了同一张券的钱 = 直接资损。
    expect(src).toMatch(/user_coupons\.updateMany\(/);
    expect(src).not.toMatch(/prisma\.user_coupons\.update\(\s*\{\s*where:\s*\{\s*id:/);
  });

  it("前置条件含 status: 'UNUSED' 与 user_id（防跨用户核销）", () => {
    expect(src).toMatch(/where:\s*\{\s*id: input\.couponUserCouponId,\s*user_id: input\.userId,\s*status: 'UNUSED'/);
  });

  it('count === 0 时抛错（不得静默放过）', () => {
    expect(src).toMatch(/claimed\.count === 0[\s\S]{0,120}throw new AppError/);
  });

  it('核销与订单创建在同一事务内（要么都成要么都滚）', () => {
    // 券已USED 但订单创建失败 = 用户券被吞且订单不存在
    const tStart = src.indexOf('withTransaction(async (tx) => {');
    const couponIdx = src.indexOf('user_coupons.updateMany(');
    expect(couponIdx).toBeGreaterThan(tStart);
  });
});

describe('券不可用时必须报出原因（不得静默忽略）', () => {
  it('不可用时抛 19205 而非静默按 0 抵扣', () => {
    expect(src).toMatch(/if\s*\(!decided\.usable\)[\s\S]{0,200}throw new AppError\(19205/);
  });

  it('拒绝文案按 reason 分档（不暴露内部术语）', () => {
    expect(src).toContain('function couponDeductRejectMessage');
    for (const reason of [
      'COUPON_EXPIRED',
      'COUPON_ZERO_VALUE',
      'COUPON_EXCEEDS_ORDER',
      'COUPON_TEMPLATE_ENDED',
    ]) {
      expect(src).toContain(`'${reason}'`);
    }
  });

  it('券不属于该用户时抛 19204（防横向越权核销他人券）', () => {
    const block = couponWiringBlock();
    expect(block).toMatch(/where: \{ id: input\.couponUserCouponId, user_id: input\.userId \}/);
    expect(block).toMatch(/if \(!uc\) throw new AppError\(19204/);
  });
});

describe('回填迁移 · 上线前检查清单已写进文件', () => {
  const MIGRATION = fileURLToPath(
    new URL(
      '../../prisma/migrations/20261022110000_user_coupons_value_snapshot_backfill/migration.sql',
      import.meta.url,
    ),
  );
  const sql = readFileSync(MIGRATION, 'utf8');

  it('用 JOIN UPDATE 而非逐条（量级大了会超时）', () => {
    expect(sql).toMatch(/UPDATE\s+`?user_coupons`?\s+uc\s+JOIN/i);
    expect(sql).not.toMatch(/WHERE id =/);
  });

  it('WHERE 带 value_snapshot IS NULL（幂等且只补缺口）', () => {
    expect(sql).toMatch(/WHERE uc\.`value_snapshot` IS NULL/);
  });

  it('上线后校验语句已写进注释（COUNT 应为 0）', () => {
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('value_snapshot IS NULL');
    expect(sql).toMatch(/必须为 0/);
  });

  it('迁移链里有「加列」与「回填」两个独立迁移（职责单一）', () => {
    // 加列与回填分两步：加列零破坏性可先行，回填需在数据量大时择机执行
    const add = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20261022100000_user_coupons_value_snapshot/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(add).toMatch(/ADD COLUMN `value_snapshot` INTEGER NULL/);
    // 加列迁移必须可空（存量行填不了）
    expect(add).toContain('NULL');
  });
});