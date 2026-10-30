// 信用分规则单测：加减项、clamp 边界、限流/冻结阈值（架构 §8.3）
import { describe, expect, it } from 'vitest';
import {
  MANUAL_DELTA_MAX,
  applyCreditChange,
  applyCreditChangeByType,
  assertValidScore,
  fixedDelta,
  isFrozen,
  isLimited,
  requiresBan,
} from './credit-rules';

describe('信用分 · 固定事由分值（§8.3）', () => {
  it('好评 +1 / 差评 −3 / 取消 −2 / 私聊违规 −5 / 飞单 −20', () => {
    expect(fixedDelta('GOOD_REVIEW')).toBe(1);
    expect(fixedDelta('BAD_REVIEW')).toBe(-3);
    expect(fixedDelta('CANCEL')).toBe(-2);
    expect(fixedDelta('IM_VIOLATION')).toBe(-5);
    expect(fixedDelta('FLY_ORDER')).toBe(-20);
  });

  it('MANUAL/SYSTEM 无固定分值（须显式输入，审计可回放）', () => {
    expect(fixedDelta('MANUAL')).toBeNull();
    expect(fixedDelta('SYSTEM')).toBeNull();
    expect(() => applyCreditChangeByType(80, 'MANUAL')).toThrowError(/无固定分值/);
  });

  it('按事由应用：80 分好评 → 81', () => {
    const r = applyCreditChangeByType(80, 'GOOD_REVIEW');
    expect(r.after).toBe(81);
    expect(r.change).toBe(1);
    expect(r.limited).toBe(false);
    expect(r.frozen).toBe(false);
  });

  it('飞单坐实 → requiresBan（§8.3「−20 并清退」）', () => {
    expect(requiresBan('FLY_ORDER')).toBe(true);
    expect(requiresBan('BAD_REVIEW')).toBe(false);
  });
});

describe('信用分 · 边界 clamp 与校验', () => {
  it('满分封顶拒绝越界（100 + 1 → 抛错，服务层应先 clamp 或拒绝）', () => {
    expect(() => applyCreditChange(100, 1)).toThrowError(/越界/);
  });

  it('触底拒绝越界（0 − 1 → 抛错）', () => {
    expect(() => applyCreditChange(0, -1)).toThrowError(/越界/);
  });

  it('恰好到界合法（100 + 0 / 0 + 0）', () => {
    expect(applyCreditChange(100, 0).after).toBe(100);
    expect(applyCreditChange(0, 0).after).toBe(0);
  });

  it('非法初值（负数/超 100/非整数）→ 拒绝', () => {
    expect(() => applyCreditChange(-1, 1)).toThrowError(/非法/);
    expect(() => applyCreditChange(101, -1)).toThrowError(/非法/);
    expect(() => applyCreditChange(80.5, 1)).toThrowError(/非法/);
  });

  it('非整数变更量 → 拒绝', () => {
    expect(() => applyCreditChange(80, 1.5)).toThrowError(/整数/);
  });

  it('assertValidScore 校验 0–100 整数', () => {
    expect(() => assertValidScore(0)).not.toThrow();
    expect(() => assertValidScore(100)).not.toThrow();
    expect(() => assertValidScore(101)).toThrowError(/非法/);
    expect(() => assertValidScore(-5)).toThrowError(/非法/);
  });
});

describe('信用分 · 限流/冻结阈值（<60 限流 / <40 冻结）', () => {
  it('60 → 正常；59 → 限流；40 → 限流；39 → 冻结', () => {
    expect(applyCreditChangeByType(59, 'GOOD_REVIEW').limited).toBe(false); // 60
    expect(applyCreditChangeByType(59, 'CANCEL').limited).toBe(true); // 57
    expect(applyCreditChangeByType(39, 'GOOD_REVIEW').limited).toBe(true); // 40
    expect(applyCreditChangeByType(39, 'CANCEL').frozen).toBe(true); // 37
  });

  it('阈值边界直接判定', () => {
    expect(isLimited(60)).toBe(false);
    expect(isLimited(59)).toBe(true);
    expect(isLimited(40)).toBe(true);
    expect(isFrozen(40)).toBe(false);
    expect(isFrozen(39)).toBe(true);
    expect(isFrozen(0)).toBe(true);
  });

  it('自定义阈值：58−1=57 分在 limit=50 下不限流', () => {
    const r = applyCreditChange(58, -1, { limit: 50, freeze: 30 });
    expect(r.after).toBe(57);
    expect(r.limited).toBe(false);
    expect(r.frozen).toBe(false);
  });
});

describe('信用分 · 手工调整', () => {
  it('MANUAL_DELTA_MAX = 20（单次手工上限）', () => {
    expect(MANUAL_DELTA_MAX).toBe(20);
  });

  it('手工 +5 从 55 → 60 跨过限流线', () => {
    const r = applyCreditChange(55, 5);
    expect(r.after).toBe(60);
    expect(r.limited).toBe(false);
  });

  it('手工 −20 从 45 → 25 进入冻结', () => {
    const r = applyCreditChange(45, -20);
    expect(r.after).toBe(25);
    expect(r.frozen).toBe(true);
  });
});
