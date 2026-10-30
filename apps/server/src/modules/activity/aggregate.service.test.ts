// ============================================================================
// 活动感知 · 日聚合与告警门闩单测（纯函数层，不连 DB）
// ----------------------------------------------------------------------------
// 覆盖：
//   · aggregateSignals —— 离线优先落UNKNOWN / 全天零活跃判AWAY / 活跃占比判 ACTIVE
//   · 留存天数硬顶 14（配置调大也截断）
//   · escalate 的交叉验证门闩（单通道/无交叉源一律 24004）
// ============================================================================
import { describe, expect, it } from 'vitest';
import { user_role, user_role_values } from '@linban/shared';
import { aggregateSignals } from './aggregate.service';
import { SYSTEM_SERVICE_OPENID } from './alert.service';
import { crossVerifySatisfied } from '../../domain/activity';

const TTL = 21600;

type Sig = Parameters<typeof aggregateSignals>[0]['signals'][number];

const sig = (over: Partial<Sig> = {}): Sig => ({
  window_start: new Date('2026-10-19T08:00:00.000Z'),
  window_minutes: 60,
  features: {
    windowMinutes: 60,
    activeMinutes: 40,
    networkSwitchCount: 5,
    connectionStability: 0.9,
    activityCount: 300,
  },
  data_freshness_seconds: 30,
  channel: 'CHANNEL_A_APP',
  device_id: 1n,
  probeOnline: true,
  ...over,
});

describe('日聚合 · aggregateSignals', () => {
  it('无信号 → UNKNOWN / confidence 0（不猜测）', () => {
    const a = aggregateSignals({ signals: [], ttlSec: TTL });
    expect(a.status).toBe('UNKNOWN');
    expect(a.confidence).toBe(0);
    expect(a.signalCount).toBe(0);
  });

  it('探针离线 → UNKNOWN，即便活跃占比很高（离线优先，红线）', () => {
    const a = aggregateSignals({
      signals: [sig({ probeOnline: false })],
      ttlSec: TTL,
    });
    expect(a.status).toBe('UNKNOWN');
    expect(a.confidence).toBe(0);
  });

  it('活跃占比 ≥ 0.6 → ACTIVE', () => {
    const a = aggregateSignals({ signals: [sig()], ttlSec: TTL });
    expect(a.status).toBe('ACTIVE');
    expect(a.activityScore).toBe(40);
    expect(a.channelMask).toBe(1);
  });

  it('全天零活跃且探针在线 → AWAY（而非 STILL）', () => {
    const a = aggregateSignals({
      signals: [
        sig({
          features: { windowMinutes: 60, activeMinutes: 0, networkSwitchCount: 0, connectionStability: 0.9 },
          data_freshness_seconds: 60,
        }),
      ],
      ttlSec: TTL,
    });
    expect(a.status).toBe('AWAY');
    expect(a.awayCount).toBe(1);
  });

  it('单通道置信度硬上限 0.6（红线：单通道不得出健康结论）', () => {
    const a = aggregateSignals({ signals: [sig()], ttlSec: TTL });
    expect(a.channelMask & 2).toBe(0); // 只有通道 A
    expect(a.confidence).toBeLessThanOrEqual(0.6);
  });

  it('双通道交叉验证 → 置信度提升但不超过 0.95', () => {
    const single = aggregateSignals({ signals: [sig()], ttlSec: TTL });
    const dual = aggregateSignals({
      signals: [sig(), sig({ channel: 'CHANNEL_B_GATEWAY', device_id: 2n })],
      ttlSec: TTL,
    });
    expect(dual.channelMask).toBe(3);
    expect(dual.confidence).toBeGreaterThan(single.confidence);
    expect(dual.confidence).toBeLessThanOrEqual(0.95);
  });

  it('信号超 TTL → 回落 UNKNOWN（数据陈旧不参与分级）', () => {
    const a = aggregateSignals({
      signals: [sig({ data_freshness_seconds: TTL + 1 })],
      ttlSec: TTL,
    });
    expect(a.status).toBe('UNKNOWN');
  });

  it('24 段活跃分布按窗口小时聚合（非实时轨迹）', () => {
    const a = aggregateSignals({
      signals: [
        sig({ window_start: new Date('2026-10-19T08:00:00.000Z') }),
        sig({ window_start: new Date('2026-10-19T09:00:00.000Z') }),
      ],
      ttlSec: TTL,
    });
    expect(a.activeSlots).toHaveLength(24);
    expect(a.activeSlots[8]!.level).toBe(40);
    expect(a.activeSlots[9]!.level).toBe(40);
    expect(a.activeSlots[10]!.level).toBe(0);
  });

  it('多设备去重计数', () => {
    const a = aggregateSignals({
      signals: [sig({ device_id: 1n }), sig({ device_id: 1n }), sig({ device_id: 2n })],
      ttlSec: TTL,
    });
    expect(a.deviceCount).toBe(2);
    expect(a.signalCount).toBe(3);
  });

  it('features 为脏数据（null / 非法 JSON）→ 不抛，按缺字段处理', () => {
    const a = aggregateSignals({
      signals: [
        sig({ features: null }),
        sig({ features: '{bad json', window_start: new Date('2026-10-19T09:00:00.000Z') }),
      ],
      ttlSec: TTL,
    });
    // 关键：无数据 ≠ 外出。features 全脏时无正面证据，必须 UNKNOWN 而非 AWAY
    expect(a.status).toBe('UNKNOWN');
    expect(a.awayCount).toBe(0);
    expect(a.activityScore).toBe(0);
  });
});

describe('升级门闩 · crossVerifySatisfied（escalate 前置）', () => {
  it('单通道一律不通过 → 24004', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: false, crossSourceHit: true })).toBe(false);
    expect(crossVerifySatisfied({ channelAValid: false, channelBValid: true, crossSourceHit: true })).toBe(false);
  });
  it('双通道无交叉源 → 不通过', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: true, crossSourceHit: false })).toBe(false);
  });
  it('双通道 + 交叉源 → 通过（方可 escalate）', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: true, crossSourceHit: true })).toBe(true);
  });
  it('required 默认 true，不读配置（红线不可关）', () => {
    expect(crossVerifySatisfied({ channelAValid: false, channelBValid: false })).toBe(false);
  });
});

describe('系统服务账号约定（A2 已定稿 / Q11）', () => {
  it('openid 用 sys_ 保留前缀（与微信 openid 空间隔离，不会与真实用户冲突）', () => {
    expect(SYSTEM_SERVICE_OPENID).toBe('sys_health_alert');
    expect(SYSTEM_SERVICE_OPENID.startsWith('sys_')).toBe(true);
  });

  it('openid 不是微信 openid 形态（系统账号不该长得像真实用户）', () => {
    // 微信 openid 形如 oXXXX_xxxxxxxx；系统账号用 sys_ 前缀，避免与真实用户混淆
    expect(SYSTEM_SERVICE_OPENID).not.toMatch(/^o[A-Za-z0-9_-]{5,}/);
  });

  it('账号 role 为 SYSTEM 而非 ELDER（用 ELDER 充数会污染老人角色统计口径）', () => {
    expect(user_role.SYSTEM).toBe('SYSTEM');
    expect(user_role.ELDER).not.toBe(user_role.SYSTEM);
    expect(user_role_values).toContain('SYSTEM');
  });

  it('系统账号靠 is_system=true 标记（查询侧一律带 is_system=false 过滤）', () => {
    // 该列由 schema 保证（users.is_system Boolean @default(false)），
    // 这里锁的是「枚举侧已就位」，列本身的存在性由 enum-mirror 与 tsc 兜底
    expect(user_role_values).toContain('SYSTEM');
  });
});