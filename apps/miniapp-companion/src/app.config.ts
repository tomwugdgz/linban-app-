// ============================================================================
// 邻伴·陪聊员端小程序 全局配置（app.config.ts）
// ----------------------------------------------------------------------------
// 分包策略（架构 §3.1：主包 < 1.8MB）：
//   - 主包：登录/工作台/接单大厅/订单/入驻/收入/我的等高频页；
//   - 分包 chatModule：内置 IM（订单详情进入时预加载）。
// ============================================================================

export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/hall/index',
    'pages/orders/index',
    'pages/order-detail/index',
    'pages/arrive/index',
    'pages/onboarding/index',
    'pages/schedule/index',
    'pages/income/index',
    'pages/credit/index',
    'pages/profile/index',
    'pages/settings/index',
  ],
  subpackages: [
    {
      root: 'subpackages/chatModule',
      name: 'chatModule',
      pages: ['pages/im/index'],
    },
  ],
  // 分包预下载：进订单详情预热 IM 分包
  preloadRule: {
    'pages/order-detail/index': {
      network: 'all',
      packages: ['chatModule'],
    },
  },
  window: {
    navigationBarTitleText: '邻伴·陪聊员',
    navigationBarBackgroundColor: '#FF7A45',
    navigationBarTextStyle: 'white',
    backgroundColor: '#FBF6F1',
    backgroundTextStyle: 'dark',
    enablePullDownRefresh: false,
  },
  tabBar: {
    color: '#8A7B6E',
    selectedColor: '#E55A1B',
    backgroundColor: '#FFFFFF',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '工作台' },
      { pagePath: 'pages/hall/index', text: '接单' },
      { pagePath: 'pages/orders/index', text: '订单' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ],
  },
  permission: {
    'scope.userLocation': {
      desc: '用于到岗核销定位与接单距离计算',
    },
    'scope.record': {
      desc: '用于语音消息与服务过程记录',
    },
    'scope.camera': {
      desc: '用于人脸核验与拍摄无犯罪记录材料',
    },
  },
  requiredPrivateInfos: ['getLocation', 'chooseLocation'],
  lazyCodeLoading: 'requiredComponents',
  style: 'v2',
  sitemapLocation: 'sitemap.json',
})
