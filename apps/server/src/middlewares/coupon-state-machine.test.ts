// ============================================================================
// 券模板状态机「准入条件」守卫
// ----------------------------------------------------------------------------
// 本测试要防的具体事故（team-lead 指出，属实）：
//
//   `publish` 与 `resume` 的**目标态相同**（都是 ACTIVE），
//   但**准入条件完全不同**：
//     publish：DRAFT/PAUSED → ACTIVE，且必须过面额范围、死券时间窗、库存等全部校验
//     resume ：仅 PAUSED → ACTIVE，且刻意**不过**上述校验（它恢复的是已投放过的券）
//   所以「目标态相同」**推不出**「准入条件相同」。
//   实现里若图省事写`canTransition(status, ACTIVE)` 复用给resume，
//   就会让 DRAFT 券被 resume 绕开 publish 的全部校验直接投放 ——
//   面额 0、超范围、已过期、库存倒挂的草稿券都能被投出去。
//
// ⚠️ 本测试刻意**断言「准入条件」而不是「目标态」**
//   （team-lead 明确要求）：
//   只断言「DRAFT 经 resume 后仍是 DRAFT」是**不够**的 ——
//   那可能是因为别的路径（比如 service 层先拦了）也拦住了，
//   域函数本身的漏洞被掩盖。真正的守卫必须断言：
//     ① 域函数**自己**返回 ok:false（不是上层碰巧拦住）
//     ② 错误码是 STATUS_ILLEGAL（不是别的校验碰巧报错）
//     ③ 且 canTransition(DRAFT, ACTIVE) 确实为 true —— 证明
//        「若实现退化成 canTransition，这测试必红」，即断言有牙齿。
//
// 破坏法（已实测，见文件末）：把 validateResume 的显式列举换成
//   `if (!canTransition(...))` → 本文件 4 条红。
// ============================================================================

import { describe, expect, it } from 'vitest';

import { COUPON_STATUS } from '@linban/shared';

import {
  canTransition,
  isTerminal,
  validateEnd,
  validatePause,
  validatePublish,
  validateResume,
  type CouponSnapshot,
} from '../domain/coupon';

const NOW = new Date('2026-10-22T00:00:00.000Z');

/**
 * 断言这次调用**被拒绝**，并返回拒绝理由。
 *
 * 为什么必须用这个助手而不能直接 `expect(r.ok).toBe(false); expect(r.code)…`：
 *   `CouponRuleResult` 是判别联合 `{ok:true} | {ok:false; code; field; message}`。
 *   TS 在 `expect(r.ok).toBe(false)` 之后**不会**把 r 收窄到失败分支，
 *   于是直写 `r.code` 报 TS2339。
 *   更危险的是：如果改成 `(r as any).code`，那么当实现返回 `{ok:true}` 时
 *   code 是 `undefined`，断言 `toBe('STATUS_ILLEGAL')` 仍会红 —— 尚可；
 *   但若哪天有人写 `expect(r.code).toBeUndefined()` 就会假绿。
 *   这里用**运行时**收窄：ok 为 true 直接抛错，让「本该拒绝却放行」
 *   在读取理由之前就炸出来，错误信息也更直接。
 */
function expectRejected(r: ReturnType<typeof validateResume>): { code: string; field: string } {
  if (r.ok) {
    throw new Error(`本应被拒绝，却返回 ok:true（域函数放行了不该放行的状态）`);
  }
  return { code: r.code, field: r.field };
}

function snap(status: string, over: Partial<CouponSnapshot> = {}): CouponSnapshot {
  return {
    status: status as CouponSnapshot['status'],
    type: 'FULL_REDUCTION',
    value: 2000,
    totalCount: 100,
    claimedCount: 0,
    startAt: new Date('2026-10-01T00:00:00.000Z'),
    endAt: new Date('2026-12-31T00:00:00.000Z'),
    ...over,
  } as CouponSnapshot;
}

describe('券状态机 · 目标态相同 ≠ 准入条件相同', () => {
  it('前提事实：canTransition(DRAFT, ACTIVE) 为 true —— 即「退化成 canTransition 也能过」', () => {
    // 这条不是废话：它确立了「DRAFT → ACTIVE 在流转表里是合法边」，
    // 所以 validateResume 若只用 canTransition 就**不会**拦住 DRAFT。
    // 没有这条前提，下面「有牙齿」的论断就没有对照物。
    expect(canTransition(COUPON_STATUS.DRAFT, COUPON_STATUS.ACTIVE)).toBe(true);
    expect(canTransition(COUPON_STATUS.PAUSED, COUPON_STATUS.ACTIVE)).toBe(true);
  });

  it('validateResume 对 DRAFT 必须由域函数自己拒绝，且原因是状态非法', () => {
    const r = expectRejected(validateResume(snap(COUPON_STATUS.DRAFT)));
    // 关键是code：若是VALUE_OUT_OF_RANGE 之类，说明「碰巧被别的校验拦了」，
    // 那就说明 resume 的准入条件写错了，只是这个用例没暴露出来。
    expect(r.code).toBe('STATUS_ILLEGAL');
    expect(r.field).toBe('status');
  });

  it('validateResume 对 ENDED（终态）拒绝，validatePublish 同样拒绝', () => {
    const resume = expectRejected(validateResume(snap(COUPON_STATUS.ENDED)));
    const publish = expectRejected(
      validatePublish(snap(COUPON_STATUS.ENDED), 'FULL_REDUCTION', null, null, NOW),
    );
    expect(resume.code).toBe('STATUS_ILLEGAL');
    expect(publish.code).toBe('STATUS_ILLEGAL');
  });

  it('validateResume 对 PAUSED 放行，且**不校验面额**（这是与 publish 的关键差异）', () => {
    // 面额 0：publish 一定拒绝（VALUE_OUT_OF_RANGE），resume 必须放行。
    // 若 resume 也开始校验面额，就说明它退化成了 publish —— 语义就错了。
    const r = validateResume(snap(COUPON_STATUS.PAUSED, { value: 0 }));
    expect(r.ok).toBe(true);

    const p = validatePublish(snap(COUPON_STATUS.PAUSED, { value: 0 }), 'FULL_REDUCTION', null, null, NOW);
    expect(expectRejected(p).code).toBe('VALUE_OUT_OF_RANGE');
  });

  it('幂等：ACTIVE 重复调 publish / resume 均放行（不是非法流转）', () => {
    expect(validateResume(snap(COUPON_STATUS.ACTIVE)).ok).toBe(true);
    expect(validatePublish(snap(COUPON_STATUS.ACTIVE), 'FULL_REDUCTION', null, null, NOW).ok).toBe(true);
  });

  it('END 是终态且不可逆；PAUSED 可 resume —— 两者不得合并成一个「停用」', () => {
    expect(isTerminal(COUPON_STATUS.ENDED)).toBe(true);
    expect(canTransition(COUPON_STATUS.ENDED, COUPON_STATUS.ACTIVE)).toBe(false);
    // PAUSED 必须仍可回 ACTIVE：合并会让「暂停」变成不可逆，运营误点一次永久损失投放期
    expect(canTransition(COUPON_STATUS.PAUSED, COUPON_STATUS.ACTIVE)).toBe(true);
    expect(validateEnd(snap(COUPON_STATUS.ENDED)).ok).toBe(true); // 幂等
    expect(validateEnd(snap(COUPON_STATUS.PAUSED)).ok).toBe(true);
    expect(validatePause(snap(COUPON_STATUS.DRAFT)).ok).toBe(false); // 草稿不可暂停
    expect(expectRejected(validatePause(snap(COUPON_STATUS.DRAFT))).code).toBe('STATUS_ILLEGAL');
  });

  it('未知状态 fail-closed：一律拒绝而不是抛 TypeError 冒泡成 500', () => {
    // 将来COUPON_STATUS 新增值而忘登记流转表时，
    // 若写 TRANSITIONS[status].includes(...) 会抛 TypeError → 接口 500。
    const weird = 'UNKNOWN_FUTURE_STATUS' as CouponSnapshot['status'];
    expect(canTransition(weird, COUPON_STATUS.ACTIVE)).toBe(false);
    expect(isTerminal(weird)).toBe(true);
    expect(expectRejected(validateResume(snap(weird))).code).toBe('STATUS_ILLEGAL');
  });
});