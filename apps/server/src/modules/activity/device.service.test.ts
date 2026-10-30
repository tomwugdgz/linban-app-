// 探针绑定单测（契约 §13.3：先授权后绑设备；幂等；明文令牌只返一次）
// DB 侧（授权门闩/守卫列/唯一索引）由 service 层保证，本文件覆盖可纯测的决策逻辑
// 与「明文令牌绝不复现」这类安全性质。
import { beforeAll, describe, expect, it } from 'vitest';
import { wifi_device_type } from '@prisma/client';
import {
  BINDABLE_DEVICE_TYPES,
  genDeviceNo,
  genDeviceToken,
  macToHmac,
  normalizeInterval,
  DEVICE_TOKEN_TTL_DAYS,
} from './device.service';

beforeAll(() => {
  process.env.CRYPTO_HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('device_no 生成', () => {
  it('格式为 WFD + yyyyMMdd + 10 位大写 hex，且长度不超 schema 的 VarChar(32)', () => {
    const no = genDeviceNo(new Date('2026-10-20T08:00:00.000Z'));
    expect(no).toMatch(/^WFD20261020[0-9A-F]{10}$/);
    expect(no.length).toBeLessThanOrEqual(32);
  });

  it('同一时刻多次生成不重复（随机源非时间戳）', () => {
    const now = new Date('2026-10-20T08:00:00.000Z');
    const set = new Set(Array.from({ length: 200 }, () => genDeviceNo(now)));
    expect(set.size).toBe(200);
  });

  it('跨 UTC 日界日前缀日期不同（避免按日分片撞号）', () => {
    const a = genDeviceNo(new Date('2026-10-20T23:59:59.000Z'));
    const b = genDeviceNo(new Date('2026-10-21T00:00:00.000Z'));
    expect(a.slice(3, 11)).toBe('20261020');
    expect(b.slice(3, 11)).toBe('20261021');
  });
});

describe('设备令牌', () => {
  it('为 32 字节随机（base64url 43 字符），多次生成不重复', () => {
    const set = new Set(Array.from({ length: 200 }, () => genDeviceToken()));
    expect(set.size).toBe(200);
    for (const t of set) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('明文令牌长度落在 device_token_hash 的 VarChar(64) 之内（哈希后）', async () => {
    const { hashDeviceToken } = await import('./ingest.service');
    for (let i = 0; i < 50; i += 1) {
      expect(hashDeviceToken(genDeviceToken()).length).toBe(64);
    }
  });

  it('有效期为正且不超过一年（过长会让吊销形同虚设）', () => {
    expect(DEVICE_TOKEN_TTL_DAYS).toBeGreaterThan(0);
    expect(DEVICE_TOKEN_TTL_DAYS).toBeLessThanOrEqual(365);
  });
});

describe('MAC HMAC 化（红线②：原文不出库）', () => {
  it('返回 64位 hex 而非原文', () => {
    const hmac = macToHmac('AA:BB:CC:DD:EE:FF');
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac).not.toContain('AA');
  });

  it('分隔符差异归一后同 MAC 得同一 HMAC（可做同家识别）', () => {
    expect(macToHmac('aa:bb:cc:dd:ee:ff')).toBe(macToHmac('AA-BB-CC-DD-EE-FF'));
    expect(macToHmac('aabbccddeeff')).toBe(macToHmac('AA:BB:CC:DD:EE:FF'));
  });

  it('不同 MAC 得不同 HMAC', () => {
    expect(macToHmac('AA:BB:CC:DD:EE:FF')).not.toBe(macToHmac('AA:BB:CC:DD:EE:00'));
  });

  it('空/非法输入返回 null（MAC 是可选字段，不因此中断绑定）', () => {
    expect(macToHmac(null)).toBeNull();
    expect(macToHmac(undefined)).toBeNull();
    expect(macToHmac('')).toBeNull();
    expect(macToHmac('   ')).toBeNull();
  });
});

describe('心跳间隔归一', () => {
  it('缺省 60 秒', () => {
    expect(normalizeInterval(null)).toBe(60);
    expect(normalizeInterval(undefined)).toBe(60);
  });

  it('区间内 [15, 3600] 原值通过', () => {
    expect(normalizeInterval(15)).toBe(15);
    expect(normalizeInterval(60)).toBe(60);
    expect(normalizeInterval(3600)).toBe(3600);
  });

  it('越界回落缺省（不让端上把心跳打到1 秒耗垮库）', () => {
    expect(normalizeInterval(14)).toBe(60);
    expect(normalizeInterval(3601)).toBe(60);
    expect(normalizeInterval(0)).toBe(60);
    expect(normalizeInterval(-30)).toBe(60);
  });

  it('非有限值与小数安全处理', () => {
    expect(normalizeInterval(Number.NaN)).toBe(60);
    expect(normalizeInterval(Number.POSITIVE_INFINITY)).toBe(60);
    expect(normalizeInterval(60.9)).toBe(60);
    expect(normalizeInterval(120.7)).toBe(120);
  });
});

describe('可绑定设备类型白名单', () => {
  it('MVP 只开放 APP_PROBE（通道B 网关为 W+1）', () => {
    expect(BINDABLE_DEVICE_TYPES).toEqual([wifi_device_type.APP_PROBE]);
  });

  it('GATEWAY 明确不在白名单（不得静默降级为绑定成功）', () => {
    expect(BINDABLE_DEVICE_TYPES).not.toContain(wifi_device_type.GATEWAY);
  });
});