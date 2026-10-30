// 邻伴·用户端小程序 Babel 配置
// Taro 4 + React + TypeScript，webpack5 编译（微信小程序）
module.exports = {
  presets: [
    ['taro', {
      framework: 'react',
      ts: true,
      compiler: 'webpack5',
    }],
  ],
}
