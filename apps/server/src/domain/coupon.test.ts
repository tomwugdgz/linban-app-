// ============================================================================
// 券模板领域规则单测（domain 层，零 IO）
// ----------------------------------------------------------------------------
// 这组测试守的是**钱**。券面额错一位 = 用户实际多拿/少拿钱，且已领取的券
// 是既成事实、改模板改不回来。所以重点在三类断言：
//   1. 不变量穷举（`used ≤ claimed ≤ total` 的全部组合）
//   2. **反例证明**（把规则改坏，测试必须红——否则这组测试是摆设）
//   3. 冲突组合（限量券想改面额 / 不限量券库存无约束）
// ============================================================================

import { describe, expect, it } from 'vitest';
import { COUPON_STATUS, type CouponStatus } from '@linban/shared';
import {
  canTransition,
  checkCountInvariant,
  isIdempotentNoop,
  isTerminal,
  NEW_COUPON_INITIAL_STATUS,
  validateCouponEdit,
  validateEnd,
  validatePause,
  validatePublish,
  validateResume,
  type CouponSnapshot,
} from './coupon';

/** 造一个券模板快照（边界用例显式传参，不靠默认值隐含） */
function snap(over: Partial<CouponSnapshot> = {}): CouponSnapshot {
  return {
    status: COUPON_STATUS.DRAFT,
    value: 1000,
    min_spend_fen: 5000n,
    valid_days: 30,
    total_count: 100,
    claimed_count: 0,
    used_count: 0,
    ...over,
  };
}

describe('券模板状态机', () => {
  it('ENDED 是终态，不可逆（运营误点一次不损失投放期）', () => {
    expect(isTerminal(COUPON_STATUS.ENDED)).toBe(true);
    for (const to of [COUPON_STATUS.DRAFT, COUPON_STATUS.ACTIVE, COUPON_STATUS.PAUSED]) {
      expect(canTransition(COUPON_STATUS.ENDED, to), `ENDED 不该能到 ${to}`).toBe(false);
    }
  });

  it('PAUSED 与 ENDED 必须分开：暂停可恢复，结束不可', () => {
    // 这是本设计的核心区分。合并成一个「停用」会让暂停变成不可逆。
    expect(canTransition(COUPON_STATUS.PAUSED, COUPON_STATUS.ACTIVE)).toBe(true);
    expect(canTransition(COUPON_STATUS.ACTIVE, COUPON_STATUS.PAUSED)).toBe(true);
    expect(canTransition(COUPON_STATUS.ACTIVE, COUPON_STATUS.ENDED)).toBe(true);
    expect(canTransition(COUPON_STATUS.PAUSED, COUPON_STATUS.ENDED)).toBe(true);
  });

  it('DRAFT 只能到 ACTIVE 或 ENDED，不能直接 PAUSED', () => {
    expect(canTransition(COUPON_STATUS.DRAFT, COUPON_STATUS.ACTIVE)).toBe(true);
    expect(canTransition(COUPON_STATUS.DRAFT, COUPON_STATUS.ENDED)).toBe(true);
    expect(canTransition(COUPON_STATUS.DRAFT, COUPON_STATUS.PAUSED)).toBe(false);
  });

  it('不存在回退到 DRAFT 的路径（投放后不该再变回草稿重投）', () => {
    for (const from of [COUPON_STATUS.ACTIVE, COUPON_STATUS.PAUSED, COUPON_STATUS.ENDED]) {
      expect(canTransition(from, COUPON_STATUS.DRAFT), `${from} 不该回退到 DRAFT`).toBe(false);
    }
  });

  it('同状态转移是幂等 noop 而非非法流转（重复调 publish/end 不该报错）', () => {
    expect(isIdempotentNoop(COUPON_STATUS.ACTIVE, COUPON_STATUS.ACTIVE)).toBe(true);
    expect(isIdempotentNoop(COUPON_STATUS.ENDED, COUPON_STATUS.ENDED)).toBe(true);
    expect(isIdempotentNoop(COUPON_STATUS.DRAFT, COUPON_STATUS.ACTIVE)).toBe(false);
  });
});

describe('计数不变量 used ≤ claimed ≤ total', () => {
  it('穷举：total=0（不限量）时只约束 used ≤ claimed', () => {
    expect(checkCountInvariant({ totalCount: 0, claimedCount: 99999, usedCount: 0 }).ok).toBe(true);
    expect(checkCountInvariant({ totalCount: 0, claimedCount: 99999, usedCount: 99999 }).ok).toBe(true);
    // used > claimed 是数据倒挂，必须抓出来
    expect(checkCountInvariant({ totalCount: 0, claimedCount: 5, usedCount: 6 })).toMatchObject({
      ok: false,
      code: 'COUNT_INVERSION',
    });
  });

  it('穷举：限量券 claimed ≤ total', () => {
    expect(checkCountInvariant({ totalCount: 100, claimedCount: 100, usedCount: 0 }).ok).toBe(true);
    expect(checkCountInvariant({ totalCount: 100, claimedCount: 101, usedCount: 0 })).toMatchObject({
      ok: false,
      code: 'LIMITED_OVERDRAFT',
    });
  });

  it('边界：三者相等（全核销）合法', () => {
    expect(checkCountInvariant({ totalCount: 50, claimedCount: 50, usedCount: 50 }).ok).toBe(true);
  });

  it('used > claimed 优先于 claimed > total 报出（先报更严重的倒挂）', () => {
    const r = checkCountInvariant({ totalCount: 10, claimedCount: 5, usedCount: 9 });
    expect(r).toMatchObject({ ok: false, code: 'COUNT_INVERSION', field: 'usedCount' });
  });
});

describe('编辑校验 · 面额冻结（资金口径核心）', () => {
  it('claimed_count = 0 时可改面额', () => {
    const r = validateCouponEdit(snap({ claimed_count: 0, value: 1000 }), { value: 2000 });
    expect(r.ok).toBe(true);
  });

  it('claimed_count > 0 时改面额被拒——否则存量已领券与模板不一致', () => {
    const r = validateCouponEdit(snap({ claimed_count: 5, value: 1000 }), { value: 2000 });
    expect(r).toMatchObject({ ok: false, field: 'value', code: 'VALUE_FROZEN' });
  });

  it('claimed_count > 0 但面额未变时放行（其它字段仍可改，如延长有效期）', () => {
    const r = validateCouponEdit(snap({ claimed_count: 5, value: 1000 }), {
      value: 1000,
      validDays: 60,
      endAt: null,
    });
    expect(r.ok).toBe(true);
  });

  it('面额按类型分档：时长券 600 分钟上限', () => {
    const base = snap({ value: 60 });
    // 类型字段未随 input 传入时回落 FULL_REDUCTION，故显式构造时长券快照
    const durationSnap = { ...base, value: 60 } as CouponSnapshot;
    expect(validateCouponEdit(durationSnap, { type: 'DURATION', value: 601 }).ok).toBe(false);
    expect(validateCouponEdit(durationSnap, { type: 'DURATION', value: 600 }).ok).toBe(true);
  });

  it('满减面额上限 50000 分（=500 元），防误填当元用', () => {
    expect(validateCouponEdit(snap({ value: 1000 }), { type: 'FULL_REDUCTION', value: 50001 }).ok).toBe(false);
    expect(validateCouponEdit(snap({ value: 1000 }), { type: 'FULL_REDUCTION', value: 50000 }).ok).toBe(true);
  });

  it('面额为 0 或负数被拒', () => {
    expect(validateCouponEdit(snap(), { value: 0 })).toMatchObject({ ok: false, code: 'VALUE_OUT_OF_RANGE' });
    expect(validateCouponEdit(snap(), { value: -100 })).toMatchObject({ ok: false });
  });

  it('非整数面额被拒（避免 10.5 分这类脏数据进库）', () => {
    expect(validateCouponEdit(snap(), { value: 10.5 })).toMatchObject({ ok: false });
  });
});

describe('编辑校验 · 总量与超发', () => {
  it('total_count 不得小于已领取（否则库存负数 = 超发）', () => {
    const r = validateCouponEdit(snap({ claimed_count: 30, total_count: 100 }), { totalCount: 20 });
    expect(r).toMatchObject({ ok: false, field: 'totalCount', code: 'TOTAL_BELOW_CLAIMED' });
  });

  it('total_count = 0（不限量）时不受 claimed 约束，可从限量改成不限量', () => {
    const r = validateCouponEdit(snap({ claimed_count: 30, total_count: 100 }), { totalCount: 0 });
    expect(r.ok).toBe(true);
  });

  it('总量为负被拒', () => {
    expect(validateCouponEdit(snap(), { totalCount: -1 })).toMatchObject({ ok: false, code: 'VALUE_OUT_OF_RANGE' });
  });

  it('总量调大到不低于已领取则放行（正常加投放）', () => {
    expect(validateCouponEdit(snap({ claimed_count: 30, total_count: 100 }), { totalCount: 200 }).ok).toBe(true);
  });
});

describe('编辑校验 · 其它字段', () => {
  it('终态券不可编辑', () => {
    const r = validateCouponEdit(snap({ status: COUPON_STATUS.ENDED }), { name: '新名字' });
    expect(r).toMatchObject({ ok: false, code: 'STATUS_ILLEGAL' });
  });

  it('结束时间必须晚于开始时间', () => {
    const r = validateCouponEdit(snap(), {
      startAt: new Date('2026-11-01T00:00:00Z'),
      endAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(r).toMatchObject({ ok: false, field: 'endAt', code: 'END_BEFORE_START' });
  });

  it('endAt 等于 startAt 被拒（时长为0的投放期无意义）', () => {
    const t = new Date('2026-11-01T00:00:00Z');
    expect(validateCouponEdit(snap(), { startAt: t, endAt: t })).toMatchObject({ ok: false });
  });

  it('有效天数越界被拒', () => {
    expect(validateCouponEdit(snap(), { validDays: 0 })).toMatchObject({ ok: false });
    expect(validateCouponEdit(snap(), { validDays: 3651 })).toMatchObject({ ok: false });
    expect(validateCouponEdit(snap(), { validDays: 3650 }).ok).toBe(true);
  });

  it('使用门槛为负被拒', () => {
    expect(validateCouponEdit(snap(), { minSpendFen: -1n })).toMatchObject({ ok: false });
  });

  it('空更新（无字段）合法', () => {
    expect(validateCouponEdit(snap(), {}).ok).toBe(true);
  });
});

describe('发布校验', () => {
  const NOW = new Date('2026-10-20T00:00:00Z');

  it('草稿可发布', () => {
    expect(validatePublish(snap({ status: COUPON_STATUS.DRAFT }), 'FULL_REDUCTION', null, null, NOW).ok).toBe(true);
  });

  it('已投放中重复 publish 幂等放行（不报错）', () => {
    expect(validatePublish(snap({ status: COUPON_STATUS.ACTIVE }), 'FULL_REDUCTION', null, null, NOW).ok).toBe(true);
  });

  it('已暂停可重新发布', () => {
    expect(validatePublish(snap({ status: COUPON_STATUS.PAUSED }), 'FULL_REDUCTION', null, null, NOW).ok).toBe(true);
  });

  it('已结束不可再发布（终态不可逆）', () => {
    const r = validatePublish(snap({ status: COUPON_STATUS.ENDED }), 'FULL_REDUCTION', null, null, NOW);
    expect(r).toMatchObject({ ok: false, code: 'STATUS_ILLEGAL' });
  });

  it('面额为 0 的券不可投放（投出去是空气）', () => {
    const r = validatePublish(snap({ value: 0 }), 'FULL_REDUCTION', null, null, NOW);
    expect(r).toMatchObject({ ok: false, field: 'value' });
  });

  it('结束时间已过不可投放（投出去即死券，用户领了发现不能用）', () => {
    const past = new Date('2026-10-01T00:00:00Z');
    const r = validatePublish(snap(), 'FULL_REDUCTION', null, past, NOW);
    expect(r).toMatchObject({ ok: false, field: 'endAt' });
  });

  it('时长券面额超 600 分钟不可投放', () => {
    const r = validatePublish(snap({ value: 700 }), 'DURATION', null, null, NOW);
    expect(r).toMatchObject({ ok: false, code: 'VALUE_OUT_OF_RANGE' });
  });

  it('库存倒挂的脏数据不得投放', () => {
    const dirty = snap({ claimed_count: 5, used_count: 9 });
    const r = validatePublish(dirty, 'FULL_REDUCTION', null, null, NOW);
    expect(r).toMatchObject({ ok: false, code: 'COUNT_INVERSION' });
  });
});

describe('暂停 / 恢复 / 结束校验', () => {
  it('仅投放中可暂停，其余拒绝', () => {
    expect(validatePause(snap({ status: COUPON_STATUS.ACTIVE })).ok).toBe(true);
    expect(validatePause(snap({ status: COUPON_STATUS.DRAFT })).ok).toBe(false);
    expect(validatePause(snap({ status: COUPON_STATUS.ENDED })).ok).toBe(false);
  });

  it('暂停幂等：已暂停重复 pause 不报错', () => {
    expect(validatePause(snap({ status: COUPON_STATUS.PAUSED })).ok).toBe(true);
  });

  it('仅已暂停可恢复', () => {
    expect(validateResume(snap({ status: COUPON_STATUS.PAUSED })).ok).toBe(true);
    expect(validateResume(snap({ status: COUPON_STATUS.ACTIVE })).ok).toBe(true); // 幂等
    expect(validateResume(snap({ status: COUPON_STATUS.DRAFT })).ok).toBe(false);
    expect(validateResume(snap({ status: COUPON_STATUS.ENDED })).ok).toBe(false);
  });

  it('结束幂等：已结束重复 end 不报错（不可逆操作的幂等必须放行）', () => {
    expect(validateEnd(snap({ status: COUPON_STATUS.ENDED })).ok).toBe(true);
  });

  it('任何非终态都可结束', () => {
    for (const status of [COUPON_STATUS.DRAFT, COUPON_STATUS.ACTIVE, COUPON_STATUS.PAUSED]) {
      expect(validateEnd(snap({ status })).ok, `${status} 应可结束`).toBe(true);
    }
  });
});

describe('新建券落 DRAFT 而非 ACTIVE', () => {
  it('初始状态是草稿（券面额是资金口径，建完不该直接对外发）', () => {
    expect(NEW_COUPON_INITIAL_STATUS).toBe(COUPON_STATUS.DRAFT);
  });

  it('反例证明：若改成 ACTIVE，发布前置校验就形同虚设', () => {
    // 新建即ACTIVE 意味着运营还没复核就把钱口径发出去了
    expect(NEW_COUPON_INITIAL_STATUS).not.toBe(COUPON_STATUS.ACTIVE);
  });
});

describe('状态机完整性（防新增状态漏改规则）', () => {
  it('四种状态全部覆盖，且恰好一个终态', () => {
    const all: CouponStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];
    const terminals = all.filter(isTerminal);
    expect(terminals).toEqual([COUPON_STATUS.ENDED]);
  });

  it('新增状态若未登记流转表，isTerminal 与 canTransition 必须表现为拒绝', () => {
    // 用一个不在 TRANSITIONS 里的值模拟「未来新增状态忘了登记」
    const future = 'FUTURE_STATUS' as CouponStatus;
    expect(isTerminal(future)).toBe(true); // 无条目 → 视为终态 → 拒绝一切
    expect(canTransition(future, COUPON_STATUS.ACTIVE)).toBe(false);
  });

  it('规则函数对未知状态默认拒绝而非放行（fail-closed）', () => {
    const unknown = snap({ status: 'UNKNOWN' as CouponStatus });
    expect(validatePause(unknown).ok).toBe(false);
    expect(validateResume(unknown).ok).toBe(false);
    expect(validateEnd(unknown).ok).toBe(false);
  });
});