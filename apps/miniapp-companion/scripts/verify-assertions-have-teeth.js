#!/usr/bin/env node
/**
 * 断言牙齿自检（mutation testing）—— 验证「测试失败时真的有断言在咬人」
 *
 * ============================================================================
 * 为什么需要这个脚本（背景，别当装饰品删掉）
 * ============================================================================
 * 2026-10-22 这轮排查里，「25 passed」曾连续骗过我三次：
 *
 *   ① vitest 报 EPERM 时，第二个 test 文件**根本没被 collect**，
 *      报告却显示「Test Files 1 passed (1)」—— 看起来是绿的。
 *   ② `level` 兜底值从 CRITICAL 改成 URGENT，25 条断言**全绿**。
 *      因为原断言只测「服务端返回 level 时读出来对不对」，
 *      没测「服务端不返回 level 时兜底值对不对」—— 断言有盲区。
 *   ③ `ReportType` 从 FLY_ORDER 改成 schema 旧值，28 条断言**全绿**。
 *      因为联合类型在运行时被抹除，vitest 只转译不类型检查。
 *      （这条只有 tsc 能抓，实测 tsc 退出码 2、9 条错误。）
 *
 * 也就是说：**「测试通过」不能证明「测试有牙齿」**。
 * 唯一能证明的办法就是破坏实现、看断言是否变红、然后改回来。
 * 这个脚本把这件事自动化，免得下一个人再花一小时手工试。
 *
 * ============================================================================
 * 用法
 * ============================================================================
 *   node scripts/verify-assertions-have-teeth.js
 *
 * 退出码：0 = 全部破坏都被断言抓到（断言有牙齿）；1 = 有破坏未被抓到（断言是哑弹）
 *
 * ============================================================================
 * 破坏手法：只改「端侧实现」，不改「测试文件」——
 * 因为如果连测试一起改，那验证的就不是「测试能不能抓住 bug」了。
 * ============================================================================
 */
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const APP_ROOT = path.resolve(__dirname, '..')

/** 读取文件内容 */
function read(rel) {
  return fs.readFileSync(path.join(APP_ROOT, rel), 'utf8')
}

/** 写回文件内容 */
function write(rel, content) {
  fs.writeFileSync(path.join(APP_ROOT, rel), content, 'utf8')
}

/** 文件内容指纹，用于证明「已完整恢复」 */
function fingerprint(rel) {
  return crypto.createHash('md5').update(read(rel)).digest('hex')
}

/**
 * 跑一次测试，返回 { exitCode, passed, failed }
 *
 * ⚠️ 不用 stdout 正则解析计数 —— vitest 的输出带 ANSI 颜色转义码
 *    （实测 `Tests  \x1b[31m2 failed\x1b[39m | \x1b[32m26 passed\x1b[39m`），
 *    正则很容易匹配不到，然后得出「0 条变红」的**假结论**，
 *    看起来像「断言没牙齿」，实际是「工具没跑起来」——
 *    这正是本脚本要避免的那类自欺。
 *    改用 --reporter=json 读结构化字段（numFailedTests / numPassedTests）。
 */
function runTests() {
  const reportDir = path.join(APP_ROOT, '.tmp')
  fs.mkdirSync(reportDir, { recursive: true })
  const outFile = path.join(reportDir, 'teeth-report.json')
  if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true })

  const r = spawnSync(
    'npm',
    ['test', '--', '--reporter=json', `--outputFile=${outFile}`],
    {
      cwd: APP_ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    },
  )

  let failed = 0
  let passed = 0
  if (fs.existsSync(outFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(outFile, 'utf8'))
      failed = raw.numFailedTests ?? 0
      passed = raw.numPassedTests ?? 0
    } catch {
      /* 报告损坏时按 0 处理，下面的 exitCode 判定会兜住 */
    }
  }
  fs.rmSync(outFile, { force: true })
  return { exitCode: r.status, failed, passed, output: `${r.stdout || ''}${r.stderr || ''}` }
}

/**
 * 每个破坏用例：
 *   file     被改的文件（相对 APP_ROOT）
 *   from     原片段（必须唯一命中）
 *   to       改坏后的片段
 *   expect   期望的最小变红条数
 *   name     用例名
 */
const MUTATIONS = [
  {
    name: 'SOS 出站字段名 description → reason（服务端 zod 会 strip）',
    file: 'src/services/order.ts',
    from: '{ description: input.description.slice(0, 500) }',
    to: '{ reason: input.description.slice(0, 500) }',
    expect: 2,
  },
  {
    name: 'SOS 多传 type: \'SOS\'（服务端 schema 未声明）',
    file: 'src/services/order.ts',
    from: "orderId: input.orderId,\n",
    to: "orderId: input.orderId,\n    type: 'SOS',\n",
    expect: 1,
  },
  {
    name: 'level 兜底 CRITICAL → URGENT（真实值是 CRITICAL）',
    file: 'src/services/order.ts',
    from: "level: res.level || 'CRITICAL',",
    to: "level: res.level || 'URGENT',",
    expect: 2,
  },
  {
    name: 'suspended 判定 === true → !== false（恒真，误报已挂起）',
    file: 'src/services/order.ts',
    from: 'suspended: res.suspended === true,',
    to: 'suspended: res.suspended !== false,',
    expect: 2,
  },
  {
    name: 'description 长度校验 assertDescription 不再抛错',
    file: 'src/services/risk.ts',
    from: 'throw new LocalValidationError(err)',
    to: 'void err',
    expect: 3,
  },
  {
    name: '隐私号路径漏掉 order/ 段（契约 §6.1 是 /im/privacy-binding/order/:orderId）',
    file: 'src/services/order.ts',
    from: '/im/privacy-binding/order/${orderId}',
    to: '/im/privacy-binding/${orderId}',
    expect: 1,
  },
  {
    name: 'GET /companion/me 写成 POST（方法不符 → 运行时 405）',
    file: 'src/services/companion.ts',
    from: "http.get<CompanionSelfView>('/companion/me')",
    to: "http.post<CompanionSelfView>('/companion/me')",
    expect: 1,
  },
  {
    name: '陪聊员端调 admin 端点（越权红线，契约 §7.2）',
    file: 'src/services/companion.ts',
    from: "http.get<CompanionSelfView>('/companion/me')",
    to: "http.get<CompanionSelfView>('/admin/companions/me')",
    expect: 3,
  },
]

console.log('── 断言牙齿自检（mutation testing）──────────────────────────')
console.log('手法：只改端侧实现，不动测试文件；看断言是否变红；然后逐字节恢复。')
console.log('')

let failedCases = 0
const fingerprints = {}

for (const m of MUTATIONS) {
  const before = fingerprint(m.file)
  fingerprints[m.file] = before
  const src = read(m.file)

  const occurrences = src.split(m.from).length - 1
  if (occurrences !== 1) {
    console.log(`⚠️  跳过「${m.name}」：片段在 ${m.file} 命中 ${occurrences} 次（必须唯一）`)
    failedCases++
    continue
  }

  write(m.file, src.replace(m.from, m.to))
  const t = runTests()
  write(m.file, src) // 立即恢复，不留脏状态

  const restored = fingerprint(m.file) === before
  const caught = t.failed >= m.expect
  const mark = caught && restored ? '✅' : '❌'

  console.log(
    `${mark} ${m.name}\n`
    + `     变红 ${t.failed} 条（期望 ≥${m.expect}）· 通过 ${t.passed} 条 · 退出码 ${t.exitCode}\n`
    + `     恢复校验：${restored ? 'MD5 一致 ✅' : 'MD5 不一致 ❌'}`,
  )
  if (!caught || !restored) failedCases++
}

console.log('')
console.log('── 额外守卫：类型层回归（vitest 抓不到，只有 tsc 能抓）──────────')
{
  const before = fingerprint('src/services/risk.ts')
  const src = read('src/services/risk.ts')
  const m = MUTATIONS.find((x) => x.name.includes('ReportType')) // 复用同一手法
  // ReportType 的破坏不在 MUTATIONS 里（它在 tsc 侧验），这里单独做
  const from = "export type ReportType = 'FLY_ORDER' | 'OFF_PLATFORM_PAY' | 'OTHER'"
  const to = "export type ReportType = 'OFFLINE_PRICE' | 'CONTACT_EXCHANGE' | 'OTHER'"
  if (src.includes(from)) {
    write('src/services/risk.ts', src.replace(from, to))
    const tsc = spawnSync('npx', ['tsc', '--noEmit'], {
      cwd: APP_ROOT,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    })
    write('src/services/risk.ts', src)
    const restored = fingerprint('src/services/risk.ts') === before
    const caught = tsc.status !== 0
    console.log(
      `${caught && restored ? '✅' : '❌'} ReportType 改回 schema 旧值 → tsc 退出码 ${tsc.status}`
      + `（期望非 0）· 恢复校验：${restored ? 'MD5 一致 ✅' : 'MD5 不一致 ❌'}`,
    )
    if (!caught || !restored) failedCases++
    void m
  }
}

console.log('')
console.log('── 收尾：确认工作区已完全恢复 ──────────────────────────────')
let allRestored = true
for (const [file, fp] of Object.entries(fingerprints)) {
  const now = fingerprint(file)
  const ok = now === fp
  if (!ok) allRestored = false
  console.log(`${ok ? '✅' : '❌'} ${file}  MD5 ${now}${ok ? '' : `（期望 ${fp}）`}`)
}

console.log('')
console.log(failedCases === 0 && allRestored ? '✅ 全部破坏都被抓到，断言有牙齿' : `❌ ${failedCases} 项未达标`)
process.exit(failedCases === 0 && allRestored ? 0 : 1)
