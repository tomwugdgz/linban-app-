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
 * 探针：验证 collectSharedEnums 的收集条件对「对象套数组」形态
 * （如 CONFIG_GROUPS: Record<string, string[]>）是否安全。
 *
 * 复刻 enum-mirror.test.ts:66-78 的判定逻辑，逐形态实测，
 * 避免靠读代码推断（读代码可能漏掉边界，如 :70 的 Array.isArray 分支）。
 */
type Shape = { name: string; value: unknown };

const shapes: Shape[] = [
  { name: 'coupons（真枚举：值全为 string）', value: { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE' } },
  { name: 'COUPON_STATUS_VALUES（真数组）', value: ['DRAFT', 'ACTIVE'] },
  { name: 'CONFIG_GROUPS 形态（对象套 string[]）', value: { 分账与资金: ['commission_rate', 'deposit_amount'] } },
  { name: '空对象', value: {} },
  { name: '对象套数字', value: { A: 1, B: 2 } },
];

/** 复刻 enum-mirror.test.ts:66-78 */
function collectSharedEnums(sharedEnums: Record<string, unknown>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [key, value] of Object.entries(sharedEnums)) {
    if (key.endsWith('_values')) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length === 0 || !vals.every((v) => typeof v === 'string')) continue;
    result.set(key, vals as string[]);
  }
  return result;
}

const input: Record<string, unknown> = {};
for (const s of shapes) input[s.name] = s.value;
const collected = collectSharedEnums(input);

console.log('形态'.padEnd(40) + '是否被收集为枚举');
console.log('-'.repeat(60));
for (const s of shapes) {
  const got = collected.has(s.name);
  const expect = s.name.startsWith('coupons');
  const mark = got === expect ? '✅' : '⚠️ 与预期不符';
  console.log(s.name.padEnd(40) + (got ? '是' : '否') + '  ' + mark);
}
const cfg = collected.has('CONFIG_GROUPS 形态（对象套 string[]）');
console.log('\n结论：CONFIG_GROUPS 形态「' + (cfg ? '会被误收集 → 需登记 TS_ONLY_ALLOWLIST' : '不会被收集 → 安全，无需登记') + '」');
process.exit(cfg ? 1 : 0);