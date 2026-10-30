import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// ============================================================================
// vitest 配置：domain 纯函数单测为核心；@linban/shared 走 alias 指向源码，
// 避免依赖构建产物，monorepo 未安装 workspace 链接时也可运行。
// ============================================================================
//
// 🔴 test 段的 `pool` / `fileParallelism` / `singleFork` / `cacheDir` 四项
// 是**收集完整性**配置，不是性能调优。删任何一项都会导致测试文件被静默丢弃，
// 而报告仍然显示 passed。
//
// 为什么这比测试失败危险：失败会被人看见并去修，丢弃不会 ——
// 它看起来就是「全绿」，于是被当作交付依据。
//
// ---------------------------------------------------------------------------
// 已实测确认的两种丢文件机制（**表象完全相同**：文件少了、报告说 passed）
// ---------------------------------------------------------------------------
//   机制① EPERM 写盘失败（沙箱 broker 裁决）
//     堆栈：node-brokered-fs-shim.cjs:701 wrappedWriteFile
//           → vitest resolveConfig:6629 join(project.tmpDir, 'ssr')
//           → cli-api:9883 tmpDir = join(os.tmpdir(), id)
//     症状堆栈原文：EPERM: operation not permitted, open '<os.tmpdir()>\ssr\<sha1>'
//     已排除的可能（都实测过）：
//       · 非文件系统权限 —— fs.writeFileSync 裸写 OK
//       · 非路径问题     —— TEMP/TMP/TMPDIR 指向项目内仍丢
//       · 非 broker hook 开关 —— CODEBUDDY_BROKERED_FS_HOOK_ENABLED=0 仍丢
//     解法：`pool: 'forks'` —— 让 SSR 转换走子进程，绕开主进程拦截路径。
//     实测：去掉 pool 后连跑 4 次 → 33/35/34/35（波动，且丢哪些不确定）。
//
//   机制② 同名缓存互相覆盖（文件并发执行）
//     两个 worker 同时写同一缓存条目，后写的覆盖先写的，
//     导致某个文件「看起来已被处理过」而被跳过。
//     与机制① 无关：EPERM 不发生时也会发生（普通多核机器同样可能）。
//     解法：`fileParallelism: false`（串行）→ 无并发写竞争。
//
//   **两个都要**：机制① 只在沙箱环境出现，机制② 在任何多核机器都可能出现。
//   只配 pool 治不了②，只配 fileParallelism 治不了①。
//
//   `singleFork` 是机制① 的第二层规避（单子进程连 SSR 产物目录都不并发）。
//   实测「仅 forks 不带 singleFork」仍有波动，叠加后连跑 4 次稳定全收集。
//
// ---------------------------------------------------------------------------
// 为什么 `cacheDir` 也要配（它不是解药，但避免目录打架）
// ---------------------------------------------------------------------------
//   `cacheDir` 管 vite 自身的依赖预构建缓存；
//   写不进去的是 vitest 的 SSR 转换产物（落在 os.tmpdir()），**两者不是同一路径**。
//   所以只配 cacheDir 治不了 EPERM（夏小笺踩过这个坑：方向对但不足）。
//   这里配它是为了让 vite 缓存落在项目内、不与 `.tmp/` 抢路径。
//
// ---------------------------------------------------------------------------
// 为什么「丢哪些不确定」比「固定丢某个」更危险
// ---------------------------------------------------------------------------
//   实测同一份代码连续跑，丢的文件不同：一次丢 coupon.test.ts，
//   另一次丢 3 个守门测试。随机丢弃让 CI 偶尔绿偶尔红，
//   久而久之没人相信这个门禁。
//   故除本配置外，还有 `scripts/check-test-collection.ts`
//   （`npm run test:collect`，已挂进 pretest）每次按「磁盘 vs 报告」对账 ——
//   **配置只能降低概率，对账才能发现它真的发生了。**
//
// ⚠️ 换机器 / 换 CI 也必须保留全部四项 —— 这不是本机特有配置。
// ============================================================================

export default defineConfig({
  resolve: {
    alias: {
      '@linban/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    reporters: ['default'],
    pool: 'forks',
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
  // ⚠️ `cacheDir` 是**顶层**配置项，与 `test` 平级 —— 放进 `test: {}` 里
  //   tsc 会报 TS2769（'cacheDir' does not exist in type 'InlineConfig'），
  //   且 vitest 会静默忽略它（unknown key 不报错）。
  //   即「写错了但看起来生效」—— 本项目第 N次「文本对 ≠ 运行对」。
  cacheDir: fileURLToPath(new URL('./node_modules/.vitest', import.meta.url)),
});