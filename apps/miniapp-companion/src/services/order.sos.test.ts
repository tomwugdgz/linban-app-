// ============================================================================
// SOS 请求契约冒烟测试（钉死一个已发生过的线上级 bug）
// ----------------------------------------------------------------------------
// **这个测试是为了防止一个具体 regression 再回来**，不是泛泛的覆盖率。
//
// 历史 bug：reportSos 曾在两个文件里各错一次 ——
//   1) 出站字段名写成 `reason`，服务端 zod 认的是 `description` → strip 后
//      陪聊员填的求助原因静默丢失，客服 URGENT 工单只能看到兜底文案「一键求助」；
//   2) 多传 `type: 'SOS'`，服务端 schema 未声明 → 同样被 strip；
//   3) 返回类型声明 `{ eventNo }` 且把 level 兜底成 'URGENT'，而真实是
//      `suspended: boolean` + `level: 'CRITICAL'` → 页面无法区分「已挂起」
//      和「仅求助已发出」。
// 这三类都是**编译能过、tsc 能过、只有真打服务端才炸**的错，靠类型系统拦不住，
// 所以用断言把出站请求体与入站读取一起钉死。
//
// 服务端真值（apps/server/src/modules/risk/risk.routes.ts）：
//   入参 zod : { orderId: 必填, lat?: number, lng?: number, description?: string(max 500) }
//   返回体   : { eventNo, level: 'CRITICAL', suspended: boolean, complaintNo }
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// request.ts 顶层会 import Taro 与 stores，node 环境下不存在 → 先 stub 掉
vi.mock('@tarojs/taro', () => ({
  default: {
    request: vi.fn(),
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getStorageInfoSync: vi.fn(() => ({ keys: [] })),
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: { getState: () => ({ getToken: () => 'test-token' }) },
}))

// 记录 http.post 实际收到的 url 与 data，供断言
// vi.mock 工厂会被提升到文件顶部，不能直接引用外层变量，
// 必须用 vi.hoisted 把 mock 函数一起提升，否则报
// "Cannot access 'postMock' before initialization"
const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('@/services/request', () => ({
  http: {
    post: postMock,
    get: vi.fn(),
    put: vi.fn(),
  },
}))

import { reportSos } from '@/services/order'

/** 服务端 risk.routes.ts 的返回体形态（照抄，只留端上读的四个字段） */
const SERVER_SOS_RESPONSE = {
  eventNo: 'RS20261021000123',
  level: 'CRITICAL',
  suspended: true,
  complaintNo: 'CP20261021000456',
}

describe('reportSos 请求契约（防 regression）', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('出站字段名必须是 description，不能是 reason（zod 会 strip 掉 reason）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_1', description: '老人突感不适，需要协助' })

    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveProperty('description', '老人突感不适，需要协助')
    // reason 若出现即为 regression
    expect(body).not.toHaveProperty('reason')
  })

  it('不得发送 type 字段（服务端 schema 未声明，会被 strip）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_1', description: '现场有异常' })

    const [, body] = postMock.mock.calls[0]
    expect(body).not.toHaveProperty('type')
  })

  it('打的是 /risk/sos 且带 orderId', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_42', description: '求助' })

    const [url] = postMock.mock.calls[0]
    expect(url).toBe('/risk/sos')
    expect(postMock.mock.calls[0][1]).toHaveProperty('orderId', 'ord_42')
  })

  it('description 超 500 字要端侧截断（服务端 z.string().max(500)）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_1', description: '长'.repeat(800) })

    const [, body] = postMock.mock.calls[0]
    expect((body.description as string).length).toBe(500)
  })

  it('可选 lat/lng 要能透传（风控事件 hit_detail 依赖它定位）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_1', lat: 23.13, lng: 113.26 })

    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveProperty('lat', 23.13)
    expect(body).toHaveProperty('lng', 113.26)
  })

  it('不传 description 时不塞该键（服务端兜底「一键求助」）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    await reportSos({ orderId: 'ord_1' })

    const [, body] = postMock.mock.calls[0]
    expect(body).not.toHaveProperty('description')
  })

  it('必须正确读出 suspended（页面靠它区分已挂起 / 仅求助发出）', async () => {
    postMock.mockResolvedValue({ ...SERVER_SOS_RESPONSE, suspended: true })

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.suspended).toBe(true)
  })

  it('suspended 为 false 时不能被当成 true', async () => {
    postMock.mockResolvedValue({ ...SERVER_SOS_RESPONSE, suspended: false })

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.suspended).toBe(false)
  })

  /**
   * 补这条的原因：破坏法验证时发现上一条断言有盲区。
   * 把实现改成 `suspended: res.suspended !== false`（等价于恒 true），
   * 「suspended: true 能正确读出」和「false 不能被当成 true」两条**都不红**
   * （前者输入恰为 true，后者只是 `undefined` 场景兜底撞上了）。
   * 真正被抓住的是「服务端缺字段时降级不崩」那条——
   * 说明只靠 `===true` / `toBe(false)` 不足以钉死"必须严格取服务端布尔值"。
   * 所以这里显式断言三种输入下的严格相等语义。
   */
  it('suspended 必须严格等于服务端布尔值（三种输入各验一次）', async () => {
    for (const input of [true, false] as const) {
      postMock.mockResolvedValue({ ...SERVER_SOS_RESPONSE, suspended: input })
      const res = await reportSos({ orderId: 'ord_1', description: '求助' })
      expect(res.suspended).toBe(input)
    }
    // 服务端未返回该字段 → 必须是 false，不能因为"非 false 即 true"而误报已挂起
    postMock.mockResolvedValue({ eventNo: 'E', level: 'CRITICAL', complaintNo: 'C' })
    const res = await reportSos({ orderId: 'ord_1', description: '求助' })
    expect(res.suspended).toBe(false)
  })

  it('level 必须是 CRITICAL，不能兜底成 URGENT', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.level).toBe('CRITICAL')
    expect(res.level).not.toBe('URGENT')
  })

  it('level 兜底分支也必须是 CRITICAL（服务端不返回 level 时）', async () => {
    // 上一条断言只覆盖「服务端返回了 level」的路径；
    // 若实现里的兜底值被改成 'URGENT'（res.level || 'URGENT'），
    // 只有服务端不返回 level 时才会暴露 —— 这条补的就是这个盲区。
    postMock.mockResolvedValue({ eventNo: 'E', suspended: true, complaintNo: 'C' })

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.level).toBe('CRITICAL')
    expect(res.level).not.toBe('URGENT')
  })

  it('level 兜底分支：服务端返回空字符串时同样兜底成 CRITICAL', async () => {
    postMock.mockResolvedValue({ eventNo: 'E', level: '', suspended: false, complaintNo: 'C' })

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.level).toBe('CRITICAL')
  })

  it('读出 complaintNo 与 eventNo（客服裁决凭据）', async () => {
    postMock.mockResolvedValue(SERVER_SOS_RESPONSE)

    const res = await reportSos({ orderId: 'ord_1', description: '求助' })

    expect(res.eventNo).toBe('RS20261021000123')
    expect(res.complaintNo).toBe('CP20261021000456')
  })

  it('服务端缺字段时降级不崩（不抛异常）', async () => {
    postMock.mockResolvedValue({})

    const res = await reportSos({ orderId: 'ord_1' })

    expect(res.eventNo).toBe('')
    expect(res.suspended).toBe(false)
  })
})