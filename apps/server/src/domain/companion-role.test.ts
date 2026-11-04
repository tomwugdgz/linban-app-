// ============================================================================
// 供给角色领域规则单测（架构 §15.4 / §15.5 / §15.10 验收项 3、5）
// ----------------------------------------------------------------------------
// 重点不是「跑通」，而是把两条最容易靠默认分支蒙混的隔离纪律钉死：
//   ① 四个角色逐一显式断言 canEnterProfitSharing（非货币角色必须为 false）；
//   ② 角色加成走独立排序器，DISPATCH_WEIGHTS 总和仍 100 且未指定偏好时零回归。
// ============================================================================

import { describe, expect, it } from 'vitest';
import { AppError } from '@linban/shared';
import type { companion_role } from '@linban/shared';
import { DISPATCH_WEIGHTS } from './dispatch';
import {
  ROLE_MATCH_BONUS,
  assertOpenCompanionRole,
  assertSharingEligible,
  canEnterProfitSharing,
  isMonetarySettlement,
  isOpenCompanionRole,
  rankByCompanionRole,
  roleMatchBonus,
} from './companion-role';

/** 断言 fn 抛出「指定错误码」的 AppError：显式校验 code，避免「抛了但码不对」蒙混 */
function expectAppErrorCode(fn: () => void, code: number): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe(code);
}

const item = (id: string, role: companion_role, base = 0) => ({ id, role, base });

describe('角色开放性与结算模式', () => {
  it('isOpenCompanionRole：本轮双开放，其余两值只留位', () => {
    expect(isOpenCompanionRole('SHARED_SON')).toBe(true);
    expect(isOpenCompanionRole('PROFESSIONAL')).toBe(true);
    expect(isOpenCompanionRole('TIME_BANK')).toBe(false);
    expect(isOpenCompanionRole('VOLUNTEER')).toBe(false);
  });

  it('isMonetarySettlement：两个付费角色有真实货币流，两个预留角色没有', () => {
    expect(isMonetarySettlement('SHARED_SON')).toBe(true);
    expect(isMonetarySettlement('PROFESSIONAL')).toBe(true);
    expect(isMonetarySettlement('TIME_BANK')).toBe(false);
    expect(isMonetarySettlement('VOLUNTEER')).toBe(false);
  });

  // §15.4 硬要求：四角色逐一显式断言，非货币角色的「不进分账」不能靠默认蒙混
  it('canEnterProfitSharing：四值逐一显式断言（两进两不进）', () => {
    expect(canEnterProfitSharing('SHARED_SON')).toBe(true);   // 共享儿子：时薪付费，进分账
    expect(canEnterProfitSharing('PROFESSIONAL')).toBe(true); // 专业陪护：高客单付费，进分账
    expect(canEnterProfitSharing('TIME_BANK')).toBe(false);   // 时间银行：积分兑换，绝不进
    expect(canEnterProfitSharing('VOLUNTEER')).toBe(false);   // 社区志愿者：荣誉补贴，绝不进
  });
});

describe('前置断言（错误码 13016 / 13017）', () => {
  it('assertOpenCompanionRole：两个预留值抛 13016', () => {
    expectAppErrorCode(() => assertOpenCompanionRole('TIME_BANK'), 13016);
    expectAppErrorCode(() => assertOpenCompanionRole('VOLUNTEER'), 13016);
  });

  it('assertOpenCompanionRole：两个开放值不抛', () => {
    expect(() => assertOpenCompanionRole('SHARED_SON')).not.toThrow();
    expect(() => assertOpenCompanionRole('PROFESSIONAL')).not.toThrow();
  });

  it('assertSharingEligible：两个非货币值抛 13017', () => {
    expectAppErrorCode(() => assertSharingEligible('TIME_BANK'), 13017);
    expectAppErrorCode(() => assertSharingEligible('VOLUNTEER'), 13017);
  });

  it('assertSharingEligible：两个货币结算值不抛', () => {
    expect(() => assertSharingEligible('SHARED_SON')).not.toThrow();
    expect(() => assertSharingEligible('PROFESSIONAL')).not.toThrow();
  });
});

describe('角色化派单（§15.5 不得破坏既有出口）', () => {
  it('ROLE_MATCH_BONUS 固定 8（§15.12 C10），命中返回 8、未命中/无偏好返回 0', () => {
    expect(ROLE_MATCH_BONUS).toBe(8);
    expect(roleMatchBonus('SHARED_SON', 'SHARED_SON')).toBe(8);
    expect(roleMatchBonus('PROFESSIONAL', 'SHARED_SON')).toBe(0);
    expect(roleMatchBonus('SHARED_SON', undefined)).toBe(0);
    expect(roleMatchBonus('SHARED_SON', null)).toBe(0);
  });

  it('DISPATCH_WEIGHTS 总和仍为 100（角色加成未写入权重）', () => {
    const sum = Object.values(DISPATCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('未指定 preferredRole：结果与改造前原顺序逐字一致（即使 base 未排序）', () => {
    const items = [
      item('A', 'SHARED_SON', 85),
      item('B', 'PROFESSIONAL', 60),
      item('C', 'SHARED_SON', 95),
      item('D', 'PROFESSIONAL', 30),
    ];
    // 故意传入 baseScoreOf：若实现忘了「无偏好直接原序返回」，分档排序会把它改成 C,A,B,D
    expect(rankByCompanionRole(items, undefined, (x) => x.base).map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(rankByCompanionRole(items, null, (x) => x.base).map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('指定 preferredRole：同档内命中角色排前，且加成不得跨档', () => {
    const items = [
      item('A', 'SHARED_SON', 89),    // band 8，命中 → 89+8=97
      item('B', 'PROFESSIONAL', 85),  // band 8，未命中 → 85
      item('C', 'PROFESSIONAL', 90),  // band 9，未命中 → 90
      item('D', 'SHARED_SON', 81),    // band 8，命中 → 81+8=89
    ];
    const ranked = rankByCompanionRole(items, 'SHARED_SON', (x) => x.base).map((x) => x.id);
    // band 9 的 C 永远在 band 8 之前：A 命中后 finalScore 97 > C 的 90，仍不得跨档跃升
    expect(ranked).toEqual(['C', 'A', 'D', 'B']);
    // 同档（band 8）内：命中角色的 A、D 排在未命中的 B 之前
    expect(ranked.indexOf('A')).toBeLessThan(ranked.indexOf('B'));
    expect(ranked.indexOf('D')).toBeLessThan(ranked.indexOf('B'));
  });

  it('§15.12 C10：同档内基础分差 9 分可压过 8 分加成（同等条件下优先）', () => {
    const items = [
      item('A', 'SHARED_SON', 80),   // band 8，命中 → 80+8=88
      item('B', 'PROFESSIONAL', 89), // band 8，未命中 → 89（基础分高 9 分）
    ];
    // 加成若仍为 12，A(92) 会压过 B(89)；取 8 后 B 仍在前，符合「同等条件下优先」
    expect(rankByCompanionRole(items, 'SHARED_SON', (x) => x.base).map((x) => x.id)).toEqual(['B', 'A']);
  });

  it('未传 baseScoreOf 时全部同档：命中角色排前、组内保持原序稳定', () => {
    const items = [
      item('A', 'PROFESSIONAL'),
      item('B', 'SHARED_SON'),
      item('C', 'PROFESSIONAL'),
      item('D', 'SHARED_SON'),
    ];
    expect(rankByCompanionRole(items, 'SHARED_SON').map((x) => x.id)).toEqual(['B', 'D', 'A', 'C']);
  });
});
