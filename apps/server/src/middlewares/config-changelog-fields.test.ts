// ============================================================================
// 邻伴 · GET /admin/configs/changelog 出参字段名守卫
// ----------------------------------------------------------------------------
// 为什么这条必须存在：契约 §5.7.7.1 早就写明出参是
//   beforeValue / afterValue / operator / changedAt
// 且专门加了一句「若承钧按落库列名直出 createdAt，前端四列全空白」。
//
// 结果**实现还是按落库列名写了**（oldValue/newValue/operatorName/createdAt）。
// 根因不是契约没写清，而是：
//   落库列名 audit_logs.created_at 与出参名 changedAt 是两件事，
//   而「照着列名直出」是写这类映射时最自然的手——
//   **它太自然了，自然到不需要思考，因此也极难靠 review 拦下。**
//
// 后果的隐蔽性：字段名错位在 TypeScript 里**完全合法**
// （admin.routes.ts 自己拼的对象，没人会给它标 DTO 类型），
// 编译通过、运行不报错、页面那四列**永久空白**。
// 「DTO 补齐 ≠ 端上拿到值」——同一个坑在夏小笺那边的类型层也踩过。
//
// 所以本守卫直接锁字段名字面量。这是极少数「锁字面量才是正确做法」的场景：
// 契约要的就是这几个具体名字，名字变了就是**破坏契约**，不是实现细节调整。
// ============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ADMIN_SRC = readFileSync(
  fileURLToPath(new URL('../modules/admin/admin.routes.ts', import.meta.url)),
  'utf8',
);
const CONTRACT = readFileSync(
  fileURLToPath(new URL('../../../../docs/API-CONTRACT.md', import.meta.url)),
  'utf8',
);

/** 只取 changelog 路由块，避免把文件别处的同名字段算进来 */
function changelogBlock(src: string): string {
  const idx = src.indexOf("'/configs/changelog'");
  if (idx < 0) throw new Error('未找到 /configs/changelog 路由');
  const start = src.lastIndexOf('.get(', idx);
  const end = src.indexOf('\n);', idx);
  if (start < 0 || end < 0) throw new Error('未定位到路由块边界');
  return src.slice(start, end);
}

const BLOCK = changelogBlock(ADMIN_SRC);

describe('§1 出参字段名必须是契约口径（不是落库列名）', () => {
  it('出参含 beforeValue（不是 oldValue）', () => {
    expect(BLOCK).toContain('beforeValue:');
  });

  it('出参含 afterValue（不是 newValue）', () => {
    expect(BLOCK).toContain('afterValue:');
  });

  it('出参含 operator（不是 operatorName）', () => {
    expect(BLOCK).toContain('operator:');
  });

  it('出参含 changedAt（不是 createdAt）', () => {
    expect(BLOCK).toContain('changedAt:');
  });

  it('🔴 旧字段名一个都不许残留（旧名在前端零命中，残留即死列）', () => {
    for (const stale of ['oldValue', 'newValue', 'operatorName', 'createdAt:']) {
      expect(BLOCK, `changelog 出参仍含旧字段 ${stale} —— 前端该列会永久空白`).not.toContain(stale);
    }
  });

  it('变更时间取自 audit_logs.created_at 列，但出参名叫 changedAt', () => {
    // 这条是给「为什么要两个名字」留的锚点：
    // 列名答「审计记录何时写入」，出参名答「配置何时被改」，二者语义不同
    expect(BLOCK).toContain('a.created_at.toISOString()');
    expect(BLOCK).toMatch(/changedAt:\s*a\.created_at\.toISOString\(\)/);
  });
});

describe('§2 与契约逐字对齐（防止两边各走各的）', () => {
  it('契约 §5.7.7.1 登记了四个字段名', () => {
    for (const f of ['beforeValue', 'afterValue', 'operator', 'changedAt']) {
      expect(CONTRACT, `契约未登记 ${f}`).toContain(f);
    }
  });

  it('契约明确写了「changedAt 不是 createdAt」', () => {
    expect(CONTRACT).toMatch(/changedAt.*不是.*createdAt/s);
  });

  it('契约与实现的四个字段名一致（取交集后无矛盾）', () => {
    const fields = ['beforeValue', 'afterValue', 'operator', 'changedAt'] as const;
    for (const f of fields) {
      expect(BLOCK, `契约有 ${f} 但实现没有`).toContain(`${f}:`);
    }
  });
});

describe('§3 其他必备出参（防「改字段名时顺手改没了别的」）', () => {
  it('configKey / configLabel / requestId 均在出参内', () => {
    for (const f of ['configKey:', 'configLabel:', 'requestId:']) {
      expect(BLOCK).toContain(f);
    }
  });

  it('before/after 双值都有（财务要查「谁把佣金从 5% 改成 8%」需双值对照）', () => {
    expect(BLOCK).toContain('before.config_value');
    expect(BLOCK).toContain('after.config_value');
  });

  it('金额类配置值字符串化（禁浮点）', () => {
    expect(BLOCK).toContain('String(before.config_value)');
    expect(BLOCK).toContain('String(after.config_value)');
  });

  it('候选集上限 500 + truncated 标记（应用层筛 operator/keyword 的必要代价）', () => {
    expect(BLOCK).toContain('truncated:');
  });
});