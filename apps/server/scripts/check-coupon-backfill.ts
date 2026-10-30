// ============================================================================
// 上线阻塞校验：存量券面额快照必须回填完毕
// ----------------------------------------------------------------------------
// 用途：在**迁移之后、应用起流量之前**执行。不通过则不��上线。
//
// 为什么这是上线阻塞项（不是「建议」）：
//   `user_coupons.value_snapshot` 是「这张券的面额快照」。回填前它是 NULL，
//   核销逻辑会走「回退读券模板 value」的分支。
//
//   后果链：
//     回填前 → 运营改了 templates 表的 value → 存量券的抵扣额跟着变
//           → 用户手里 20 元券，某天核销变成 50 元券（或反过来）
//           → **直接资损，且用户投诉时无法自证**（券是"系统发的"）
//
//   所以回填必须在上线前跑完，且跑完必须验证为 0 残留。
//
// 判定口径：
//   SELECT COUNT(*) FROM user_coupons WHERE value_snapshot IS NULL;
//   必须为 0。
//
//   ⚠️ 不为 0 时**不要放宽 WHERE 条件**（比如把 NULL 也 UPDATE 成 0）：
//     填 0 会把「快照缺失」变成「面额为 0」——两种问题的处置方式完全不同，
//     填 0 后门禁会通过，但存量券依然按错误面额核销。这是资损掩盖，不是修复。
//     正确处置是人工核对脏数据。
//
// 本脚本是**只读校验**，不做任何 UPDATE。修复由迁移
//   20261022110000_user_coupons_value_snapshot_backfill
// 负责；本脚本只回答「回填完了没有」。
// ============================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 允许的残留行数：0。留常量是为了让"放宽"必须是显式改代码而不是改环境变量 */
const ALLOWED_REMAINING = 0;

/** 单批查询上限：避免一次性拉全表 */
const BATCH = 1000;

async function main(): Promise<void> {
  // 1) 总量
  const total = await prisma.user_coupons.count();
  console.log(`[backfill-check] 存量券总数: ${total}`);

  // 2) 残留数（value_snapshot IS NULL）
  const remaining = await prisma.user_coupons.count({
    where: { value_snapshot: null },
  });

  // 3) 券模板值为 NULL 的（防御性：coupons.value 理论上 NOT NULL）
  const orphanTemplate = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM \`user_coupons\` uc
    JOIN \`coupons\` c ON uc.\`coupon_id\` = c.\`id\`
    WHERE uc.\`value_snapshot\` IS NULL AND c.\`value\` IS NULL
  `;
  const orphanCount = Number(orphanTemplate[0]?.n ?? 0n);

  console.log(`[backfill-check] value_snapshot IS NULL 残留: ${remaining}`);
  console.log(`[backfill-check] 其中模板 value 亦为 NULL（脏数据）: ${orphanCount}`);

  if (remaining > ALLOWED_REMAINING) {
    console.error('');
    console.error('❌ [backfill-check] 存量券面额快照回填未完成，禁止上线。');
    console.error('');
    console.error('   处置步骤（不要放宽本脚本的 ALLOWED_REMAINING）：');
    console.error('   1. 确认回填迁移已执行：');
    console.error('        npx prisma migrate status');
    console.error('   2. 若状态为 applied 但仍有残留，说明存在模板 value 为 NULL 的脏数据：');
    console.error('        SELECT uc.id, uc.coupon_id, c.coupon_no, c.value');
    console.error('        FROM user_coupons uc JOIN coupons c ON uc.coupon_id = c.id');
    console.error('        WHERE uc.value_snapshot IS NULL;');
    console.error('   3. 人工核对后修正模板 value 或作废该券，**不要**把 NULL 刷成 0');
    console.error('      （填 0 = 门禁通过但券按 0 元抵扣，是资损掩盖）；');
    console.error('   4. 重跑本脚本确认残留为 0。');
    console.error('');
    process.exitCode = 1;
    return;
  }

  // 4) 抽样展示：确认真实面值（不是 0 批量刷出来的）
  const samples = await prisma.user_coupons.findMany({
    where: { value_snapshot: { not: null } },
    take: 5,
    orderBy: { id: 'asc' },
    select: { id: true, value_snapshot: true },
  });
  if (samples.length > 0) {
    console.log('[backfill-check] 抽样快照值:', samples.map((s) => s.value_snapshot).join(', '));
  }

  // 5) 零面额券不算错（面额 0 的券是合法的，如"无门槛抵扣"），
  //    但如果**全部**券的快照都是 0，说明回填写错了（模板 join 失效）
  const zeroCount = await prisma.user_coupons.count({
    where: { value_snapshot: 0 },
  });
  if (total > 0 && zeroCount === total) {
    console.error('');
    console.error('❌ [backfill-check] 全部存量券快照均为 0 —— 回填写错了，不是真的全是零面额券。');
    console.error('   典型原因：JOIN coupons 的条件写错，把 NULL 刷成了 0。');
    console.error('   处置：回滚回填迁移，改用 `WHERE c.value IS NOT NULL` 的版本重跑。');
    console.error('');
    process.exitCode = 1;
    return;
  }

  console.log(`[backfill-check] ✅ 通过：残留 ${remaining} 条（允许 ${ALLOWED_REMAINING}）`);
  console.log(`[backfill-check] 零面额券 ${zeroCount} 条 / 总数 ${total} 条（合法，零面额券是允许的业务态）`);
}

main()
  .catch((e) => {
    console.error('[backfill-check] 校验失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
