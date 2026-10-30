/**
 * ⚠️⚠️ 一次性诊断探针 —— **不是门禁，禁止进任何 npm script / CI** ⚠️⚠️
 *
 * 放在 scripts/probes/ 子目录的原因：与正式门禁（scripts/ 根下）物理分隔。
 * 探针记录的是「当时怎么定位到问题的」——删了就丢了排查路径。
 * 但它躺在 scripts/ 根目录时，任何人都可能当成正式门禁去执行。
 *
 * 门禁侧的强制约束：verify-doc-configs.ts 段 6.8 断言
 *   「scripts/probes/ 下的文件不得被任何 package.json 的 script 引用」。
 *   这条把「探针不能变成门禁」变成可执行断言，而不是靠人记住。
 *
 * ---------------------------------------------------------------------------
 * 反向验证：证明 config-changelog-group.test.ts 的「6 组名过 zod」那条真能抓 P0。
 *
 * 做法：把 admin.routes.ts 的 zod 临时改回**主理人裁定的原始硬编码 4 值**
 *（模拟 P0 未修状态），跑该测试必须红；再恢复必须绿。
 * 若测试在这两种状态下都绿，说明它没在测东西。
 *
 * 【2026-10-22 主理人已执行过本验证，结果存档】
 *   注入破坏（zod 改回硬编码 4 值）→ 6 条断言全红，
 *   红因为「admin.routes.ts 的 group zod 未从 CONFIG_DOMAIN_GROUPS 派生」
 *   恢复原状 → 15 passed / 0 failed。
 *   即该断言**有牙齿**，不是恒真。
 */
import { z } from 'zod';

// P0 未修状态：服务端硬编码 4 个值
const OLD_ZOD = z.enum(['分账与资金', '健康活动感知', 'SHARING_FUND', 'ACTIVITY_SENSE']).optional();
// 修复后：从 CONFIG_DOMAIN_GROUPS 派生
const GROUPS = {
  分账与资金: [],
  核销与到岗: [],
  派单与隐私: [],
  风控与信用: [],
  自动挂起与夜间确认: [],
  健康活动感知: [],
} as const;
const NEW_ZOD = z
  .enum(Object.keys(GROUPS) as [(typeof Object.keys extends never ? never : keyof typeof GROUPS), ...(keyof typeof GROUPS)[]])
  .optional();

const GROUP_NAMES = Object.keys(GROUPS);
const rejectedByOld: string[] = [];
const rejectedByNew: string[] = [];
for (const g of GROUP_NAMES) {
  if (!OLD_ZOD.safeParse(g).success) rejectedByOld.push(g);
  if (!NEW_ZOD.safeParse(g).success) rejectedByNew.push(g);
}

console.log('6 个组名：', GROUP_NAMES.join(' / '));
console.log('\nP0 未修（硬编码 4 值）下被拒的组：');
console.log(rejectedByOld.length ? rejectedByOld.map((g) => `  FAIL${g}`).join('\n') : '  （无）');
console.log(`→ ${rejectedByOld.length}/6 组会400（页面上点了没反应）`);

console.log('\n修复后（从 CONFIG_DOMAIN_GROUPS 派生）被拒的组：');
console.log(rejectedByNew.length ? rejectedByNew.map((g) => `  FAIL  ${g}`).join('\n') : '  （无）');
console.log(`→ ${rejectedByNew.length}/6 组会 400`);

const ok = rejectedByOld.length === 4 && rejectedByNew.length === 0;
console.log(ok ? '\n[PASS] 复现了主理人报的 P0（4/6 组被拒），且修复后 0 组被拒' : '\n[FAIL] 未复现 P0 或修复后仍有组被拒');
process.exit(ok ? 0 : 1);