// ============================================================================
// 邻伴·用户端小程序 全局配置（app.config.ts）
// ----------------------------------------------------------------------------
// 分包策略（架构 §3.1：主包 < 1.8MB）：
//   - 主包：登录/首页/订单/个人中心等高频框架页；
//   - 分包 aiModule：AI 陪聊（首页进入即预加载）；
//   - 分包 chatModule：内置 IM（订单详情进入时预加载）。
// ============================================================================

export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/companion-list/index',
    'pages/companion-detail/index',
    'pages/booking/index',
    'pages/orders/index',
    'pages/order-detail/index',
    'pages/review/index',
    'pages/family/index',
    'pages/marketing/index',
    'pages/profile/index',
    'pages/settings/index',
  ],
  subpackages: [
    {
      root: 'subpackages/aiModule',
      name: 'aiModule',
      pages: ['pages/ai-chat/index'],
    },
    {
      root: 'subpackages/chatModule',
      name: 'chatModule',
      pages: ['pages/im/index'],
    },
  ],
  // 分包预下载：进首页预热 AI 分包（老人第一触点）；进订单详情预热 IM 分包
  preloadRule: {
    'pages/home/index': {
      network: 'all',
      packages: ['aiModule'],
    },
    'pages/order-detail/index': {
      network: 'all',
      packages: ['chatModule'],
    },
  },
  window: {
    navigationBarTitleText: '邻伴',
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
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/orders/index', text: '订单' },
      { pagePath: 'pages/family/index', text: '家人' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ],
  },
  permission: {
    'scope.userLocation': {
      desc: '用于推荐附近陪聊员与到岗核销定位',
    },
    'scope.record': {
      desc: '用于 AI 陪聊按住说话与语音留言',
    },
  },
  requiredPrivateInfos: ['getLocation', 'chooseAddress', 'chooseLocation'],
  lazyCodeLoading: 'requiredComponents',
  style: 'v2',
  sitemapLocation: 'sitemap.json',
})
