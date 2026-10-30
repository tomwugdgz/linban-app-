// 分账门闩单测：架构 §8.1「缺一不可执行分账」——全通过 + 每条规则 false 分支
import { describe, expect, it } from 'vitest';
import type { order_status, profit_sharing_status, verification_status } from '@linban/shared';
import { SHARING_RETRY_MAX } from '@linban/shared';
import { assertSharingGate, canExecuteSharing, checkSharingGate } from './sharing-gate';
import type { SharingGateInput } from './sharing-gate';

/** 构造「全通过」基线输入 */
function gateInput(overrides: Partial<SharingGateInput> = {}): SharingGateInput {
  return {
    orderStatus: 'COMPLETED',
    verification: { status: 'PASSED', faceScore: 90, gpsDeviationM: 50 },
    faceMatchThreshold: 80,
    gpsMaxDeviation: 2000,
    hasPendingRiskEvent: false,
    sharingStatus: 'FROZEN',
    retryCount: 0,
    ...overrides,
  };
}

describe('分账门闩 · 全通过', () => {
  it('五项条件齐备 → pass，无失败项', () => {
    const r = checkSharingGate(gateInput());
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(canExecuteSharing(gateInput())).toBe(true);
  });

  it('边界值取等：人脸分=阈值、GPS 偏差=阈值、retry=maxRetry−1 → 通过', () => {
    const r = checkSharingGate(
      gateInput({
        verification: { status: 'PASSED', faceScore: 80, gpsDeviationM: 2000 },
        retryCount: SHARING_RETRY_MAX - 1,
      }),
    );
    expect(r.pass).toBe(true);
  });
});

describe('分账门闩 · 规则1：订单必须 COMPLETED（双方确认）', () => {
  it.each<order_status>(['CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'REFUNDED'])(
    '订单 %s → 拒绝（GATE_ORDER_STATUS）',
    (status) => {
      const r = checkSharingGate(gateInput({ orderStatus: status }));
      expect(r.pass).toBe(false);
      const f = r.failures.find((x) => x.rule === 'GATE_ORDER_STATUS');
      expect(f).toBeDefined();
      expect(f!.code).toBe(15006);
    },
  );
});

describe('分账门闩 · 规则2：核销通过记录', () => {
  it('无核销记录 → 拒绝（GATE_VERIFICATION）', () => {
    const r = checkSharingGate(gateInput({ verification: null }));
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.rule === 'GATE_VERIFICATION')).toBe(true);
  });

  it.each<verification_status>(['PENDING', 'FAILED', 'EXPIRED'])('核销 %s → 拒绝', (status) => {
    const r = checkSharingGate(gateInput({ verification: { status, faceScore: 90, gpsDeviationM: 10 } }));
    expect(r.pass).toBe(false);
    expect(r.failures.some((f) => f.rule === 'GATE_VERIFICATION')).toBe(true);
  });

  it('人脸分低于阈值 1 分 → 拒绝（GATE_FACE_SCORE, 16005）', () => {
    const r = checkSharingGate(
      gateInput({ verification: { status: 'PASSED', faceScore: 79, gpsDeviationM: 10 } }),
    );
    expect(r.pass).toBe(false);
    const f = r.failures.find((x) => x.rule === 'GATE_FACE_SCORE');
    expect(f).toBeDefined();
    expect(f!.code).toBe(16005);
  });

  it('人脸分为 null → 拒绝', () => {
    const r = checkSharingGate(
      gateInput({ verification: { status: 'PASSED', faceScore: null, gpsDeviationM: 10 } }),
    );
    expect(r.failures.some((f) => f.rule === 'GATE_FACE_SCORE')).toBe(true);
  });

  it('GPS 偏差超阈 1 米 → 拒绝（GATE_GPS_DEVIATION, 16007）', () => {
    const r = checkSharingGate(
      gateInput({ verification: { status: 'PASSED', faceScore: 90, gpsDeviationM: 2001 } }),
    );
    expect(r.pass).toBe(false);
    const f = r.failures.find((x) => x.rule === 'GATE_GPS_DEVIATION');
    expect(f).toBeDefined();
    expect(f!.code).toBe(16007);
  });

  it('GPS 偏差为 null（未签到）→ 拒绝', () => {
    const r = checkSharingGate(
      gateInput({ verification: { status: 'PASSED', faceScore: 90, gpsDeviationM: null } }),
    );
    expect(r.failures.some((f) => f.rule === 'GATE_GPS_DEVIATION')).toBe(true);
  });
});

describe('分账门闩 · 规则3：无未决风控挂起工单', () => {
  it('hasPendingRiskEvent=true → 拒绝（GATE_RISK_EVENT, 20002）', () => {
    const r = checkSharingGate(gateInput({ hasPendingRiskEvent: true }));
    expect(r.pass).toBe(false);
    const f = r.failures.find((x) => x.rule === 'GATE_RISK_EVENT');
    expect(f).toBeDefined();
    expect(f!.code).toBe(20002);
  });
});

describe('分账门闩 · 附加规则4：分账记录必须 FROZEN（防重复执行）', () => {
  it.each<profit_sharing_status>(['SHARED', 'RETURNED'])('%s → 拒绝（GATE_SHARING_STATUS, 15007）', (status) => {
    const r = checkSharingGate(gateInput({ sharingStatus: status }));
    expect(r.pass).toBe(false);
    const f = r.failures.find((x) => x.rule === 'GATE_SHARING_STATUS');
    expect(f).toBeDefined();
    expect(f!.code).toBe(15007);
  });
});

describe('分账门闩 · 附加规则5：重试上限（§6.2/§7.5：≥3 升级人工）', () => {
  it('retryCount = maxRetry → 拒绝（GATE_RETRY_EXHAUSTED, 15008）', () => {
    const r = checkSharingGate(gateInput({ retryCount: 3 }));
    expect(r.pass).toBe(false);
    const f = r.failures.find((x) => x.rule === 'GATE_RETRY_EXHAUSTED');
    expect(f).toBeDefined();
    expect(f!.code).toBe(15008);
  });

  it('自定义 maxRetry 生效', () => {
    expect(checkSharingGate(gateInput({ retryCount: 5, maxRetry: 5 })).pass).toBe(false);
    expect(checkSharingGate(gateInput({ retryCount: 5, maxRetry: 6 })).pass).toBe(true);
  });
});

describe('分账门闩 · 聚合行为', () => {
  it('多条件同时失败 → 全量返回，不短路', () => {
    const r = checkSharingGate(
      gateInput({
        orderStatus: 'PAID',
        verification: null,
        hasPendingRiskEvent: true,
        sharingStatus: 'SHARED',
        retryCount: 9,
      }),
    );
    expect(r.pass).toBe(false);
    const rules = r.failures.map((f) => f.rule);
    expect(rules).toEqual([
      'GATE_ORDER_STATUS',
      'GATE_VERIFICATION',
      'GATE_RISK_EVENT',
      'GATE_SHARING_STATUS',
      'GATE_RETRY_EXHAUSTED',
    ]);
  });

  it('assertSharingGate 抛 15006 且 payload 携带 failures', () => {
    try {
      assertSharingGate(gateInput({ orderStatus: 'PAID' }));
      expect.unreachable();
    } catch (e) {
      const err = e as { code: number; payload?: { failures?: unknown[] } };
      expect(err.code).toBe(15006);
      expect(err.payload?.failures).toHaveLength(1);
    }
  });
});
