// ============================================================================
// Taro 插件：把monorepo 内的 @linban/shared 纳入小程序 script 编译链
// ----------------------------------------------------------------------------
// 背景（踩坑记录，勿删这段注释）：
//   @linban/shared 以 TS 源码形态被消费（package.json main -> src/index.ts），
//   且在 node_modules 里是 workspace symlink，webpack 解析出的真实路径在
//   <repo>/packages/shared/src。
//   Taro 4 的 script 规则 include 只有两项（见 @tarojs/webpack5-runner 的
//   MiniWebpackModule.getScriptRule）：
//     [sourceDir, filename => /(?<=node_modules[\\/]).*taro/.test(filename)]
//   shared 的真实路径既不在 sourceDir，也不匹配 taro 正则 → .ts 源码不经 babel
//   转译，webpack 直接报 ModuleParseError: Unexpected token（指向 `as const`）。
//
// 为什么不能写在 config/index.ts 里（这三个方案都已实测无效，勿再尝试）：
//   1. compile.include / compile.exclude
//   2. webpackChain / onWebpackChainReady
//   3. modifyWebpackChain
//   原因：Taro 的 @tarojs/service 在 Config.getConfigWithNamed 里用**白名单**
//   重建 config（node_modules/@tarojs/service/dist/Config.js）：
//     Object.assign({ entry, alias, copy, sourceRoot, outputRoot, platform,
//       framework, compiler, cache, logger, baseLevel, csso, sass, uglify,
//       plugins, projectName, env, defineConstants, designWidth, deviceRatio,
//       projectConfigName, jsMinimizer, cssMinimizer, terser, esbuild },
//       initialConfig[configName], initialConfig[platform])
//   上面 1/2/3 的键都不在白名单里，会被**静默丢弃**（没有任何报错）。
//   此外 modifyWebpackChain 还会被 CLI 自身的同名实现覆盖
//   （@tarojs/cli/dist/presets/commands/build.js 里 Object.assign 注入，
//   它把用户钩子替换成 ctx.applyPlugins(MODIFY_WEBPACK_CHAIN)）。
//   唯一稳定的通道是 preset/plugin 的 ctx.modifyWebpackChain，而
//   `presets` 恰好在白名单里（initialConfig.presets）。
//
// 影响面：只扩大本app 的 script 编译范围，不改 packages/shared 源码，
//         对 apps/server、apps/admin-web、apps/miniapp-user 零影响。
// ============================================================================

import path from 'path'

/** @linban/shared 的 TS 源码真实路径（本文件位于 <app>/config/，需上溯 3 级到 repo 根） */
const SHARED_SRC = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'src')

/** webpack-chain 里 script 规则.include 的最小结构（避免引 webpack-chain 类型依赖） */
interface ScriptChain {
  module: {
    rules: {
      get(name: string): { include: { add(item: string): unknown } } | undefined
    }
  }
}

/** Taro 注入的 preset 上下文（由 @tarojs/service 的 Plugin + Proxy 构造） */
interface PresetCtx {
  /** 注册 MODIFY_WEBPACK_CHAIN 钩子；钩体签名是 ({ chain }) => void */
  modifyWebpackChain?: (fn: (opts: { chain: ScriptChain }) => void) => void
}

export default function sharedSourcePreset(ctx: PresetCtx) {
  if (typeof ctx.modifyWebpackChain !== 'function') {
    throw new Error('[shared-source-plugin] 未拿到 ctx.modifyWebpackChain，无法扩展 script 编译范围')
  }
  ctx.modifyWebpackChain(({ chain }) => {
    const script = chain.module.rules.get('script')
    if (!script) return
    // include 是 webpack-chain 的 ChainedSet，add 后转成 webpack 的 include 条件数组
    script.include.add(SHARED_SRC)
  })
}