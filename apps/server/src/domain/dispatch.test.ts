// 派单打分单测：硬性过滤、距离衰减、标签命中、Top N 排序（架构 §6.1）
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_WEIGHTS,
  candidateEligible,
  creditScore,
  distanceScore,
  levelScore,
  rankDispatchCandidates,
  ratingScore,
  scoreDispatchCandidate,
  tagsScore,
} from './dispatch';
import type { DispatchCandidate } from './dispatch';

const candidate = (over: Partial<DispatchCandidate> = {}): DispatchCandidate => ({
  companionId: 1n,
  distanceM: 500,
  tags: ['粤语', '棋牌'],
  creditScore: 90,
  level: 3,
  ratingAvg: 4.5,
  completedOrders: 50,
  hourlyRateFen: 25000n,
  ...over,
});

describe('派单 · 硬性过滤', () => {
  it('信用分低于冻结阈值 → 出局', () => {
    expect(candidateEligible(candidate({ creditScore: 39 }))).toBe(false);
    expect(candidateEligible(candidate({ creditScore: 40 }))).toBe(true);
  });

  it('等级越界 1–5 → 出局', () => {
    expect(candidateEligible(candidate({ level: 0 }))).toBe(false);
    expect(candidateEligible(candidate({ level: 6 }))).toBe(false);
  });

  it('时薪超预算 → 出局', () => {
    expect(candidateEligible(candidate({ hourlyRateFen: 40000n }), { maxHourlyRateFen: 30000n })).toBe(false);
    expect(candidateEligible(candidate({ hourlyRateFen: 30000n }), { maxHourlyRateFen: 30000n })).toBe(true);
  });
});

describe('派单 · 分项打分', () => {
  it('距离分：full 内满分，超出半衰衰减', () => {
    expect(distanceScore(500, 1000, 3000)).toBe(1);
    expect(distanceScore(1000, 1000, 3000)).toBe(1);
    expect(distanceScore(1000 + 3000, 1000, 3000)).toBeCloseTo(0.5, 5);
    expect(distanceScore(10000, 1000, 3000)).toBeCloseTo(0.125, 5); // 超 3 个半衰：0.5^3
  });

  it('标签分：命中比例；无偏好中性 0.5', () => {
    expect(tagsScore(['粤语', '棋牌'], ['粤语', '散步'])).toBe(0.5);
    expect(tagsScore(['粤语'], ['粤语', '棋牌'])).toBe(0.5);
    expect(tagsScore(null, ['粤语'])).toBe(0);
    expect(tagsScore(['粤语'], null)).toBe(0.5);
  });

  it('信用/等级/评分分归一', () => {
    expect(creditScore(100)).toBe(1);
    expect(creditScore(60)).toBe(0.6);
    expect(levelScore(1)).toBe(0);
    expect(levelScore(5)).toBe(1);
    expect(ratingScore(5)).toBe(1);
    expect(ratingScore(4.5)).toBe(0.9);
  });

  it('权重合计 100', () => {
    const sum = Object.values(DISPATCH_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });
});

describe('派单 · 综合排序 Top N', () => {
  it('近 + 高分 > 远 + 低分', () => {
    const near = candidate({ companionId: 1n, distanceM: 200, creditScore: 95, level: 4, ratingAvg: 4.8 });
    const far = candidate({ companionId: 2n, distanceM: 8000, creditScore: 60, level: 1, ratingAvg: 3.5 });
    expect(scoreDispatchCandidate(near)).toBeGreaterThan(scoreDispatchCandidate(far));
  });

  it('rankDispatchCandidates 过滤冻结 + 排序 + 截断', () => {
    const list = [
      candidate({ companionId: 1n, distanceM: 200, creditScore: 95 }),
      candidate({ companionId: 2n, distanceM: 8000, creditScore: 39 }), // 冻结出局
      candidate({ companionId: 3n, distanceM: 1000, creditScore: 80 }),
      candidate({ companionId: 4n, distanceM: 5000, creditScore: 70 }),
      candidate({ companionId: 5n, distanceM: 9000, creditScore: 85 }),
      candidate({ companionId: 6n, distanceM: 20000, creditScore: 90 }),
    ];
    const top = rankDispatchCandidates(list, { preferredTags: ['粤语'] }, 3);
    expect(top).toHaveLength(3);
    expect(top.map((c) => c.companionId)).toEqual([1n, 3n, 4n]);
    expect(top.some((c) => c.companionId === 2n)).toBe(false);
  });

  it('分数相同时按 companionId 稳定排序', () => {
    const a = candidate({ companionId: 7n });
    const b = candidate({ companionId: 3n });
    const top = rankDispatchCandidates([a, b], {}, 5);
    expect(top[0]!.companionId).toBe(3n);
  });
});
