// 全局常量：localStorage 键、mock 开关、时区约定
export const TOKEN_KEY = 'linban_admin_token';
export const ADMIN_INFO_KEY = 'linban_admin_info';

/** mock 适配层开关：默认开启（无后端环境可完整联调页面）；置 'false' 走真实 API 代理 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/** 服务端存储 UTC，展示统一东八区（schema 头部约定 3） */
export const DISPLAY_TZ_OFFSET_HOURS = 8;

/**
 * ⚠️ **本模块含 `import.meta.env`（USE_MOCK），只能在浏览器侧被引用。**
 *
 * Node 侧（`scripts/smoke.mjs` 经 esbuild 打出的 mock server）import 本文件会崩：
 * `TypeError: Cannot read properties of undefined (reading 'VITE_USE_MOCK')`。
 * 我踩过一次：为了放「营收明细上限」，把它加进本文件 → mock server 崩 → 全冒烟挂掉。
 *
 * **所以纯口径常量（服务端契约值、非环境相关）不要往这里加**，
 * 放 `@/shared/types`（纯类型 + 无env 依赖的常量）。
 * smoke.mjs 有断言守这条边界。
 */
