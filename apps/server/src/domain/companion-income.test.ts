// ============================================================================
// 邻伴 · companion-income.ts 域规则测试
// ----------------------------------------------------------------------------
// 本文件的核心价值：锁住「展示口径」与「扣减口径」同源。
// 这两处一旦漂移，损失是真金白银，不是体验问题。
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  LOCKED_WITHDRAWAL_STATUSES,
  SETTLED_WITHDRAWAL_STATUSES,
  buildIncomeOverview,
  canWithdraw,
  maskBankAccount,
  type IncomeAggregates,
} from './companion-income';

const agg = (over: Partial<IncomeAggregates> = {}): IncomeAggregates => ({
  totalSharedFen: 0n,
  pendingFen: 0n,
  monthSharedFen: 0n,
  lockedFen: 0n,
  settledFen: 0n,
  ...over,
});

describe('§1 可提现余额 = 已分账 − 占用提现（防超发的口径源头）', () => {
  it('无提现时可提 = 已分账', () => {
    expect(buildIncomeOverview(agg({ totalSharedFen: 50000n })).availableFen).toBe(50000n);
  });

  it('有占用中提现时可提被扣减', () => {
    const m = buildIncomeOverview(agg({ totalSharedFen: 50000n, lockedFen: 20000n }));
    expect(m.availableFen).toBe(30000n);
  });

  it('占用大于已分账（脏数据）时钳到 0，不返回负数', () => {
    // 负数对陪聊员毫无意义，且会让人以为「欠平台钱」
    const m = buildIncomeOverview(agg({ totalSharedFen: 1000n, lockedFen: 3000n }));
    expect(m.availableFen).toBe(0n);
  });

  it('已分账为 0 时可提为 0（不是负数）', () => {
    expect(buildIncomeOverview(agg()).availableFen).toBe(0n);
  });

  // 注入实测：availableFen 改成不扣 lockedFen → 「有占用中提现时可提被扣减」红。
  // 资损方向：同一笔钱可被反复提交提现。
});

describe('§2 占用态 vs 已到账态：两个集合不能混用', () => {
  it('占用集合含 PENDING_REVIEW（待审核期间反复提交是真实场景）', () => {
    expect(LOCKED_WITHDRAWAL_STATUSES).toContain('PENDING_REVIEW');
  });

  it('占用集合含 APPROVED/PROCESSING/SUCCESS', () => {
    for (const s of ['APPROVED', 'PROCESSING', 'SUCCESS'] as const) {
      expect(LOCKED_WITHDRAWAL_STATUSES).toContain(s);
    }
  });

  it('占用集合**不含** REJECTED（驳回的钱已解锁，再占就是冻结用户资产）', () => {
    expect(LOCKED_WITHDRAWAL_STATUSES).not.toContain('REJECTED');
  });

  it('占用集合**不含** FAILED（打款失败钱没出去，应解锁让人重试）', () => {
    expect(LOCKED_WITHDRAWAL_STATUSES).not.toContain('FAILED');
  });

  it('已到账集合只含 SUCCESS', () => {
    expect([...SETTLED_WITHDRAWAL_STATUSES]).toEqual(['SUCCESS']);
  });

  it('已到账集合不含 PROCESSING（钱未到账，算累计提现是虚报）', () => {
    expect(SETTLED_WITHDRAWAL_STATUSES).not.toContain('PROCESSING');
  });

  it('两集合不同（混用会让「已申请未到账」的钱从账上蒸发）', () => {
    expect([...LOCKED_WITHDRAWAL_STATUSES].sort()).not.toEqual([...SETTLED_WITHDRAWAL_STATUSES].sort());
  });

  it('LOCKED ⊇ SETTLED（已到账一定是占用中，反之不然）', () => {
    for (const s of SETTLED_WITHDRAWAL_STATUSES) {
      expect(LOCKED_WITHDRAWAL_STATUSES).toContain(s);
    }
  });

  // 注入实测：把 REJECTED 加进占用集合 → 「REJECTED 不占用」红。
  // 用户被驳回后钱仍显示被占用，会反复投诉「驳回了还是提不了」。
});

describe('§3 累计提现 = 仅 SUCCESS（区别于占用）', () => {
  it('累计提现取 settledFen 而非 lockedFen', () => {
    const m = buildIncomeOverview(agg({ totalSharedFen: 100000n, lockedFen: 40000n, settledFen: 10000n }));
    expect(m.totalWithdrawnFen).toBe(10000n);
  });

  it('占用 40000 / 已到账 10000 的场景下可提仍按占用扣（即按40000）', () => {
    const m = buildIncomeOverview(agg({ totalSharedFen: 100000n, lockedFen: 40000n, settledFen: 10000n }));
    expect(m.availableFen).toBe(60000n);
  });

  // 注入实测：totalWithdrawnFen 改成 lockedFen → 本节首条红（虚报提现额）。
});

describe('§4 待入账与本月入账', () => {
  it('待入账取 FROZEN 合计', () => {
    expect(buildIncomeOverview(agg({ pendingFen: 12000n })).pendingFen).toBe(12000n);
  });

  it('本月入账独立字段', () => {
    expect(buildIncomeOverview(agg({ monthSharedFen: 8888n })).monthSharedFen).toBe(8888n);
  });

  it('本月入账不参与可提余额计算（本月未分账的钱取不走）', () => {
    const m = buildIncomeOverview(agg({ totalSharedFen: 10000n, monthSharedFen: 10000n }));
    expect(m.availableFen).toBe(10000n);
  });

  it('待入账不参与可提余额计算', () => {
    const m = buildIncomeOverview(agg({ totalSharedFen: 10000n, pendingFen: 50000n }));
    expect(m.availableFen).toBe(10000n);
  });

  // 注入实测：availableFen 改成 totalShared + pending → 本节末两条红。
  // 资损方向：让陪聊员去提尚未分账的钱。
});

describe('§5 提现受理判定（与展示同源）', () => {
  it('余额充足时放行', () => {
    expect(canWithdraw(10000n, 50000n).allowed).toBe(true);
  });

  it('金额为 0 拒绝且原因是 AMOUNT_NOT_POSITIVE', () => {
    const d = canWithdraw(0n, 50000n);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('负金额拒绝', () => {
    expect(canWithdraw(-1n, 50000n).reason).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('超余额拒绝且原因是 EXCEEDS_AVAILABLE', () => {
    const d = canWithdraw(60000n, 50000n);
    expect(d.reason).toBe('EXCEEDS_AVAILABLE');
  });

  it('恰好等于余额时放行（边界不含糊）', () => {
    expect(canWithdraw(50000n, 50000n).allowed).toBe(true);
  });

  it('余额为 0 时任何正金额都拒', () => {
    expect(canWithdraw(1n, 0n).reason).toBe('EXCEEDS_AVAILABLE');
  });

  it('LOCK_MISSING 原因码已登记（供将来事务内 re-check 复用）', () => {
    // 枚举里必须存在该码，否则 service 层想用时 TS 会报「不在联合类型内」
    const d: ReturnType<typeof canWithdraw> = { allowed: false, reason: 'LOCK_MISSING' };
    expect(d.reason).toBe('LOCK_MISSING');
  });

  // 注入实测：把比较符 <= 改成 < → 「恰好等于余额」红（差一分不让提，客服工单）。
});

describe('§6 银行卡脱敏', () => {
  it('标准 16 位卡：前 4 后 4', () => {
    expect(maskBankAccount('6222021234567890')).toBe('6222********7890');
  });

  it('19 位卡同样前 4 后 4（长度不影响）', () => {
    expect(maskBankAccount('6222021234567890123')).toBe('6222********0123');
  });

  it('不足 8 位整体打码（不泄露任何位数信息）', () => {
    expect(maskBankAccount('12345')).toBe('****');
  });

  it('含空格时先去空格再脱敏', () => {
    expect(maskBankAccount('6222 0212 3456 7890')).toBe('6222********7890');
  });

  it('出参不含完整卡号（断言中段恒为星号）', () => {
    const out = maskBankAccount('6222021234567890');
    expect(out).not.toContain('0212');
    expect(out).not.toContain('3456');
  });

  // 注入实测：把 slice(0,4)/slice(-4) 改成 slice(0,8)/slice(-8) → 末条红。
});

describe('§7 金额全程 BigInt（分），不经 Number', () => {
  it('超Number 安全整数的金额仍精确', () => {
    // 2^53 = 9007199254740992；用超一位的金额验证未被转 float
    const huge = 9007199254740993n;
    const m = buildIncomeOverview(agg({ totalSharedFen: huge }));
    expect(m.totalSharedFen).toBe(huge);
    expect(m.availableFen).toBe(huge);
  });

  it('差 1 分可辨（浮点会丢这一分）', () => {
    const a = buildIncomeOverview(agg({ totalSharedFen: 9007199254740993n })).totalSharedFen;
    const b = buildIncomeOverview(agg({ totalSharedFen: 9007199254740992n })).totalSharedFen;
    expect(a - b).toBe(1n);
  });
});