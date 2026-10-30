import path from 'path'
import { defineConfig } from '@tarojs/cli'

// 邻伴·用户端小程序 Taro 编译配置
// - alias '@' -> src，页面/组件/服务统一走 '@/' 引入，避免 ../../ 地狱
// - compiler: webpack5（Taro 4 默认），产物输出 dist/weapp
// - sourceRoot/outputRoot 必填：Taro initPaths 直接 path.join(appPath, sourceRoot)，
//   缺失会在 CLI 初始化阶段抛 "path argument must be of type string"
// - plugins 里挂 plugin-shared-source：把 monorepo 内的 @linban/shared（TS 源码 +
//   workspace symlink）纳入小程序 script 编译链。**不要试图用本文件里的
//   compile.include / webpackChain / onWebpackChainReady / modifyWebpackChain
//   来做这件事**——Taro 会用白名单重建 config 并覆盖同名钩子，这些键会静默失效，
//   详细踩坑记录见 config/plugin-shared-source.js 顶部注释。
export default defineConfig({
  projectName: 'linban-miniapp-user',
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
  plugins: [path.resolve(__dirname, 'plugin-shared-source.js')],
  mini: {
    sourceMapType: 'eval',
  },
})