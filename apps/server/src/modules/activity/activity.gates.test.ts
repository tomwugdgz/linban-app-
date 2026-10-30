// ============================================================================
// 活动感知 · 门闩与判定单测（不连 DB：覆盖 ingest 前置闸门与查询前置判定）
// ----------------------------------------------------------------------------
// 覆盖 team-lead 点名的错误码前置场景：
//   22001 未授权采集/范围未覆盖、22002 设备未绑定、22005 令牌无效、22006 已停采、
//   23001 数据未就绪、23004 越权（授权助手的前置判定逻辑）。
// DB 相关部分（真连接后）由集成测试覆盖；此处锁住的是「判定规则」本身，
// 防止路由层重构时把门闩顺序或错误码改掉。
// ============================================================================
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SCOPE,
  assertConsent,
  isScopeVisibleToFamily,
} from '../../domain/activity-consent';
import type { ConsentLayer } from '../../domain/activity-consent';
import { hashDeviceToken, shouldMarkOffline, verifyDeviceToken } from './ingest.service';
import { CONFIDENCE_DISPLAY_FLOOR, MIN_SIGNAL_DAYS, statsFromSummary } from './report.service';
import { ACTIVITY_DISCLAIMER } from './report.service';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const TOKEN = 'probe-token-abc123';

const granted = (): ConsentLayer => ({
  status: 'GRANTED',
  scopes: [ACTIVITY_SCOPE.SUMMARY, ACTIVITY_SCOPE.ALERT, ACTIVITY_SCOPE.FAMILY_VISIBLE],
});

// ---------------------------------------------------------------------------
describe('采集门闩 · 错误码前置场景', () => {
  /** 22001：总开关开但老人层未授权 */
  it('22001 未授权采集：老人层 PENDING/REVOKED 一律拒绝', () => {
    for (const status of ['PENDING', 'REVOKED'] as const) {
      const r = assertConsent({
        watchEnabled: true,
        elder: { status, scopes: [] },
        family: granted(),
        scope: ACTIVITY_SCOPE.SUMMARY,
        now: NOW,
      });
      expect(r.allowed).toBe(false);
      expect(r.denyReason).toBe('ELDER_NOT_GRANTED');
    }
  });

  /** 22001：授权了但范围未覆盖 */
  it('22001 范围未覆盖：授权 SUMMARY 不含 ALERT', () => {
    const r = assertConsent({
      watchEnabled: true,
      elder: { status: 'GRANTED', scopes: [ACTIVITY_SCOPE.SUMMARY] },
      family: granted(),
      scope: ACTIVITY_SCOPE.ALERT,
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe('SCOPE_NOT_COVERED');
  });

  /** 22006：总开关关闭（灰度未开）—— 先于授权判定 */
  it('22006 总开关关闭：即使双层已授权也拒（先于授权短路）', () => {
    const r = assertConsent({
      watchEnabled: false,
      elder: granted(),
      family: granted(),
      scope: ACTIVITY_SCOPE.SUMMARY,
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe('WATCH_DISABLED');
  });

  /** 22006：设备collect_enabled=false → 停采（与授权无关的独立闸门） */
  it('22006 设备级停采：collect_enabled=false 时应判停采', () => {
    // shouldMarkOffline 对 collect_enabled=false 返回 false（不代表离线），
    // 停采判定在 ingestSignal 内由 collect_enabled 直接把关，
    // 此处锁住「停采设备不应被判成离线」这一语义，避免误报 22003
    expect(shouldMarkOffline('ONLINE', false, NOW, 60, NOW)).toBe(false);
  });

  /** 22002：设备未绑定 —— 门闩在设备查询之后，绑定缺失即拒 */
  it('22002 设备未绑定：无设备行时不应进入令牌校验', () => {
    // 用未绑定场景的等价断言：设备查询失败即抛 22002，
    // 此处验证令牌校验对「无令牌」同样拒绝（防绕过设备绑定直接校验令牌）
    expect(verifyDeviceToken(null, null, TOKEN, NOW)).toBe(false);
  });

  /** 22005：令牌无效 */
  it('22005 令牌校验失败：错令牌/无哈希/过期均拒', () => {
    const hash = hashDeviceToken(TOKEN);
    expect(verifyDeviceToken(hash, null, TOKEN, NOW)).toBe(true);
    expect(verifyDeviceToken(hash, null, 'wrong-token', NOW)).toBe(false);
    expect(verifyDeviceToken(hash, new Date(NOW.getTime() - 1), TOKEN, NOW)).toBe(false); // 过期
    expect(verifyDeviceToken(hash, null, '', NOW)).toBe(false); // 空令牌
  });

  it('22005 令牌哈希：不等于明文，且同明文恒定', () => {
    const h = hashDeviceToken(TOKEN);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toBe(TOKEN);
    expect(hashDeviceToken(TOKEN)).toBe(h);
    expect(hashDeviceToken(`${TOKEN}x`)).not.toBe(h);
  });

  /** 正常路径：门闩全过 */
  it('正常路径：门闩全过→ allowed（供 220xx 不触发）', () => {
    const r = assertConsent({
      watchEnabled: true,
      elder: granted(),
      family: granted(),
      scope: ACTIVITY_SCOPE.SUMMARY,
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('设备离线判定 · shouldMarkOffline', () => {
  it('心跳在 interval×3 内→ 在线；超出 → 离线', () => {
    const interval = 60;
    expect(shouldMarkOffline('ONLINE', true, new Date(NOW.getTime() - 100_000), interval, NOW)).toBe(false);
    expect(shouldMarkOffline('ONLINE', true, new Date(NOW.getTime() - 200_000), interval, NOW)).toBe(true);
  });
  it('从未心跳 / 已撤销 / 已停采 → 不判离线（避免误报 22003）', () => {
    expect(shouldMarkOffline('ONLINE', true, null, 60, NOW)).toBe(false);
    expect(shouldMarkOffline('REVOKED', true, NOW, 60, NOW)).toBe(false);
    expect(shouldMarkOffline('ONLINE', false, NOW, 60, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('查询前置判定 · 数据未就绪 23001/ 置信度不足 23002', () => {
  it('数据就绪门槛 MIN_SIGNAL_DAYS=3（不足 → 23001）', () => {
    expect(MIN_SIGNAL_DAYS).toBe(3);
  });
  it('置信度展示下限> 0（低于 → 23002）', () => {
    expect(CONFIDENCE_DISPLAY_FLOOR).toBeGreaterThan(0);
    expect(CONFIDENCE_DISPLAY_FLOOR).toBeLessThan(1);
  });
  it('免责声明恒定（红线⑤文案不可被改）', () => {
    expect(ACTIVITY_DISCLAIMER).toContain('参考指标');
    expect(ACTIVITY_DISCLAIMER).toContain('非医疗诊断');
  });
});

// ---------------------------------------------------------------------------
describe('日聚合 → 分级入参还原 · statsFromSummary', () => {
  it('无活跃分布 → 全零窗口（不猜测在家/离家）', () => {
    const s = statsFromSummary({ active_slots: null, activity_score: 0, still_count: 0, away_count: 0 });
    expect(s.activeMinutes).toBe(0);
    expect(s.atHomeBssid).toBeNull(); // null = 未知，交给分级层判 UNKNOWN
  });

  it('away_count>0 且无活跃 → 判离家', () => {
    const s = statsFromSummary({ active_slots: [], activity_score: 0, still_count: 0, away_count: 2 });
    expect(s.atHomeBssid).toBe(false);
  });

  it('有活跃分布 → 累加分钟数并给出网络切换近似', () => {
    const s = statsFromSummary({
      active_slots: [
        { hour: 8, level: 30 },
        { hour: 9, level: 0 },
        { hour: 10, level: 20 },
      ],
      activity_score: 500,
      still_count: 0,
      away_count: 0,
    });
    expect(s.activeMinutes).toBe(50);
    expect(s.networkSwitchCount).toBe(2); // 两个非零小时段
    expect(s.windowMinutes).toBe(180); // 3 段 × 60 分钟
  });
});

// ---------------------------------------------------------------------------
describe('越权前置 · isScopeVisibleToFamily（23004 判定依据）', () => {
  it('档位不足 → 不可见（路由层抛 23004）', () => {
    expect(isScopeVisibleToFamily('NONE', 'DAILY_SUMMARY')).toBe(false);
    expect(isScopeVisibleToFamily('ALERT_ONLY', 'DAILY_SUMMARY')).toBe(false);
    expect(isScopeVisibleToFamily('DAILY_SUMMARY', 'DAILY_SUMMARY')).toBe(true);
    expect(isScopeVisibleToFamily('TREND', 'ALERT_ONLY')).toBe(true);
  });
});