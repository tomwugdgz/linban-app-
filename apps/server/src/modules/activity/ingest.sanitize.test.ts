// 采集入口原文处理单测（PRD 红线②：SSID/BSSID/MAC 只落 HMAC，原文不出进程）
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALLOWED_FEATURE_KEYS,
  alignWindowStart,
  IngestSanitizeError,
  RETENTION_DAYS_HARD_CAP,
  normalizeNetworkIdentity,
  redactFeatureLog,
  toPersistenceFeatures,
} from './ingest.sanitize';
import type { RawIngestPayload } from './ingest.sanitize';

// HMAC 化需要密钥（业务代码禁止内置默认密钥，测试在环境里给一把）
beforeAll(() => {
  process.env.CRYPTO_HMAC_KEY = Buffer.alloc(32, 7).toString('base64');
});

const raw = (over: Partial<RawIngestPayload> = {}): RawIngestPayload => ({
  ssid: 'TP-LINK_5G',
  bssid: 'a4:2b:b0:11:22:33',
  mac: 'AA-BB-CC-DD-EE-FF',
  window_start: new Date('2026-10-20T08:00:00.000Z'),
  window_minutes: 60,
  features: {
    windowMinutes: 60,
    activeMinutes: 42,
    networkSwitchCount: 5,
    connectionStability: 0.9,
    activityCount: 300,
  },
  ...over,
});

describe('网络标识归一 · normalizeNetworkIdentity', () => {
  it('BSSID 去分隔符并大写（同一设备两种写法 →同一盲索引）', () => {
    const a = normalizeNetworkIdentity('BSSID', 'a4:2b:b0:11:22:33');
    const b = normalizeNetworkIdentity('BSSID', 'A4-2B-B0-11-22-33');
    expect(a.ok && b.ok).toBe(true);
    expect(a.hmac).toBe(b.hmac);
  });

  it('MAC 同理归一；不同设备 → 不同盲索引', () => {
    const a = normalizeNetworkIdentity('MAC', 'aa:bb:cc:dd:ee:ff');
    const b = normalizeNetworkIdentity('MAC', 'AA-BB-CC-DD-EE-FF');
    const c = normalizeNetworkIdentity('MAC', '11:22:33:44:55:66');
    expect(a.hmac).toBe(b.hmac);
    expect(a.hmac).not.toBe(c.hmac);
  });

  it('SSID 仅去首尾空白（大小写/空格可能有语义，不激进归一）', () => {
    const a = normalizeNetworkIdentity('SSID', '  Home-Net  ');
    const b = normalizeNetworkIdentity('SSID', 'home-net');
    expect(a.hmac).not.toBe(b.hmac);
    expect(normalizeNetworkIdentity('SSID', '   ').ok).toBe(false);
  });

  it('出参结构上不含原文字段', () => {
    const r = normalizeNetworkIdentity('SSID', 'MyHomeWiFi');
    expect(Object.keys(r).sort()).toEqual(['hmac', 'kind', 'ok']);
    expect(JSON.stringify(r)).not.toContain('MyHomeWiFi');
  });

  it('盲索引为 hex64 且不可逆（不含原文子串）', () => {
    const r = normalizeNetworkIdentity('SSID', 'ZhangSanHome');
    expect(r.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(r.hmac).not.toContain('ZhangSan');
  });
});

describe('落库前清洗 · toPersistenceFeatures', () => {
  it('出参只含 hmac 字段，原文不出结构', () => {
    const s = toPersistenceFeatures(raw(), 14);
    expect(s.ssid_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(s.bssid_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(s.mac_hmac).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain('TP-LINK_5G');
    expect(serialized).not.toContain('a4:2b:b0');
  });

  it('禁原始字段：CSI/波形/音视频/定位一律拒绝并抛 22004 语义错误', () => {
    for (const k of ['csi', 'waveform', 'audio', 'gps', 'latitude']) {
      expect(() => toPersistenceFeatures(raw({ features: { [k]: 1 } } as never), 14)).toThrow(
        IngestSanitizeError,
      );
    }
  });

  it('ssid/bssid/mac 出现在 features 内视为绕过 HMAC 化 → 拒绝（顶层才允许）', () => {
    for (const k of ['ssid', 'bssid', 'mac']) {
      expect(() => toPersistenceFeatures(raw({ features: { [k]: 'x' } } as never), 14)).toThrow(
        IngestSanitizeError,
      );
    }
  });

  it('派生特征走白名单：未放行的键即使合法也拒（防端上新传敏感字段）', () => {
    expect(() => toPersistenceFeatures(raw({ features: { newSensitiveField: 1 } } as never), 14)).toThrow(
      IngestSanitizeError,
    );
    // 白名单内的键全部放行
    const all: Record<string, number> = {};
    for (const k of ALLOWED_FEATURE_KEYS) all[k] = 1;
    expect(() => toPersistenceFeatures(raw({ features: all }), 14)).not.toThrow();
  });

  it('非法数值（NaN/负数/非数）→ 拒', () => {
    expect(() => toPersistenceFeatures(raw({ features: { activeMinutes: -1 } }), 14)).toThrow(IngestSanitizeError);
    expect(() => toPersistenceFeatures(raw({ features: { activeMinutes: Number.NaN } }), 14)).toThrow(
      IngestSanitizeError,
    );
    expect(() => toPersistenceFeatures(raw({ window_minutes: 0 }), 14)).toThrow(IngestSanitizeError);
  });

  it('错误信息只含字段名，绝不含入参值（防日志泄漏）', () => {
    try {
      toPersistenceFeatures(raw({ features: { ssidRawLeak: 'x' } } as never), 14);
      throw new Error('应当抛出');
    } catch (e) {
      expect(e).toBeInstanceOf(IngestSanitizeError);
      expect((e as IngestSanitizeError).field).toBe('ssidRawLeak');
      expect((e as Error).message).not.toContain('x"');
    }
  });

  it('留存天数受硬上限 14 约束（配置调大也按14 截断，红线不可配大）', () => {
    const s = toPersistenceFeatures(raw(), 999);
    const expected = new Date(
      raw().window_start!.getTime() + 60 * 60000 + RETENTION_DAYS_HARD_CAP * 86400000,
    );
    expect(s.retained_until.getTime()).toBe(expected.getTime());
  });

  it('空SSID/BSSID/MAC → hmac 落 null（不落空字符串）', () => {
    const s = toPersistenceFeatures(raw({ ssid: null, bssid: undefined, mac: '' }), 14);
    expect(s.ssid_hmac).toBeNull();
    expect(s.bssid_hmac).toBeNull();
    expect(s.mac_hmac).toBeNull();
  });
});

describe('日志脱敏 · redactFeatureLog', () => {
  it('输出白名单字段，且 HMAC 只留前 8 位', () => {
    const s = toPersistenceFeatures(raw(), 14);
    const log = redactFeatureLog(s);
    expect(Object.keys(log).sort()).toEqual([
      'bssid_hmac_prefix',
      'feature_count',
      'features',
      'mac_hmac_prefix',
      'retained_until',
      'ssid_hmac_prefix',
      'window_minutes',
      'window_start',
    ]);
    expect(String(log.ssid_hmac_prefix)).toHaveLength(8);
  });

  it('脱敏后仍不含任何原文（可安全进日志）', () => {
    const log = redactFeatureLog(toPersistenceFeatures(raw(), 14));
    const dumped = JSON.stringify(log);
    for (const secret of ['TP-LINK_5G', 'a4:2b:b0:11:22:33', 'AA-BB-CC-DD-EE-FF']) {
      expect(dumped).not.toContain(secret);
    }
  });

  it('完整 64 位 HMAC 不进日志（防指纹反查）', () => {
    const s = toPersistenceFeatures(raw(), 14);
    const dumped = JSON.stringify(redactFeatureLog(s));
    expect(dumped).not.toContain(s.ssid_hmac);
  });
});
// ---------------------------------------------------------------------------
describe('窗口对齐 · alignWindowStart（幂等唯一键成立的前提）', () => {
  it('同一窗口内不同毫秒 → 对齐后相等（这正是唯一索引要拦的抖动）', () => {
    const a = alignWindowStart(new Date('2026-10-20T10:00:00.123Z'), 5);
    const b = alignWindowStart(new Date('2026-10-20T10:00:00.456Z'), 5);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('跨窗口（10:04:59 与 10:05:00，5 分钟粒度）→ 对齐后不同', () => {
    const before = alignWindowStart(new Date('2026-10-20T10:04:59.999Z'), 5);
    const after = alignWindowStart(new Date('2026-10-20T10:05:00.000Z'), 5);
    expect(before.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(after.toISOString()).toBe('2026-10-20T10:05:00.000Z');
    expect(before.getTime()).not.toBe(after.getTime());
  });

  it('整点边界本身就精确对齐（不偏移）', () => {
    expect(alignWindowStart(new Date('2026-10-20T10:05:00.000Z'), 5).toISOString()).toBe(
      '2026-10-20T10:05:00.000Z',
    );
    expect(alignWindowStart(new Date('2026-10-20T10:00:00.000Z'), 60).toISOString()).toBe(
      '2026-10-20T10:00:00.000Z',
    );
  });

  it('向下取整，不推到未来窗口（不会把数据挪到下一段）', () => {
    // 10:04:59 在 10:00–10:05 段内，不应被推到 10:05
    const t = alignWindowStart(new Date('2026-10-20T10:04:59.000Z'), 5);
    expect(t.getUTCMinutes()).toBe(0);
    expect(t.getTime()).toBeLessThanOrEqual(new Date('2026-10-20T10:04:59.000Z').getTime());
  });

  it('不同粒度（1 / 5 / 15 / 60 分钟）各自对齐到对应边界', () => {
    const src = new Date('2026-10-20T10:07:33.777Z');
    // 1 分钟粒度同样对齐到整分钟（秒与毫秒归零）——这才是幂等所需
    expect(alignWindowStart(src, 1).toISOString()).toBe('2026-10-20T10:07:00.000Z');
    expect(alignWindowStart(src, 5).toISOString()).toBe('2026-10-20T10:05:00.000Z');
    expect(alignWindowStart(src, 15).toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(alignWindowStart(src, 60).toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });

  it('跨小时/跨天边界正确', () => {
    expect(alignWindowStart(new Date('2026-10-20T23:59:59.999Z'), 5).toISOString()).toBe(
      '2026-10-20T23:55:00.000Z',
    );
    expect(alignWindowStart(new Date('2026-10-21T00:00:00.001Z'), 5).toISOString()).toBe(
      '2026-10-21T00:00:00.000Z',
    );
  });

  it('非法粒度 → 抛错（不静默通过）', () => {
    expect(() => alignWindowStart(new Date(), 0)).toThrow(IngestSanitizeError);
    expect(() => alignWindowStart(new Date(), -5)).toThrow(IngestSanitizeError);
    expect(() => alignWindowStart(new Date(), Number.NaN)).toThrow(IngestSanitizeError);
  });

  it('toPersistenceFeatures 出参的 window_start 已对齐（顺序：对齐→HMAC→落库）', () => {
    const s1 = toPersistenceFeatures(
      raw({ window_start: new Date('2026-10-20T10:00:00.123Z'), window_minutes: 5 }),
      14,
    );
    const s2 = toPersistenceFeatures(
      raw({ window_start: new Date('2026-10-20T10:00:00.456Z'), window_minutes: 5 }),
      14,
    );
    expect(s1.window_start.getTime()).toBe(s2.window_start.getTime());
    expect(s1.window_start.toISOString()).toBe('2026-10-20T10:00:00.000Z');
  });
});
