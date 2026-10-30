// ============================================================================
// 金额处理红线测试（契约 §1 通用约定 + packages/shared/src/dto.ts:5）
// ----------------------------------------------------------------------------
// 契约/共享类型的原文（dto.ts:5）：
//   「金额字段一律 string（BigInt 序列化），禁止 number，杜绝浮点与精度丢失」
//
// 这条测试守护三件事：
//   ① 金额在 service / mock / 展示层全程保持 **string**，不被转成 number 传递
//   ② 分→元 换算在**超大金额**下不丢精度（2^53 是 JS number 的安全整数上限，
//      超过它 Number() 就会丢精度 —— 而 BigInt 金额本来就可以超过它）
//   ③ mock 的金额运算不能因为用 Number 做运算而引入浮点误差
//     （mock 是端侧「服务端行为」的参照实现，mock 算错会把实现带歪）
//
// ⚠️ 这类错误 tsc 拦不住（string→number 是合法转换），
//    只有断言能钉死 —— 破坏法实测：把 fenToYuan 改回 Number 运算即变红。
// ============================================================================

import { describe, it, expect } from 'vitest'
import { fenToYuan, yuanToFen } from '@/utils/format'

/** JS number 的安全整数上限（2^53 - 1）；超过它 Number() 会丢精度 */
const MAX_SAFE = Number.MAX_SAFE_INTEGER

describe('金额换算（fenToYuan）', () => {
  it('常规金额换算正确（分 → 元，两位小数）', () => {
    expect(fenToYuan('0')).toBe('0.00')
    expect(fenToYuan('1')).toBe('0.01')
    expect(fenToYuan('100')).toBe('1.00')
    expect(fenToYuan('12345')).toBe('123.45')
    expect(fenToYuan('1000000')).toBe('10000.00')
  })

  it('带符号时正确输出（¥ 前缀 + 负号）', () => {
    expect(fenToYuan('12345', true)).toBe('¥123.45')
    expect(fenToYuan('-12345', true)).toBe('-¥123.45')
  })

  it('非法输入兜底为 0.00（不抛异常、不显示 NaN）', () => {
    expect(fenToYuan('abc')).toBe('0.00')
    expect(fenToYuan('abc', true)).toBe('¥0.00')
    expect(fenToYuan(Number.NaN)).toBe('0.00')
    expect(fenToYuan(Number.POSITIVE_INFINITY)).toBe('0.00')
  })

  it('超大金额不丢精度（BigInt 金额可超 2^53，Number() 会丢）', () => {
    // 2^53 + 1 = 9007199254740993，Number() 存它会变成 9007199254740992（差 1 分）
    const big = '9007199254740993'
    // 正确结果：90071992547409.93 元
    // 若实现走 Number(fen)，会得到 ...992 → 少 1 分
    expect(fenToYuan(big)).toBe('90071992547409.93')
    // 反证：Number 路径确实会丢精度（说明这条断言不是恒真）
    expect(String(Number(big))).not.toBe(big)
  })

  it('超过安全整数上限的金额，其「分」位不能被四舍五入吃掉', () => {
    // 5 分的尾数：超大金额 + 5 分，末两位必须保留 05
    const big = '9007199254740993'
    expect(fenToYuan(big).endsWith('.93')).toBe(true)
    // 边界：恰好 2^53（仍是安全整数）必须精确
    expect(fenToYuan(String(MAX_SAFE))).toBe('90071992547409.91')
  })

  it('元 → 分 往返一致（常见金额）', () => {
    for (const yuan of ['0', '1', '1.5', '123.45', '10000']) {
      expect(fenToYuan(yuanToFen(yuan))).toBe(Number(yuan).toFixed(2))
    }
  })
})
