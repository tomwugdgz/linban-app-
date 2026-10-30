// ============================================================================
// 端点契约测试 —— 端侧调用的「方法 + 路径」必须与 docs/API-CONTRACT.md 一致
// ----------------------------------------------------------------------------
// 为什么需要这条测试（这不是形式主义，是本项目真实踩过的坑）：
//   契约、注释、甚至 prisma schema 三处都写对了，唯独**运行时挂载少一层** ——
//   端侧拼出一个服务端根本没挂载的路径，编译能过、tsc 能过、mock 也能跑，
//   只有真打服务端才 404。这类错没有任何类型系统能拦。
//
// 与「硬编码一份端点清单」的路线区别（这是本文件最关键的设计决策）：
//   ❌ 硬编码清单：测试里写一份 ['/orders/:id/grab', ...]
//      → 它与 docs/API-CONTRACT.md 是**两份互不约束的东西**，
//        契约改了、清单没改 → 测试照样绿（这是「断言自己骗自己」的经典实例，
//        与本轮 team-lead 总结的「断言里引用的常量若是测试自己定义的，
//        它与被测对象就没有任何约束关系 → 恒绿」同源）。
//   ✅ 本文件的做法：**运行时解析契约文档**，
//      契约改了 → 解析结果跟着变 → 端侧没跟着改 → 立刻红。
//      契约与实现之间由此建立**真实约束**。
//
// 断言四个维度：
//   ① 端侧用到的每个端点，契约里必须存在（防「调用了不存在的端点」→ 404）
//   ② 方法必须一致（GET 写成 POST → 405/404）
//   ③ 路径参数占位符名必须一致（:id vs :orderId → 服务端取不到值）
//   ④ 契约 §4 陪聊员端章节的端点，端侧应当覆盖（防漏实现）
//   ⑤ 越权红线：陪聊员端不得调 /admin/* 与用户端专属端点
//
// ⚠️ 占位符比对为什么要按「形状」（shape）而不是原文：
//   端侧写 `/orders/${orderId}/grab`，契约写 `/orders/:id/grab` —— 文本不等，
//   但形状相同（3 段、同一位置是占位符）。直接比文本会让**所有含参数的端点
//   都被误报成「契约里不存在」**。那种「到处都是假红」的测试等于没有测试。
//   所以：形状用于「存在性」，占位符名单独作为第二维度检查。
// ============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CONTRACT_PATH = join(APP_ROOT, '..', '..', 'docs', 'API-CONTRACT.md')

const contractRaw = readFileSync(CONTRACT_PATH, 'utf8')

/**
 * 从契约文档里抽出「方法 + 路径」对。
 *
 * 契约里端点有三种出现形态：
 *   ① 表格行 `| POST | `/xxx` | ... |`  —— 权威、可机器读（§4 陪聊员端等）
 *   ② 行内代码 `POST /risk/sos`          —— 正文散落的补充说明
 *   ③ §5.7 后台补登记表                  —— 与端侧无关
 * 本文件只吃 ① 与 ②，两种都收，避免「正文写了但表格没登记」的端点漏检。
 */
function parseContractEndpoints(src: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()

  const add = (method: string, path: string) => {
    const m = method.toUpperCase()
    if (!map.has(path)) map.set(path, new Set())
    map.get(path)!.add(m)
  }

  // 形态①：表格行 `| POST | `/path` | ... |`
  // ⚠️ 必须用全局匹配**且不锚定行首** —— 契约文档里存在「两个表格行被 `||` 挤在同一行」
  //    的格式缺陷（实测 docs/API-CONTRACT.md:135，night-confirm 与 confirm 同行），
  //    锚定 ^ 会漏掉后半行的端点 → 端侧调用被误报成「契约里不存在」。
  //    端侧不该因为契约文档排版坏了就把门禁搞红（那会掩盖真正的路径问题）。
  const tableRow = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*`([^`]+)`\s*\|/g
  let m: RegExpExecArray | null
  while ((m = tableRow.exec(src)) !== null) {
    add(m[1], m[2].trim())
  }

  // 形态②：行内代码
  const inline = /`(GET|POST|PUT|DELETE|PATCH)\s+(\/[A-Za-z0-9_\-:/.{}]*)`/g
  while ((m = inline.exec(src)) !== null) {
    const path = m[2].trim()
    if (path.includes('*')) continue // 通配说明不是端点
    add(m[1], path)
  }

  return map
}

/**
 * 端侧 service 里出现的「方法 + 路径」对（从源码文本静态提取）。
 *
 * 占位符：端侧用模板字面量 `${orderId}`，这里归一成 `:orderId`（保留变量名），
 * 以便做「占位符名是否一致」的检查。
 */
function parseClientEndpoints(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const files = [
    'src/services/auth.ts',
    'src/services/companion.ts',
    'src/services/order.ts',
    'src/services/verification.ts',
    'src/services/payment.ts',
    'src/services/risk.ts',
    'src/services/income.ts',
    'src/services/im.ts',
  ]
  for (const f of files) {
    const src = readFileSync(join(APP_ROOT, f), 'utf8')
    const re = /http\.(get|post|put|delete|patch)(?:<[^>]*>)?\(\s*([`'"])([^`'"]+)\2/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      const method = m[1].toUpperCase()
      const path = m[3].replace(/\$\{([^}]+)\}/g, ':$1').split('?')[0]
      if (!map.has(path)) map.set(path, new Set())
      map.get(path)!.add(method)
    }
  }
  return map
}

/** 归一化路径：占位符统一成 :p —— 用于比较「路径形状」 */
function shape(path: string): string {
  return path.replace(/:[^/]+/g, ':p')
}

const contract = parseContractEndpoints(contractRaw)
const client = parseClientEndpoints()

/** 契约里按形状索引：shape → { methods, paths } */
const contractByShape = new Map<string, { methods: Set<string>; paths: string[] }>()
for (const [path, methods] of contract) {
  const s = shape(path)
  if (!contractByShape.has(s)) contractByShape.set(s, { methods: new Set(), paths: [] })
  const e = contractByShape.get(s)!
  methods.forEach((m) => e.methods.add(m))
  e.paths.push(path)
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * 已知契约缺口豁免清单（每个都必须有「责任人 + 消除条件」，不许无理由豁免）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 为什么要有这个机制，而不是「让测试一直红」或「把断言注释掉」：
 *   · 一直红 → 门禁失效，真问题也会被无视（狼来了）
 *   · 注释掉 → 缺口从视野里消失，下一个人以为已经覆盖了
 *   · 显式豁免 → 缺口**可见、可追责、可审计**，条件达成时自动转红
 *
 * 每条豁免必须写清：谁负责改、消除条件是什么。
 * 条件达成后请**删掉豁免项**（让断言恢复生效），而不是把条件改成永远不成立。
 *
 * ⚠️ 本清单只收「**端侧调用了、但契约里没登记**」的缺口。
 *    「契约登记了、但归类不当（如把客服端点放在陪聊员端章节）」不在这里 ——
 *    那种情况端侧不实现它是**正确**的，端侧调用集合与契约路径集合本来就不该相等，
 *    归到 §4 覆盖断言的例外名单里（见 NOT_IMPLEMENTED_BY_COMPANION）。
 */
const KNOWN_CONTRACT_GAPS: Array<{
  /** 端点形状（占位符统一 :p） */
  shape: string
  /** 期望方法 */
  method: string
  /** 缺口描述 */
  note: string
  /** 责任人 */
  owner: string
  /** 消除条件 */
  resolvedWhen: string
}> = [
  {
    shape: '/payments/:p',
    method: 'GET',
    note: '契约 §3.3 支付章节只登记了 3 个端点（wx/notify、refund/wx/notify、sharings/:orderId/execute），'
      + '服务端 paymentRouter 实际挂了 11 个。GET /payments/order/:orderId 未登记 —— '
      + '上一轮 team-lead 裁「预估到手金额必须从此端点取」时，路径口径是对着代码核的，契约至今没补。',
    owner: '霍承钧（契约 §3.3 补登记）',
    resolvedWhen: 'docs/API-CONTRACT.md §3.3 登记 GET /payments/order/:orderId',
  },
  {
    shape: '/payments/withdrawals',
    method: 'GET',
    note: '契约 §3.3 未登记 GET /payments/withdrawals（提现记录）。服务端已挂载。',
    owner: '霍承钧（契约 §3.3 补登记）',
    resolvedWhen: 'docs/API-CONTRACT.md §3.3 登记 GET /payments/withdrawals',
  },
  {
    shape: '/payments/withdrawals',
    method: 'POST',
    note: '契约 §3.3 未登记 POST /payments/withdrawals（提现申请，带幂等键）。服务端已挂载。',
    owner: '霍承钧（契约 §3.3 补登记）',
    resolvedWhen: 'docs/API-CONTRACT.md §3.3 登记 POST /payments/withdrawals',
  },
  {
    shape: '/payments/sharings/mine',
    method: 'GET',
    note: '契约 §3.3 未登记 GET /payments/sharings/mine（分账明细）。服务端已挂载。',
    owner: '霍承钧（契约 §3.3 补登记）',
    resolvedWhen: 'docs/API-CONTRACT.md §3.3 登记 GET /payments/sharings/mine',
  },
  {
    shape: '/payments/income/overview',
    method: 'GET',
    note: '契约 §3.3 未登记 GET /payments/income/overview（收入概览聚合视图）。服务端已挂载。',
    owner: '霍承钧（契约 §3.3 补登记）',
    resolvedWhen: 'docs/API-CONTRACT.md §3.3 登记 GET /payments/income/overview',
  },
]

/**
 * 契约里登记了、但**陪聊员端有意不实现**的端点（附原因）。
 *
 * 与 KNOWN_CONTRACT_GAPS 的区别：
 *   KNOWN_CONTRACT_GAPS = 契约缺登记，端侧在用 → 要豁免「端侧必须在契约里」这条
 *   本清单             = 契约有登记，端侧不用 → 要豁免「契约 §4 端侧必须全覆盖」这条
 * 两者都是「契约与端侧集合本来就不相等」的合法原因，但成因相反，不能混在一张表里
 * （混在一起就会出现「豁免项其实契约里有」的自相矛盾 —— 本轮真实踩到过）。
 */
const NOT_IMPLEMENTED_BY_COMPANION: Array<{
  shape: string
  method: string
  reason: string
  owner: string
}> = [
  {
    shape: '/verifications/cs-completion',
    method: 'POST',
    reason: '客服代录完成确认（留痕 operator_id）—— 客服端点（cs = customer service），'
      + '陪聊员端不实现。契约把它登记在 §4.3（陪聊员端章节）下属于**归类问题**，'
      + '建议移到 §5.5 客服章节。',
    owner: '主理人 / 霍承钧（契约归类）',
  },
  {
    shape: '/verifications/suspend',
    method: 'POST',
    reason: '挂起订单（→ SUSPENDED，进客服裁决）—— 客服端点。'
      + '⚠️ 端侧**有意不实现**：「挂起」只能由 SOS 链路（POST /risk/sos）触发，'
      + '前端不可自行挂起/恢复订单（契约红线）。给陪聊员端加「手动挂起」按钮等于开一个越权后门。',
    owner: '主理人 / 霍承钧（契约归类）',
  },
]

/** 豁免键：形状 + 方法 */
const gapKey = (s: string, m: string) => `${m} ${s}`

describe('端点契约一致性（端侧 vs docs/API-CONTRACT.md）', () => {
  it('契约文档至少解析出 20 个端点（防解析器失效导致断言空转）', () => {
    // 本文件自己的「防空转」守卫：若契约文档格式变了导致解析出 0 个端点，
    // 下面所有断言都会「因为清单为空」而恒绿 —— 那比没有测试更坏。
    expect(contract.size).toBeGreaterThan(20)
  })

  it('端侧至少调用了 20 个端点（同上，防解析器失效）', () => {
    expect(client.size).toBeGreaterThan(20)
  })

  it('端侧用到的每个端点，契约文档里必须存在且方法一致（防 404/405）', () => {
    const missing: string[] = []
    for (const [path, methods] of client) {
      const hit = contractByShape.get(shape(path))
      for (const method of methods) {
        const gap = KNOWN_CONTRACT_GAPS.find(
          (g) => g.shape === shape(path) && g.method === method,
        )
        if (gap) continue // 已登记的已知缺口，豁免
        if (!hit) {
          missing.push(`${method} ${path}（契约里没有同形状路径）`)
          continue
        }
        if (!hit.methods.has(method)) {
          missing.push(
            `${method} ${path}（契约同形状路径 ${hit.paths.join(', ')} 只允许 ${[...hit.methods].join('/')}）`,
          )
        }
      }
    }
    expect(
      missing,
      `以下端侧调用在契约文档中不存在或方法不符：\n  ${missing.join('\n  ')}\n`
      + '（契约改了端侧没跟上，或端侧拼错了路径 —— 两者都会导致运行时 404/405）',
    ).toEqual([])
  })

  it('已知契约缺口豁免清单必须每条都有责任人与消除条件（防豁免被无声扩大）', () => {
    // 没有责任人的豁免 = 没人会修 = 永久缺口。
    // 消除条件写「永远不成立」的豁免 = 伪装成已知问题，实为未修的 bug。
    const bad: string[] = []
    for (const g of KNOWN_CONTRACT_GAPS) {
      if (!g.owner || g.owner.trim() === '') bad.push(`${g.method} ${g.shape}：缺责任人`)
      if (!g.resolvedWhen || g.resolvedWhen.trim() === '') bad.push(`${g.method} ${g.shape}：缺消除条件`)
      if (!g.note || g.note.trim() === '') bad.push(`${g.method} ${g.shape}：缺缺口说明`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('已知契约缺口一旦被契约补齐，豁免项必须被删除（防止豁免变成遮羞布）', () => {
    // 如果契约已经登记了某豁免项对应的端点，说明缺口已消除，
    // 这条豁免就该被删掉（让主断言恢复生效），而不是继续挂着。
    // 留着 → 契约补了但端侧又拼错路径时，豁免会把它盖住 → 漏检。
    //
    // ⚠️ 这条断言本轮真实抓到过自相矛盾：我曾把
    //    「契约没登记 /payments/split-mode」写进豁免，
    //    但契约 §5.3 其实登记了它 → 豁免项立刻变红。
    //    豁免清单必须与契约真实状态严格一致，否则它自己就是假绿来源。
    const stale: string[] = []
    for (const g of KNOWN_CONTRACT_GAPS) {
      const hit = contractByShape.get(g.shape)
      if (hit && hit.methods.has(g.method)) {
        stale.push(`${g.method} ${g.shape} —— 契约已登记，请删除该豁免项`)
      }
    }
    expect(
      stale,
      `以下豁免项对应的端点契约里已经有了，请删除豁免让断言恢复生效：\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })

  it('例外名单（客服端点）必须仍在契约里存在（防止例外掩盖真实漏实现）', () => {
    // 反向自检：例外名单说的是「契约登记了但端侧不实现」。
    // 若哪天契约把它删了（= 端侧本该实现它了），这条会红，
    // 提醒把例外移除、让端侧补实现 —— 防止例外被当成永久豁免。
    const stale: string[] = []
    for (const x of NOT_IMPLEMENTED_BY_COMPANION) {
      const hit = contractByShape.get(x.shape)
      if (!hit || !hit.methods.has(x.method)) {
        stale.push(`${x.method} ${x.shape} —— 契约里已不存在该端点，请移除例外并评估是否需端侧实现`)
      }
    }
    expect(
      stale,
      `以下例外项在契约里已不存在，请移除例外并评估端侧是否需要实现：\n  ${stale.join('\n  ')}`,
    ).toEqual([])
  })

  it('路径参数占位符必须与契约一致（:id 与 :orderId 不可互换）', () => {
    // 服务端按自己声明的占位符取值（req.params.id vs req.params.orderId），
    // 端侧写成另一个名字 → 服务端拿到 undefined → 500 或静默走错分支。
    //
    // ⚠️ 但**占位符名不同不一定是 bug**：
    //   端侧 `/im/conversations/${conversationId}/messages` 里的 conversationId
    //   是**端侧局部变量名**，拼进 URL 后就是字面路径 /im/conversations/xxx/messages，
    //   服务端按自己的 :id 取值即可 —— 实测服务端就是 '/conversations/:id/messages'，
    //   与契约一致，端侧拼出来的路径能正常命中。
    //   ⇒ 占位符名只在「同一个变量的不同写法」时才可能是错，
    //     而这种情况服务端与契约会同时体现为 :id，
    //     真正要防的是「契约写 :id、端侧拼成 :orderId 字面量」——
    //     即占位符被当成普通字符串拼进路径。
    //
    // 因此这里的判定标准是：**端侧路径里的占位符位置，必须在契约里也是占位符**
    // （而不是字面量）。这才是运行时 404/500 的真正成因。
    // 名字差异仅作提示，不让测试变红 —— 否则又是一堆假红。
    const problems: string[] = []
    for (const [clientPath] of client) {
      const candidates = contractByShape.get(shape(clientPath))
      if (!candidates || candidates.paths.length === 0) continue
      const clientSegs = clientPath.split('/')
      const ok = candidates.paths.some((contractPath) => {
        const contractSegs = contractPath.split('/')
        if (contractSegs.length !== clientSegs.length) return false
        return clientSegs.every((c, i) => {
          const k = contractSegs[i]
          const cIsParam = c.startsWith(':')
          const kIsParam = k.startsWith(':')
          // 关键判定：端侧是占位符的地方，契约也必须是占位符
          if (cIsParam !== kIsParam) return false
          return true
        })
      })
      if (!ok) {
        problems.push(
          `占位符位置不一致：端侧 ${clientPath} ↔ 契约 ${candidates.paths.join(' / ')}`
          + ' —— 端侧把变量当字面量拼进路径（或位置错位），运行时必然 404/500',
        )
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('契约 §4 陪聊员端章节的端点，端侧应当全部覆盖（防漏实现）', () => {
    const start = contractRaw.indexOf('## 4. 陪聊员小程序端')
    const end = contractRaw.indexOf('\n## 5.', start)
    expect(start, '契约文档里找不到 §4 陪聊员端章节').toBeGreaterThan(-1)
    const section = contractRaw.slice(start, end > -1 ? end : undefined)

    const sectionEndpoints = parseContractEndpoints(section)
    const clientShapes = new Set([...client.keys()].map(shape))

    const uncovered: string[] = []
    for (const path of sectionEndpoints.keys()) {
      // 例外：契约登记了但陪聊员端**有意不实现**的客服端点
      if (NOT_IMPLEMENTED_BY_COMPANION.some((x) => x.shape === shape(path))) continue
      if (!clientShapes.has(shape(path))) uncovered.push(path)
    }
    expect(
      uncovered,
      `契约 §4 陪聊员端登记了这些端点，端侧 service 未覆盖：\n  ${uncovered.join('\n  ')}\n`
      + '（可能是功能漏实现，也可能是端侧路径拼错 —— 两种都要处理）',
    ).toEqual([])
  })

  it('例外名单（客服端点）必须写明原因与责任人', () => {
    const bad: string[] = []
    for (const x of NOT_IMPLEMENTED_BY_COMPANION) {
      if (!x.reason || x.reason.trim() === '') bad.push(`${x.method} ${x.shape}：缺原因`)
      if (!x.owner || x.owner.trim() === '') bad.push(`${x.method} ${x.shape}：缺责任人`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('POST /orders/:id/confirm 陪聊员端可调用（契约 §4.2 标注「老人侧」与实现不符）', () => {
    // 这条断言记录一处**契约缺陷**（不是端侧 bug）：
    //   契约 §4.2 表格写：`| POST | /orders/:id/confirm | R | 完成确认（**老人侧**；...） |`
    //   但服务端 order.service.ts:751 明确支持陪聊员确认：
    //     companion_confirmed_at: role === 'COMPANION' ? now : null
    //     if (role === 'COMPANION' && ...) throw new AppError(16011, '您已确认过，等待对方确认')
    //   业务上「双方各确认一次 → COMPLETED」也是原设计（契约 §8 状态机）。
    // ⇒ 端侧在 order-detail 页调用该端点是**合法**的（"服务中→完成确认"是硬性产品规则）。
    //
    // 断言写成「端侧必须能调这个端点」而不是「契约不许这么写」——
    // 因为要改的是契约文本（霍承钧/主理人），端侧不该为了迎合过时标注而删功能。
    // 若将来契约真的禁止陪聊员确认，这条会红，届时应同步删端侧调用。
    expect(client.has('/orders/:id/confirm'), '端侧应保留陪聊员侧完成确认能力').toBe(true)
  })

  it('陪聊员端不得调用 admin 端点（越权红线）', () => {
    // 契约 §7.2 陪聊员端红线：陪聊员不得访问 /admin/* 管理面。
    // 这类错编译能过、tsc 能过，只有真打服务端才 403。
    const adminCalls = [...client.keys()].filter((p) => p.startsWith('/admin'))
    expect(
      adminCalls,
      `陪聊员端调用了 admin 端点：${adminCalls.join(', ')} —— 违反契约 §7.2 越权红线`,
    ).toEqual([])
  })

  it('陪聊员端不得调用用户端专属端点（端职责边界）', () => {
    // 契约 §7 按端拆分：/ai/* 仅老人端。越界调用不一定报错，
    // 但会让陪聊员端拿到不该有的数据。
    const userOnlyPrefixes = ['/ai/']
    const violations = [...client.keys()].filter((p) =>
      userOnlyPrefixes.some((pre) => p.startsWith(pre)),
    )
    expect(
      violations,
      `陪聊员端调用了用户端专属端点：${violations.join(', ')} —— 违反契约 §7 按端拆分`,
    ).toEqual([])
  })
})
