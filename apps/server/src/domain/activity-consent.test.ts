// 活动感知授权门闩单测（PRD 红线④双层同意 + 撤销即停采 + 禁原始字段）
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SCOPE,
  CONSENT_DENY_REASON,
  assertConsent,
  checkFeaturePayload,
  isConsentEffective,
  coversActivityScope,
  isScopeVisibleToFamily,
  planRevoke,
} from './activity-consent';
import type { ConsentGateInput, ConsentLayer } from './activity-consent';

const NOW = new Date('2026-10-20T12:00:00.000Z');

const layer = (over: Partial<ConsentLayer> = {}): ConsentLayer => ({
  status: 'GRANTED',
  scopes: [ACTIVITY_SCOPE.SUMMARY, ACTIVITY_SCOPE.ALERT, ACTIVITY_SCOPE.FAMILY_VISIBLE],
  ...over,
});

const gate = (over: Partial<ConsentGateInput> = {}): ConsentGateInput => ({
  watchEnabled: true,
  elder: layer(),
  family: layer(),
  scope: ACTIVITY_SCOPE.SUMMARY,
  now: NOW,
  ...over,
});

describe('双层同意门闩 · assertConsent', () => {
  it('总开关关闭 → 全拒（WATCH_DISABLED），即使双层已授权', () => {
    const r = assertConsent(gate({ watchEnabled: false }));
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe(CONSENT_DENY_REASON.WATCH_DISABLED);
    expect(r.impactNote).toContain('未开放');
  });

  it('老人本人层未授权 → 拒（ELDER_NOT_GRANTED）', () => {
    for (const st of ['PENDING', 'REVOKED'] as const) {
      const r = assertConsent(gate({ elder: layer({ status: st }) }));
      expect(r.allowed).toBe(false);
      expect(r.denyReason).toBe(CONSENT_DENY_REASON.ELDER_NOT_GRANTED);
    }
    expect(assertConsent(gate({ elder: null })).allowed).toBe(false);
  });

  it('撤销即停采：不因子女层仍授权而放行', () => {
    const r = assertConsent(gate({ elder: layer({ status: 'REVOKED' }), family: layer() }));
    expect(r.allowed).toBe(false);
    expect(r.sharingAllowed).toBe(false);
  });

  it('授权过期 → CONSENT_EXPIRED（到期时刻边界即失效）', () => {
    const r = assertConsent(gate({ elder: layer({ expiresAt: NOW }) }));
    expect(r.denyReason).toBe(CONSENT_DENY_REASON.CONSENT_EXPIRED);
    const future = assertConsent(gate({ elder: layer({ expiresAt: new Date('2026-10-20T12:00:01.000Z') }) }));
    expect(future.allowed).toBe(true);
  });

  it('范围未覆盖 → SCOPE_NOT_COVERED（授权了≠授权了这个范围）', () => {
    const r = assertConsent(
      gate({ elder: layer({ scopes: [ACTIVITY_SCOPE.SUMMARY] }), scope: ACTIVITY_SCOPE.ALERT }),
    );
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toBe(CONSENT_DENY_REASON.SCOPE_NOT_COVERED);
    expect(r.impactNote).toContain('不在你的授权范围内');
  });

  it('全通过 → allowed 且无拒绝码', () => {
    const r = assertConsent(gate());
    expect(r).toMatchObject({ allowed: true, denyReason: null, impactNote: null, sharingAllowed: true });
  });

  it('子女层未授权不阻断采集（安全兜底不依赖子女同意，Q9），但禁止共享', () => {
    const r = assertConsent(gate({ family: null }));
    expect(r.allowed).toBe(true);       // 采集继续
    expect(r.sharingAllowed).toBe(false); // 共享禁止
  });

  it('子女层有效但未授权 FAMILY_VISIBLE 范围 → 不共享', () => {
    const r = assertConsent(gate({ family: layer({ scopes: [ACTIVITY_SCOPE.SUMMARY, ACTIVITY_SCOPE.ALERT] }) }));
    expect(r.allowed).toBe(true);
    expect(r.sharingAllowed).toBe(false);
  });

  it('共享判定独立于本次 scope：scope=ALERT 也须 FAMILY_VISIBLE 才可共享', () => {
    const noFamilyVisible = assertConsent(
      gate({ scope: ACTIVITY_SCOPE.ALERT, family: layer({ scopes: [ACTIVITY_SCOPE.ALERT] }) }),
    );
    expect(noFamilyVisible.sharingAllowed).toBe(false);
    const withFamilyVisible = assertConsent(gate({ scope: ACTIVITY_SCOPE.ALERT }));
    expect(withFamilyVisible.sharingAllowed).toBe(true);
  });

  it('老人层撤销 → 共享亦禁止（即使子女层完好）', () => {
    const r = assertConsent(gate({ elder: layer({ status: 'REVOKED' }), family: layer() }));
    expect(r.sharingAllowed).toBe(false);
  });

  it('拒绝必带影响范围说明（可复现why），允许时为 null', () => {
    const denied = assertConsent(gate({ watchEnabled: false }));
    expect(denied.impactNote).toBeTruthy();
    expect(assertConsent(gate()).impactNote).toBeNull();
  });
});

describe('授权生效判定 · isConsentEffective', () => {
  it('GRANTED 且未过期 → 生效；其余 → 不生效', () => {
    expect(isConsentEffective(layer(), NOW)).toBe(true);
    expect(isConsentEffective(null, NOW)).toBe(false);
    expect(isConsentEffective(layer({ status: 'PENDING' }), NOW)).toBe(false);
    expect(isConsentEffective(layer({ status: 'EXPIRED' }), NOW)).toBe(false);
    expect(isConsentEffective(layer({ expiresAt: new Date('2026-10-01T00:00:00.000Z') }), NOW)).toBe(false);
  });
});

describe('一键关闭 · planRevoke', () => {
  it('撤销即时生效 + 清未聚合 + 聚合留存（出参必须明示）', () => {
    const p = planRevoke(NOW);
    expect(p.effectiveAt).toBe(NOW);
    expect(p.purgeUnaggregated).toBe(true);
    expect(p.aggregateRetained).toBe(true);
    expect(p.note).toContain('立即停止采集');
  });
});

describe('采集特征校验 · checkFeaturePayload', () => {
  it('禁原始字段：CSI/波形/音视频/定位一律拒绝', () => {
    for (const k of ['csi', 'csi_raw', 'waveform', 'audio', 'video', 'camera', 'microphone', 'gps', 'latitude']) {
      const r = checkFeaturePayload({ [k]: 'whatever' });
      expect(r.ok).toBe(false);
      expect(r.rejectedField).toBe(k);
    }
  });

  it('ssid/bssid/mac 在 features 内亦拒（绕过 HMAC 化的后门）', () => {
    expect(checkFeaturePayload({ ssid: 'x' }).ok).toBe(false);
    expect(checkFeaturePayload({ bssid: 'x' }).ok).toBe(false);
    expect(checkFeaturePayload({ mac: 'x' }).ok).toBe(false);
  });

  it('拒绝时不回显入参值（防日志泄漏）', () => {
    const r = checkFeaturePayload({ ssid: 'TP-LINK_5G_张三家' });
    expect(JSON.stringify(r)).not.toContain('张三');
  });

  it('合法派生特征向量放行', () => {
    const r = checkFeaturePayload({
      windowMinutes: 60,
      activeMinutes: 42,
      networkSwitchCount: 5,
      connectionStability: 0.9,
      activityCount: 300,
      rssi_avg: -55,
    });
    expect(r).toEqual({ ok: true, rejectedField: null });
  });

  it('空对象放行（无信号不构成分级依据，由分级层回落 UNKNOWN）', () => {
    expect(checkFeaturePayload({}).ok).toBe(true);
  });
});

describe('子女可见范围 · isScopeVisibleToFamily', () => {
  it('按档位包含判定，NONE 一律不可见', () => {
    expect(isScopeVisibleToFamily('NONE', 'DAILY_SUMMARY')).toBe(false);
    expect(isScopeVisibleToFamily('DAILY_SUMMARY', 'DAILY_SUMMARY')).toBe(true);
    expect(isScopeVisibleToFamily('TREND', 'ALERT_ONLY')).toBe(true);
    expect(isScopeVisibleToFamily('ALERT_ONLY', 'TREND')).toBe(false);
  });
});

describe('范围覆盖助手 · coversActivityScope', () => {
  it('空层或空范围 → false', () => {
    expect(coversActivityScope(null, ACTIVITY_SCOPE.SUMMARY)).toBe(false);
    expect(coversActivityScope(layer({ scopes: [] }), ACTIVITY_SCOPE.ALERT)).toBe(false);
  });
  it('覆盖 → true', () => {
    expect(coversActivityScope(layer({ scopes: [ACTIVITY_SCOPE.ALERT] }), ACTIVITY_SCOPE.ALERT)).toBe(true);
  });
});