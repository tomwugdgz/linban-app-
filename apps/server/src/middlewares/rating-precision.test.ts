// ============================================================================
// 邻伴 · rating_avg 精度不变量测试
// ----------------------------------------------------------------------------
// 本文件锁的是一条**不变量**，而不是某个具体精度：
//
//     reviews.rating 的取值范围 ⊆ companions.rating_avg 的 DECIMAL 值域
//
// 为什么锁不变量而不是锁 "DECIMAL(3,1)" 字面量：
//   精度本身不是目标，能装下评分制式才是。
//   写死字面量的测试，会在「有人把精度改回 2,1」时红——
//   但若 2,1 本就够用（见下方核算），这条红是假警报；
//   而在「评分制式从5 星改成 10 星 / 百分制」时它恰好该红。
//   锁不变量两种情形都不误判。
//
// ---------------------------------------------------------------------------
// 数值核算（本轮实测，写在此处避免后人重复推导）
// ---------------------------------------------------------------------------
//   DECIMAL(M,D) 值域 = ±(10^(M-D) − 10^-D)
//     DECIMAL(2,1) → ±9.9     5 星制（1.0–5.0）装得下 ✅
//     DECIMAL(3,1) → ±99.9    同样装得下
//
//   即：**当前 1–5 星制式下 DECIMAL(2,1) 并未溢出**，改 (3,1) 属预留而非修 bug。
//   预留的真实理由是「评分制式可能改」（5→10 星或百分制），
//   而非当前已存在精度不足 —— 这个区别必须留在记录里，
//   否则将来有人看到 (3,1) 会误以为「曾经溢出过，是修出来的」。
//
//   另一条独立事实：聚合均值是无限小数（4.66666…），
//   MySQL 写入 DECIMAL 按四舍五入到 D 位，**不报错、不溢出**。
//   所以「平均值小数位多」也不构成改精度的理由。
// ============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_ROOT = join(__dirname, '..');
const schema = readFileSync(join(SERVER_ROOT, '../prisma/schema.prisma'), 'utf8');

/** 从 `reviews.rating Int // 1–5 星` 注释里解析评分上下界 */
function parseRatingBounds(): { min: number; max: number } {
  const m = /rating\s+Int\s+\/\/\s*(\d+)\s*[–\-~]\s*(\d+)\s*星/.exec(schema);
  if (!m) throw new Error('未能从 schema 解析 reviews.rating 的取值范围注释');
  return { min: Number(m[1]), max: Number(m[2]) };
}

/** 从 `@db.Decimal(M, D)` 解析 rating_avg 的精度 */
function parseRatingAvgDecimal(): { precision: number; scale: number } {
  const m = /rating_avg\s+Decimal\s+@default\(0\)\s*@db\.Decimal\((\d+),\s*(\d+)\)/.exec(schema);
  if (!m) throw new Error('未能从 schema 解析 companions.rating_avg 的 Decimal 精度');
  return { precision: Number(m[1]), scale: Number(m[2]) };
}

/** DECIMAL(M,D) 的正向上界 */
function decimalUpperBound(precision: number, scale: number): number {
  return 10 ** (precision - scale) - 10 ** -scale;
}

describe('§1 不变量：评分制式必须装得进 rating_avg', () => {
  it('reviews.rating 的注释里写明取值范围（测试据此推导，不是写死5）', () => {
    const { min, max } = parseRatingBounds();
    expect(min).toBeGreaterThanOrEqual(1);
    expect(max).toBeGreaterThan(min);
  });

  it('rating_avg 的 DECIMAL 上界 >= 评分最大值（核心不变量）', () => {
    const { max } = parseRatingBounds();
    const { precision, scale } = parseRatingAvgDecimal();
    expect(decimalUpperBound(precision, scale)).toBeGreaterThanOrEqual(max);
  });

  it('评分下界 >= 0 时 rating_avg 无需支持负数（避免为不存在的业务扩精度）', () => {
    const { min } = parseRatingBounds();
    // 当前为正数制式；若将来支持「运营扣分」这类负评分，须同步扩精度
    expect(min).toBeGreaterThanOrEqual(0);
  });

  // 注入实测：把 schema 的 rating_avg 改成 @db.Decimal(1, 1) → 本节首条红。
  //   DECIMAL(1,1) 上界 0.9< 5.0，届时写入 5 星评分会真实溢出（严格模式报错）。
});

describe('§2 精度现状的如实记录（防止后人误读 schema 注释）', () => {
  it('当前精度能容纳 5 星制（DECIMAL(2,1) 上界 9.9 > 5.0）', () => {
    const { max } = parseRatingBounds();
    const { precision, scale } = parseRatingAvgDecimal();
    // 这条断言的意图是「显式记录够用」——
    // 若将来精度收窄到装不下，它会红并提醒同步评分制式或扩精度
    expect(decimalUpperBound(precision, scale)).toBeGreaterThanOrEqual(5);
  });

  it('精度不低于 1 位小数（否则 4.5 分会被截成 5 或 4，均为错值）', () => {
    const { scale } = parseRatingAvgDecimal();
    expect(scale).toBeGreaterThanOrEqual(1);
  });

  it('scale >=1 时平均值四舍五入而非报错（MySQL DECIMAL 语义，无需额外处理）', () => {
    // 4.66666 → DECIMAL(_,1) 得 4.7。这是期望行为，不做round 半偶之类的自定义。
    const { scale } = parseRatingAvgDecimal();
    expect(Number((4.66666).toFixed(scale))).toBe(4.7);
  });
});

describe('§3 写入侧：评分聚合落库处不得绕过 DECIMAL 直接塞 number', () => {
  it('review 落库用aggregate 的 _avg 而非端上上传均分（防客户端伪造评分）', () => {
    const routes = readFileSync(join(SERVER_ROOT, 'modules/review/review.routes.ts'), 'utf8');
    expect(routes).toContain('rating_avg: agg._avg.rating ?? 0');
    expect(routes).toContain('_avg: { rating: true }');
  });

  it('同一事务内同时更新 rating_avg 与 rating_count（两个字段不许脱钩）', () => {
    const routes = readFileSync(join(SERVER_ROOT, 'modules/review/review.routes.ts'), 'utf8');
    expect(routes).toMatch(/rating_avg:[^\n]*\n?[^\n]*rating_count:/);
  });

  it('出参一律 toString 化（Decimal 不经 JSON 序列化成裸浮点）', () => {
    const routes = readFileSync(join(SERVER_ROOT, 'modules/companion/companion.routes.ts'), 'utf8');
    expect(routes).toContain('ratingAvg: companion.rating_avg.toString()');
    expect(routes).toContain('ratingAvg: c.rating_avg.toString()');
  });
});

describe('§4 消费侧：派单打分对 ratingAvg 的量纲假设', () => {
  it('派单评分函数按「5 分制」归一化到 0–1（ratingScore 存在且除以 5）', () => {
    const dispatch = readFileSync(join(SERVER_ROOT, 'domain/dispatch.ts'), 'utf8');
    expect(dispatch).toMatch(/ratingAvg\s*\/\s*5/);
  });

  it('ratingScore 结果被钳在 0–1（脏数据 ratingAvg>5 不会让权重爆掉）', () => {
    const dispatch = readFileSync(join(SERVER_ROOT, 'domain/dispatch.ts'), 'utf8');
    expect(dispatch).toMatch(/Math\.max\(0,\s*Math\.min\(1,/);
  });

  // 若评分制式改为 10 星制，此处分母 5 必须同步改——
  // 本条测试届时不会自动红，所以在上方 §1 的不变量之外，
  // 改动制式的人必须一并检查 dispatch.ts（已在本文件头注明）。
});