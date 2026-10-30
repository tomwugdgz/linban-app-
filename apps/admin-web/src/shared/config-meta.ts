// ============================================================================
// 系统配置元数据（配置可视化与变更历史共用）
// ----------------------------------------------------------------------------
// 【2026-10 起本文件不再维护任何字面量，全部 re-export @linban/shared】
//
// 此前是三处双写面：
//   服务端 admin.routes.ts 的 GROUP_KEYS（2 组 16 键，白名单）
//   本文件 CONFIG_GROUPS（6 组 28 键，展示分组）
//   → 前端下拉 6 个组、服务端 zod 只认 2 个中文名，运营点其余4 组直接 400；
//     且 report_reward 两边归属不同组（前端「风控与信用」/ 服务端「分账与资金」）。
//
// 现改为 shared 的 CONFIG_DOMAIN_GROUPS 单一权威（键集 === SYSTEM_CONFIG_DEFAULTS 28 键，
// 由 doc:check:configs 段 6 断言）。前端改展示顺序 = 改 shared 的键序，两端自动同步。
//
// **若你需要在本地写一份配置分组字面量，请先想清楚** —— 那正是这次 P0 的成因。
// ============================================================================

import {
  CONFIG_DOMAIN_GROUPS,
  CONFIG_LABELS,
  FEN_CONFIGS,
  BP_CONFIGS,
  configDomainGroupOf,
} from '@linban/shared';

/** 配置项分组（键序即展示顺序）。**唯一权威在 @linban/shared，此处仅做类型收敛。 */
export const CONFIG_GROUPS: Readonly<Record<string, readonly string[]>> = CONFIG_DOMAIN_GROUPS;

export { CONFIG_LABELS, FEN_CONFIGS, BP_CONFIGS };

/**
 * 配置项分组名（未归类时返回「其他配置」）。
 *
 * ⚠️ 注意与 shared 的 `configDomainGroupOf` 的区别（**有意不同，不要合并**）：
 *   - shared 版返回 `undefined`（显式缺失，用于门禁断言「必须已归组」）
 *   - 本版返回「其他配置」兜底（**仅用于 UI 渲染**，避免页面因一个未登记键而崩）
 *   兜底只影响展示、不影响门禁；服务端筛选不用本函数。
 */
export function configGroupOf(key: string): string {
  return configDomainGroupOf(key) ?? '其他配置';
}

/** 配置项中文名（未列出的键原样返回 key，不丢信息） */
export function configLabel(key: string): string {
  return CONFIG_LABELS[key] ?? key;
}