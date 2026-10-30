import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 陪聊员端 service 层冒烟测试配置。
//
// 为什么需要单独一份：apps/server 的 vitest.config.ts 把 @ 指向 server/src，
// 而这里的 @ 指向本 app 的 src（两边 tsconfig paths 同名，语义完全不同），
// 共用一个 config 会让 alias 指向错误的目录。
export default defineConfig({
  resolve: {
    alias: {
      '@linban/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts'],
    reporters: 'default',

    // ==========================================================================
    // 🔴 下面四项（fileParallelism / pool / singleFork / cacheDir）是**强制项**，
    //    删任何一项都会导致测试文件被**静默丢弃**，而报告仍然显示 passed。
    //
    // 为什么这比「测试失败」危险：失败会被人看见并去修，丢弃不会 ——
    // 它看起来就是「全绿」，于是被当作交付依据。
    // ==========================================================================
    //
    // ---------------------------------------------------------------------------
    // 根因：Windows 上对同一路径并发 open 会抛 EPERM（**与沙箱无关**）
    // ---------------------------------------------------------------------------
    // vitest 2.1 把每个模块的 SSR 转换产物写到
    //   join(os.tmpdir(), <nanoid>, 'ssr', <sha1(moduleId)>)
    // 见 node_modules/vitest/dist/chunks/resolveConfig.*.js:6628：
    //   const dir = join(project.tmpDir, transformMode)          // 'ssr'
    //   const tmp = join(dir, hash('sha1', id, 'hex'))
    //   if (promises.has(tmp)) { await promises.get(tmp); return { id: tmp } }
    //   if (!created.has(dir)) { await mkdir(dir, { recursive: true }); created.add(dir) }
    //   promises.set(tmp, writeFile(tmp, code, 'utf-8'))
    //
    // `has(tmp)` 检查与 `promises.set(tmp, ...)` 之间隔着一次 `await mkdir(...)`，
    // **两个并发请求能同时穿过检查**，随后对同一路径并发 writeFile。
    //
    // 裸 fs 验证（不经任何沙箱/代理，5/5 稳定复现）：
    //   Promise.all(Array.from({length:8}, () =>
    //     fs.promises.writeFile(samePath, 'x'.repeat(4078), 'utf-8')))
    //   → EPERM: operation not permitted, open '...\.conc-test.bin'
    // 即：**根因是 Windows 文件系统语义，不是权限、不是路径、也不是 broker 裁决**。
    // 沙箱只是把这个窗口放大/暴露出来。
    //
    // 症状极具迷惑性：
    //   Test Files  1 passed (1)      ← 只收集了一个文件
    //   Tests      13 passed (13)
    //   Errors      1 error            ← EPERM
    //   Error: EPERM: operation not permitted, open '...\ssr\<sha1>'
    // 第二个 test 文件**根本没被 collect**，在报告里连 failed 都不算。
    // 且失败写入的 sha1 **每次都是同一个模块**（两个文件共用的那个），
    // 挂掉的 test 文件却在两个之间轮换 —— 极易被误判成「代码有 bug」去乱改源码，
    // 实际是「工具没跑起来」。本项目已真实为此浪费过一轮排查。
    //
    // ---------------------------------------------------------------------------
    // 四项各自的作用（缺一不可）
    // ---------------------------------------------------------------------------
    //   pool: 'forks'          SSR 转换走子进程，绕开主进程的并发写窗口
    //   singleFork: true       单子进程，从根上不并发写 SSR 产物目录
    //   fileParallelism: false 文件间串行，消掉「同名缓存 check-then-set」竞态
    //   cacheDir               vite 自身缓存落项目内，不与系统 Temp 抢路径
    //
    // ⚠️ cacheDir 单独**治不了**本问题：
    //   cacheDir 管的是 vite 的依赖预构建缓存；
    //   写不进去的是 vitest 的 SSR 转换产物（落在 os.tmpdir()），**两者不是同一路径**。
    //   （曾试过只配 cacheDir —— 方向对但不足，问题照旧。）
    //
    // ⚠️ 换机器 / 换 CI 也必须保留这四项 —— **不是本机特有配置**。
    //    另有 apps/server/scripts/check-test-collection.ts 按「磁盘 vs 报告」对账
    //    （已把本包纳入扫描范围），因为「丢哪些文件」是不确定的
    //    （随机丢弃比固定丢弃更难防）。配置只能降低概率，对账才能发现它真的发生。
    //
    // ──────────────────────────────────────────────────────────────────────
    // ⛔ 为什么**不**配「改 TMPDIR 的启动包装器」—— 别再写一个了
    // ──────────────────────────────────────────────────────────────────────
    // 本机曾出现过「Windows 上 EPERM」的字样，很容易让人联想到
    // 「系统 Temp 目录没写权限 → 改 TMPDIR 指向项目内 → 好了」。
    // **这个方向是错的**，实测记录如下（避免下一个人重走一遍）：
    //
    //   实验①：在 vitest.config.ts 顶层改 process.env.TMPDIR/TMP/TEMP
    //          → os.tmpdir() 确实读到了新值（报错路径已变成项目内）
    //          → **EPERM 依旧**
    //   实验②：外部 env（TEMP=项目内目录）设好再跑
    //          → 能过，但那是**碰巧**（并发窗口没撞上），不是原理
    //   实验③：裸 fs 复现（不经沙箱、不经任何 shim）
    //          Promise.all(8 × fs.promises.writeFile(同一路径))
    //          → EPERM: operation not permitted, open '...\.conc-test.bin'
    //          → **5/5 稳定复现**
    //
    //   ⇒ 结论：根因是 **Windows 上对同一路径并发 open 会 EPERM**，
    //     与目录权限无关。改 TMPDIR 只是把落点挪走，**治不了并发**。
    //     真正的解法就是上面那四项（singleFork + fileParallelism:false 消并发）。
    //
    //   本项目已因此删掉过一版 `scripts/run-vitest.js` 包装器 ——
    //   留着它会让人以为「问题在临时目录」，而真因在并发。

    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    cacheDir: fileURLToPath(new URL('./node_modules/.vitest', import.meta.url)),
  },
})
