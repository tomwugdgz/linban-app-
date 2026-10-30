// ============================================================================
// 采集入库 · 并发幂等与窗口粒度裁决单测
// ----------------------------------------------------------------------------
// 覆盖两件事：
//   1. isUniqueViolation —— P2002 识别（并发幂等的判据）；
//   2. resolveWindowMinutes —— 窗口粒度以设备配置为准（主理人裁定）。
//
// 为什么这两件都要单测：
//   · P2002 漏判→ 上报端收500 → 诱发重试风暴；误判 → 吞掉真实DB 错误，
//     变成「静默丢数据」，后者更危险（数据少了但没人知道）。
//   · 窗口粒度若回落端上传参，「设备级固化」就形同虚设 —— 同一物理时刻会被
//     切成两个窗口，唯一键挡不住，日聚合重复计数。
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  isUniqueViolation,
  resolveWindowMinutes,
  WINDOW_MINUTES_MAX,
  WINDOW_MINUTES_MIN,
} from './ingest.service';

describe('isUniqueViolation（P2002 识别）', () => {
  it('识别标准 Prisma 唯一约束错误对象', () => {
    expect(isUniqueViolation({ code: 'P2002', meta: { target: ['device_id', 'window_start'] } })).toBe(true);
  });

  it('其他 Prisma 错误码不算唯一冲突（不得误吞）', () => {
    for (const code of ['P2003', 'P2014', 'P2025', 'P1008', 'P2000']) {
      expect(isUniqueViolation({ code })).toBe(false);
    }
  });

  it('非对象入参不算（null/undefined/字符串/数字）', () => {
    for (const v of [null, undefined, 'P2002', 2002, true, []]) {
      expect(isUniqueViolation(v)).toBe(false);
    }
  });

  it('普通 Error 不算——没有 code 就是不是', () => {
    expect(isUniqueViolation(new Error('Unique constraint failed'))).toBe(false);
  });

  it('其他字段名叫 code 但值为 P2002 才算（只看 code，不看 message）', () => {
    // 防「按message 文本匹配」的错误实现：文案随版本变，按文本判会漏
    expect(isUniqueViolation({ code: 'P2002', message: 'whatever new wording' })).toBe(true);
    expect(isUniqueViolation({ message: 'Unique constraint failed on the fields' })).toBe(false);
  });
});

describe('resolveWindowMinutes（设备级固化，主理人裁定）', () => {
  it('一致时不记漂移（正常路径静默）', () => {
    expect(resolveWindowMinutes(5, 5)).toEqual({ effective: 5, drifted: false });
  });

  it('不一致时以设备为准 + 标记漂移（端上传参被忽略）', () => {
    expect(resolveWindowMinutes(5, 60)).toEqual({ effective: 5, drifted: true });
    expect(resolveWindowMinutes(60, 5)).toEqual({ effective: 60, drifted: true });
  });

  it('设备配置缺失/非法 → 回落 5，且不回落端上传参', () => {
    // 这是关键：若这里回落 60，「设备级固化」就被端上绕过了
    expect(resolveWindowMinutes(null, 60)).toEqual({ effective: 5, drifted: true });
    expect(resolveWindowMinutes(undefined, 1440)).toEqual({ effective: 5, drifted: true });
  });

  it('设备配置越界（0/负数/超上限/小数）→ 回落 5', () => {
    for (const bad of [0, -5, 1441, 5.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveWindowMinutes(bad, 5).effective).toBe(5);
    }
  });

  it('端上传参非法但设备合法 → 取设备，不漂移（无意义的入参不算漂移）', () => {
    expect(resolveWindowMinutes(15, 0)).toEqual({ effective: 15, drifted: false });
    expect(resolveWindowMinutes(15, null)).toEqual({ effective: 15, drifted: false });
  });

  it('端上传参缺失 → 取设备，不漂移', () => {
    expect(resolveWindowMinutes(5, undefined)).toEqual({ effective: 5, drifted: false });
  });

  it('两侧都缺失 → 5/5/不漂移', () => {
    expect(resolveWindowMinutes(null, null)).toEqual({ effective: 5, drifted: false });
  });

  it('区间边界值合法（1 与 1440）', () => {
    expect(resolveWindowMinutes(WINDOW_MINUTES_MIN, 1).effective).toBe(1);
    expect(resolveWindowMinutes(WINDOW_MINUTES_MAX, 1440).effective).toBe(1440);
  });

  it('同一设备不同端上报 → 落库粒度恒定（同一物理时刻不会被切成两个窗口）', () => {
    // 模拟端 A 报 5 分钟、端 B 报 60 分钟，设备配置为 5
    const a = resolveWindowMinutes(5, 5);
    const b = resolveWindowMinutes(5, 60);
    expect(a.effective).toBe(b.effective);
  });
});