import path from 'path'
import { defineConfig } from '@tarojs/cli'

// 邻伴·陪聊员端小程序 Taro 编译配置
// - alias '@' -> src，页面/组件/服务统一走 '@/' 引入
// - sourceRoot/outputRoot 必填：Taro initPaths 直接 path.join(appPath, sourceRoot)，
//   缺失会在 CLI 初始化阶段抛 "path argument must be of type string"
// - presets 里挂 preset-shared-source：把 monorepo 内的 @linban/shared（TS 源码 +
//   workspace symlink）纳入小程序 script 编译链。**不要试图用本文件里的
//   compile.include / webpackChain / onWebpackChainChain 来做这件事**——Taro 的
//   Config.getConfigWithNamed 用白名单重建 config，这些键会被静默丢弃，
//   详细踩坑记录见 config/preset-shared-source.js 顶部注释。
export default defineConfig({
  projectName: 'linban-miniapp-companion',
  framework: 'react',
  sourceRoot: 'src',
  outputRoot: `dist/${process.env.TARO_ENV}`,
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  env: {
    NODE_ENV: '"development"',
  },
  defineConstants: {},
  alias: {
    '@': path.resolve(__dirname, '..', 'src'),
  },
  compiler: 'webpack5',
  // 用plugins（不是 presets）：Taro 的 Kernel 先跑 presets 再跑 plugins，
  // 而 ctx.modifyWebpackChain 这类钩子方法是在 CLI 的 build hook 里
  // ctx.registerMethod 注册的（@tarojs/cli/dist/presets/hooks/build.js），
  // 挂到 presets 上会早于注册时机，报 "modifyWebpackChain is not a function"。
  plugins: [path.resolve(__dirname, 'plugin-shared-source.js')],
  mini: {
    sourceMapType: 'eval',
  },
})