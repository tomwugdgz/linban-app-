// 编译期注入的环境变量类型声明
// Taro 通过 DefinePlugin 将 process.env.TARO_APP_* 替换为字面量，
// 这里仅服务于 TypeScript 类型检查（不引 @types/node，控制体积）。
declare const process: {
  env: {
    TARO_APP_NAME?: string
    TARO_APP_BASE_URL?: string
    TARO_APP_USE_MOCK?: string
    TARO_ENV?: string
    NODE_ENV?: string
  }
}
