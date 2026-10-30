// 打包 mock server + 枚举守卫入口，供 node 直跑冒烟。
// 关键：@linban/shared 是 workspace 里的 **.ts 源码包**，esbuild 默认按
// 「bare import」处理会保留成外部依赖，node 解析不了它内部无扩展名的 import。
// 这里显式把它列为入口，让 esbuild 把源码打进来。
import { build } from 'esbuild';
import { markRan } from './check-collection.mjs';
await build({
  // 两个入口（用对象形式显式指定产物名，避免 esbuild 按公共父目录推导
  // outbase 把 server.js 挪到 dist-smoke/src/api/mock/server.js）：
  //   server.ts     —— 端点 dispatch（原有）
  //   smoke-enums.ts —— 枚举门禁：共享包枚举值域 + mock 集合，供断言遍历
  entryPoints: {
    server: 'src/api/mock/server.ts',
    'smoke-enums': 'scripts/smoke-enums.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  // @linban/shared 走源码，其他依赖（dayjs 等）保持外部由 node 解析
  external: ['dayjs'],
  alias: { '@linban/shared': '../../packages/shared/src/index.ts' },
  outdir: 'dist-smoke',
  outExtension: { '.js': '.js' },
  logLevel: 'warning',
});

// 自证：只在**成功结束**时登记（构建失败会抛，上面这行不会执行 →
// 「脚本崩在中途」与「脚本没被执行」因此可以区分开）
markRan('scripts/esbuild-smoke.mjs');