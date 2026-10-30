import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// 邻伴·用户端小程序 service 层测试配置。
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
    //
    // 根因：Windows 上对同一路径并发 open 会抛 EPERM（**与沙箱无关**）。
    // 裸 fs 复现（不经任何 shim，5/5 稳定复现）：
    //   Promise.all(Array.from({length:8}, () =>
    //     fs.promises.writeFile(samePath, 'x'.repeat(4078), 'utf-8')))
    //   → EPERM: operation not permitted, open '...\.conc-test.bin'
    //
    // vitest 2.1 的 check-then-set 竞态（node_modules/vitest/dist/chunks/resolveConfig.*.js:6628）：
    //   if (promises.has(tmp)) { ... return }
    //   if (!created.has(dir)) { await mkdir(dir, { recursive: true }); created.add(dir) }
    //   promises.set(tmp, writeFile(tmp, code, 'utf-8'))
    // `has(tmp)` 检查与 `promises.set(tmp, ...)` 之间隔着一次 `await mkdir(...)`，
    // 两个并发请求能同时穿过检查 → 对同一路径并发 writeFile → EPERM。
    //
    // 症状极具迷惑性：两个 test 文件里**随机挂掉一个**（另一个照常通过），
    // 且失败写入的 sha1 每次都是同一个模块（两个文件共用的那个），
    // 极易被误判成「代码有 bug」去乱改源码，实际是「工具没跑起来」。
    //
    // ⚠️ 别写「改 TMPDIR 的启动包装器」—— 那个方向是错的：
    //    在 config 里改 process.env.TMPDIR 后 os.tmpdir() 确实读到了新值，
    //    但 EPERM 依旧（实测）。改 TMPDIR 只是把落点挪走，治不了并发。
    //
    // ⚠️ 换机器 / 换 CI 也必须保留这四项 —— **不是本机特有配置**。
    //    另有 apps/server/scripts/check-test-collection.ts 按「磁盘 vs 报告」对账
    //    （已把本包纳入扫描范围），因为「丢哪些文件」是不确定的。
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    cacheDir: fileURLToPath(new URL('./node_modules/.vitest', import.meta.url)),
  },
})
