// ============================================================================
// risk.ts 契约冒烟测试
// ----------------------------------------------------------------------------
// 钉死两类 regression：
// 1. **枚举值**：`ReportType` 曾按 prisma schema 建模成 `OFFLINE_PRICE` /
//    `CONTACT_EXCHANGE`，而服务端 zod 是 `FLY_ORDER` / `OFF_PLATFORM_PAY`
//    （主理人裁定以 schema 为准，但服务端 zod 要改）——打错就是 zod 400，
//    举报功能完全不可用，且类型系统拦不住（两边都是 string字面量联合）。
// 2. **分页/裸数组兼容**：`GET /risk/complaints/mine` 服务端现状返回裸数组
//    `take:50`，裁定改为真分页信封。过渡期必须同时吃两种形态，
//    否则拿到 undefined 后 list.map 直接崩。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tarojs/taro', () => ({
  default: {
    request: vi.fn(),
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    getStorageInfoSync: vi.fn(() => ({ keys: [] })),
    showToast: vi.fn(),
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: { getState: () => ({ getToken: () => 'test-token' }) },
}))

const { postMock, getMock } = vi.hoisted(() => ({ postMock: vi.fn(), getMock: vi.fn() }))
vi.mock('@/services/request', () => ({
  http: { post: postMock, get: getMock, put: vi.fn() },
}))

import { fetchMyComplaints, submitComplaint, submitReport, validateDescription, LocalValidationError } from '@/services/risk'
import type { ReportType } from '@/services/risk'

const COMPLAINT_ROW = {
  complaintNo: 'CP20261021000456',
  type: 'SERVICE_QUALITY',
  priority: 'NORMAL',
  status: 'PENDING',
  resultNote: null,
  // 金额必须是字符串（BigInt 序列化）
  compensationAmountFen: '1500',
  createdAt: '2026-10-21T10:00:00.000Z',
  handledAt: null,
}

describe('举报类型枚举（打错即 400）', () => {
  beforeEach(() => postMock.mockReset())

  it('ReportType 必须接受服务端 zod 的三个取值，且不接受 schema 旧值', () => {
    // ── 这条断言为什么必须是「编译期」的，而不是运行时断言 ────────────────
    // 破坏法实测：把 ReportType 改回 schema 旧值
    //   'FLY_ORDER' | 'OFF_PLATFORM_PAY'  →  'OFFLINE_PRICE' | 'CONTACT_EXCHANGE'
    // 结论：
    //   vitest  → 28 passed（**全绿，无感**）—— 因为 vitest 只转译不类型检查，
    //              联合类型在运行时被完全抹除，任何「运行时断言枚举集合」的写法
    //              都抓不到（本地数组跟类型定义是两份互不约束的东西）。
    //   tsc     → 退出码 2，9 条 TS2322/TS2345 —— **抓到了**。
    // 所以这条防线**必须落在 tsc 上**，落地方式是 @ts-expect-error：
    // 一旦 ReportType 被改回旧值，下面三行会变成「多余指令」，
    // tsc 报 TS2578「Unused '@ts-expect-error' directive」→ 编译失败。
    //
    // ⚠️ 注意 @ts-expect-error 是**双向**的：类型被改对时它必须存在（否则报多余），
    //    被改错时它必须失效（否则报类型不匹配）—— 两个方向都会红。
    const probe = (v: ReportType): ReportType => v
    expect(probe('FLY_ORDER')).toBe('FLY_ORDER')
    expect(probe('OFF_PLATFORM_PAY')).toBe('OFF_PLATFORM_PAY')
    expect(probe('OTHER')).toBe('OTHER')

    // 服务端 zod 不接受 prisma schema 里的这两个旧值。
    //
    // ⚠️ @ts-expect-error 只压制**紧邻的下一行**的报错。所以必须把调用拆到
    //    独立的一行，不能写成 expect(() => probe('X')) 这种把调用塞在参数里的形式
    //    —— 那样 TS 的实参类型错误会报在 expect 的参数上，位置对不上，
    //    表现为「@ts-expect-error 变成多余指令」(TS2578)，而真正该报的
    //    TS2345 又被压在下一行，两头对不上号。
    //
    // 每个旧值单独占一行 + 各自的 @ts-expect-error：
    //   类型正确 → 该行报 TS2345 → 被精确压掉 → 编译通过
    //   类型被改错（ReportType 含旧值）→ 该行不报错 → @ts-expect-error 多余
    //                                    → TS2578 → 编译失败
    // @ts-expect-error ReportType 不应接受 OFFLINE_PRICE
    probe('OFFLINE_PRICE')
    // @ts-expect-error ReportType 不应接受 CONTACT_EXCHANGE
    probe('CONTACT_EXCHANGE')
  })

  it('提交 FLY_ORDER 必须原样透传（不能被换成 OFFLINE_PRICE）', async () => {
    postMock.mockResolvedValue({ reportNo: 'RP1', status: 'PENDING' })

    await submitReport('FLY_ORDER', { orderId: 'ord_1', description: '服务结束后要求私下转账结算后续费用' })

    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveProperty('type', 'FLY_ORDER')
  })

  it('提交 OFF_PLATFORM_PAY 必须原样透传（不能被换成 CONTACT_EXCHANGE）', async () => {
    postMock.mockResolvedValue({ reportNo: 'RP2', status: 'PENDING' })

    await submitReport('OFF_PLATFORM_PAY', { orderId: 'ord_1', description: '引导加微信绕过平台议价' })

    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveProperty('type', 'OFF_PLATFORM_PAY')
  })

  it('不得发送服务端未声明的 targetType/targetId/reporterRole', async () => {
    postMock.mockResolvedValue({ reportNo: 'RP3', status: 'PENDING' })

    await submitReport('OTHER', { orderId: 'ord_1', description: '其他飞单情况的具体说明内容' })

    const [, body] = postMock.mock.calls[0]
    // 服务端从 req.user.role 推 reporter_role、从 order.companion_id 推 target_id
    expect(body).not.toHaveProperty('targetType')
    expect(body).not.toHaveProperty('targetId')
    expect(body).not.toHaveProperty('reporterRole')
  })
})

describe('description 长度校验（服务端 zod .min(10).max(1000)）', () => {
  beforeEach(() => postMock.mockReset())

  it('少于 10 字应在端侧拦下，不发请求', async () => {
    await expect(
      submitReport('FLY_ORDER', { orderId: 'ord_1', description: '太短了' }),
    ).rejects.toBeInstanceOf(LocalValidationError)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('超 1000 字应在端侧拦下', async () => {
    await expect(
      submitComplaint('SERVICE_QUALITY', { orderId: 'ord_1', description: '长'.repeat(1001) }),
    ).rejects.toBeInstanceOf(LocalValidationError)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('合规长度才发请求，且已 trim', async () => {
    postMock.mockResolvedValue({ reportNo: 'RP4', status: 'PENDING' })

    await submitReport('FLY_ORDER', { orderId: 'ord_1', description: '  引导私下转账结算后续费用  ' })

    expect(postMock).toHaveBeenCalledTimes(1)
    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveProperty('description', '引导私下转账结算后续费用')
  })

  it('trim 后不足 10 字也要拦下（不能靠空格凑长度）', async () => {
    await expect(
      submitReport('FLY_ORDER', { orderId: 'ord_1', description: '      太短了     ' }),
    ).rejects.toBeInstanceOf(LocalValidationError)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('validateDescription 文案可直接展示给用户', () => {
    expect(validateDescription('短')).toContain('10')
    expect(validateDescription('长'.repeat(1001))).toContain('1000')
    expect(validateDescription('这是一段合规的求助描述内容')).toBeNull()
  })
})

describe('GET /risk/complaints/mine 分页/裸数组兼容', () => {
  beforeEach(() => getMock.mockReset())

  it('服务端已改分页信封时正常返回', async () => {
    getMock.mockResolvedValue({
      list: [COMPLAINT_ROW],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const res = await fetchMyComplaints()

    expect(res.list).toHaveLength(1)
    expect(res.total).toBe(1)
  })

  it('服务端仍是裸数组时包成第 1 页（联调期不能崩）', async () => {
    getMock.mockResolvedValue([COMPLAINT_ROW, COMPLAINT_ROW])

    const res = await fetchMyComplaints()

    expect(res.list).toHaveLength(2)
    expect(res.page).toBe(1)
    expect(res.total).toBe(2)
  })

  it('返回 undefined 等异常形态时降级为空列表而非崩', async () => {
    getMock.mockResolvedValue(undefined)

    const res = await fetchMyComplaints()

    expect(res.list).toEqual([])
  })

  it('金额字段保持字符串（不转 Number，防精度丢失）', async () => {
    getMock.mockResolvedValue([COMPLAINT_ROW])

    const res = await fetchMyComplaints()

    expect(typeof res.list[0].compensationAmountFen).toBe('string')
    expect(res.list[0].compensationAmountFen).toBe('1500')
  })

  it('分页参数带在 query 上', async () => {
    getMock.mockResolvedValue({ list: [], total: 0, page: 2, pageSize: 10 })

    await fetchMyComplaints(2, 10)

    const [url] = getMock.mock.calls[0]
    expect(url).toContain('page=2')
    expect(url).toContain('pageSize=10')
  })
})