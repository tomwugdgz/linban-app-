// ============================================================================
// 元门禁：测试断言的「数据源形状」纪律
// ----------------------------------------------------------------------------
// 【为什么需要这条门禁（承钧 2026-10 提出裁定，宋砚秋落笔）】
//
//   承钧的裁定原文：
//     > 断言数据源优先级：`import 真实常量` > `运行时计算` > `正则扒源码`。
//     > 越靠前越不怕格式变化；正则扒源码是最后手段，
//     > 且必须配「正则必须匹配到非空块」的断言。
//
//   这条裁定本身是对的，但**只写在信里 / wiki 里是不够的** ——
//   本项目的历史反复证明：**写下来的纪律若没有可执行断言，下一轮就会漂**。
//   故把「形状」本身变成断言。
//
// 【这条门禁守什么，不守什么】
//
//   ✅ 守：**测试源码里不得出现硬编码缩进量的正则**
//      （如 `/\n {8}\}/` —— 依赖被测文件的缩进层级）
//      这类断言的脆性是**具体的、可定位的**：
//      被测文件改一级缩进（Prettier 重排 / 调整嵌套层级）→ 失配 →
////      断言红，但**红因是「缩进变了」而不是「被测的行为错了」**
//      → 把排查方向带偏（这比假绿更隐蔽：它看起来是"发现问题"了）。
//
//   ❌ 不守：一切形式的源码文本断言
//      「正则扒源码」本身**不是罪** —— 有些契约只能靠读源码验证
//      （如「路由文件出参也不得带 cipher」—— 运行时拿不到出参结构）。
//      本门禁**不禁止**扒源码，只禁止**依赖格式细节**的扒法。
//      判据是脆性，不是形式。
//
// 【已核实的事实（2026-10，宋砚秋全量核过）】
//   - 全仓 14 份测试用 readFileSync 读源码（不止承钧点名的 2 份）
//   - 其中**硬编码缩进量**的只有 1 处：outbound-cipher-guard.test.ts
//     `/\n {8}\}/` —— 已在本轮改成不依赖缩进的写法
//   - 「正则/抠块结果无守卫」的情形**未发现真静默通过**：
//     所有 `?? ''` 兜底后都跟着必红的断言；`revenue-endpoint-contract`
//     的 `if (!m) continue` 是「换下一种形态试」，末尾有 throw 兜底
//   - 故本门禁**只**拦「硬编码缩进量」这一类具体脆性，不做宽泛判断
//
// 【为什么不做更宽的检查（如「所有 exec 结果必须有守卫」）】
//   试过，**过宽的元门禁会变成噪音源**：
//   - `while ((m = re.exec(x)) !== null)` 是循环形态，天然不需守卫
//   - `if (!m) continue` 可能是「换形态重试」也可能是「跳过」，
//     机器分不清二者 —— 这正是段 5「弱规则只报 WARN」的同一个困境
//   教训见 `docs/GATE-DECISIONS.md` D-001：**机器分不清就别让它阻塞**。
//   故本门禁只拦「确定是脆」的形态。
// ============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** 收集所有读源码的测试文件（只扫 server 的 middlewares 目录 —— 本门禁的适用范围） */
function collectSourceReadingTests(): string[] {
  const files: string[] = [];
  for (const f of readdirSync(here)) {
    if (!f.endsWith('.test.ts')) continue;
    const src = readFileSync(resolve(here, f), 'utf8');
    if (src.includes('readFileSync')) files.push(f);
  }
  return files;
}

describe('元门禁 · 测试断言的数据源形状（承钧 2026-10 裁定落地）', () => {
  it('测试源码里不得出现硬编码缩进量的正则（如 /\\n {8}\\}/）', () => {
    // 形如 `\n {8}\}` —— 正则里带**字面缩进量**。
    //
    // 【判定要领（踩过坑，记下来）】
    //   源码里的形态是 **两个字符** `\` + `n`，后面跟 `{N}`，再跟 `}`。
    //   但 `}` 通常是**转义**的（`\}`），因为它在正则里是量词语法。
    //   故**不能**用「`{` 前有反斜杠就跳过」来排除 —— 那会把真命中也排除掉
    //   （第一版就是这么写的，结果门禁恒绿、注入硬编码缩进也不红）。
    //   正确判定：**只认「`\n` + `{数字}`」这个字面组合**，不看后续 `}` 是否转义。
    //   同时排除字符类写法（`[ ]{8}` 那种是「重复 8 次空格」，不是缩进量）。
    const HARDCODED_INDENT = /\\n\s*\{\s*(\d+)\s*\}/g;
    const offenders: string[] = [];
    for (const f of collectSourceReadingTests()) {
      // ⚠️ 必须排除本门禁自己：它的 `it(...)` 标题里就写着 `/\n {8}\}/` 这个形态
      // （那是**描述文本**不是正则），不排除就是自指误报。
      if (f === 'test-assertion-source-discipline.test.ts') continue;
      const src = readFileSync(resolve(here, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return; // 注释行不算
        for (const m of line.matchAll(HARDCODED_INDENT)) {
          // 排除字符类里的重复量写法：`[ ]{8}`（重复 8 次空格，不是缩进层级）
          const idx = m.index ?? 0;
          const before = line.slice(Math.max(0, idx - 2), idx);
          if (before.includes('[')) continue;
          offenders.push(`${f}:${i + 1}  ${trimmed.slice(0, 90)}`);
        }
      });
    }
    expect(
      offenders,
      `以下测试断言依赖被测文件的缩进层级，改一级缩进就会失配（红因会变成"缩进变了"而非"行为错了"）：\n` +
        `${offenders.join('\n')}\n` +
        `改法：用内容/结构锚点定位（如 \`\\n\\s*\\}\`），不要写死空格数。`,
    ).toEqual([]);
  });

  it('本门禁自身不是空转（自证：能抓到硬编码缩进的形态）', () => {
    // 反向验证的自动化版本：把本门禁的正则喂一段「有病」的样本，
    // 断言它确实会命中 —— 否则本门禁就是个恒真断言。
    const HARDCODED_INDENT = /\\n\s*\{\s*(\d+)\s*\}/g;
    const badSample = String.raw`const d = /hit_detail:\s*\{([\s\S]*?\n {8}\})/.exec(src);`;
    const hits = [...badSample.matchAll(HARDCODED_INDENT)];
    expect(
      hits.length,
      '本门禁的正则连「有病样本」都抓不到 → 门禁恒真，规则本身失效',
    ).toBeGreaterThan(0);
  });

  it('读源码的测试都留了「匹配不到就红」的守卫（抠块空不得静默通过）', () => {
    // 只做**能机械判定**的那一类：抠块结果被 `?? ''` 兜底后，
    // 必须在同一测试内出现会因空串而红的断言（toContain / toMatch / toBeDefined）。
    // 这条是启发式（做不到 100% 判定），故只对**明确可疑**的行报错。
    const SUSPICIOUS = /const\s+\w+\s*=\s*[\w?.]*\.(exec|match)\([^;]*;\s*\n\s*const\s+\w+\s*=\s*\w+\?\.\[\d\]\s*\?\?\s*''/g;
    const offenders: string[] = [];
    for (const f of collectSourceReadingTests()) {
      const src = readFileSync(resolve(here, f), 'utf8');
      if (SUSPICIOUS.test(src)) {
        // 可疑形态存在时，看该文件内是否有守卫（toBeDefined / throw）
        const hasGuard = /toBeDefined\(\)|throw new Error/.test(src);
        if (!hasGuard) offenders.push(f);
      }
      SUSPICIOUS.lastIndex = 0;
    }
    expect(
      offenders,
      `以下测试把「正则抠块」的结果兜底成空串，且全文没有任何守卫断言（toBeDefined / throw）——` +
        `抠块失败时会静默通过：${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
