// 健康活动感知 domain 纯函数单测（架构 §13 / PRD MODULE-ACTIVITY-SENSE.md）
// 覆盖：UNKNOWN 回落、新鲜度衰减单调性、单通道不得通过交叉验证、
//       抑制窗口边界、加权封顶 100、下降幅度边界（同档生效 / 跨档不跃升）
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BONUS_REASON,
  CONFIDENCE_RULES,
  LEAD_TRIGGER,
  classifyActivityStatus,
  computeConfidence,
  computeDispatchWeight,
  crossVerifySatisfied,
  detectLeadTriggers,
  isSignalExpired,
  rankByActivity,
  shouldPurgeSignal,
  shouldSuppressAlert,
} from './activity';
import type { ActivityWindowStats, DailyActivityPoint } from './activity';

const TTL = 21600; // activity_signal_ttl：6h

const stats = (over: Partial<ActivityWindowStats> = {}): ActivityWindowStats => ({
  windowMinutes: 60,
  activeMinutes: 45,
  networkSwitchCount: 6,
  connectionStability: 0.9,
  activityCount: 300,
  atHomeBssid: true,
  ...over,
});

// ---------------------------------------------------------------------------
describe('活动分级 · classifyActivityStatus', () => {
  it('活跃占比 ≥ 0.6 → ACTIVE', () => {
    const r = classifyActivityStatus({ stats: stats({ activeMinutes: 40 }), freshnessSec: 60, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('ACTIVE');
    expect(r.explainCode).toBe('ACTIVE_HIGH');
    expect(r.activeRatio).toBeCloseTo(40 / 60, 5);
  });

  it('探针离线 → UNKNOWN（红线：不猜测）', () => {
    const r = classifyActivityStatus({ stats: stats({ activeMinutes: 40 }), freshnessSec: 60, probeOnline: false, signalTtlSec: TTL });
    expect(r.status).toBe('UNKNOWN');
    expect(r.explainCode).toBe('PROBE_OFFLINE');
  });

  it('信号超 TTL → UNKNOWN（回落）', () => {
    const r = classifyActivityStatus({ stats: stats(), freshnessSec: TTL + 1, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('UNKNOWN');
    expect(r.explainCode).toBe('SIGNAL_EXPIRED');
  });

  it('窗口过短 → UNKNOWN（数据不足）', () => {
    const r = classifyActivityStatus({ stats: stats({ windowMinutes: 4 }), freshnessSec: 10, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('UNKNOWN');
    expect(r.explainCode).toBe('INSUFFICIENT_DATA');
  });

  it('BSSID 不匹配 → AWAY', () => {
    const r = classifyActivityStatus({ stats: stats({ atHomeBssid: false }), freshnessSec: 10, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('AWAY');
    expect(r.explainCode).toBe('AWAY_CONFIRMED');
  });

  it('几乎无活动且网络稳定 → STILL', () => {
    const r = classifyActivityStatus({ stats: stats({ activeMinutes: 1, networkSwitchCount: 0, activityCount: 2 }), freshnessSec: 10, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('STILL');
    expect(r.explainCode).toBe('STILL_NO_MOTION');
  });

  it('低活跃 → LOW', () => {
    const r = classifyActivityStatus({ stats: stats({ activeMinutes: 8, networkSwitchCount: 5, activityCount: 30 }), freshnessSec: 10, probeOnline: true, signalTtlSec: TTL });
    expect(r.status).toBe('LOW');
    expect(r.explainCode).toBe('LOW_ACTIVITY');
  });

  it('阈值可入参覆盖（后台热调）', () => {
    const r = classifyActivityStatus({
      stats: stats({ activeMinutes: 12, windowMinutes: 60 }),
      freshnessSec: 10,
      probeOnline: true,
      signalTtlSec: TTL,
      thresholds: { activeRatioHigh: 0.2 },
    });
    expect(r.status).toBe('ACTIVE');
  });

  it('UNKNOWN 优先级高于其他判定（离线时即便占比很高也不判 ACTIVE）', () => {
    const r = classifyActivityStatus({ stats: stats({ activeMinutes: 60 }), freshnessSec: 99999, probeOnline: false, signalTtlSec: TTL });
    expect(r.status).toBe('UNKNOWN');
    expect(r.explainCode).toBe('PROBE_OFFLINE');
  });
});

// ---------------------------------------------------------------------------
describe('置信度 · computeConfidence', () => {
  it('0 通道 / 超 TTL → 0', () => {
    expect(computeConfidence({ freshnessSec: 10, signalTtlSec: TTL, channelCount: 0 })).toBe(0);
    expect(computeConfidence({ freshnessSec: TTL + 1, signalTtlSec: TTL, channelCount: 2, crossVerified: true })).toBe(0);
  });

  it('单通道硬上限 0.6（红线：单通道不得出健康结论）', () => {
    expect(computeConfidence({ freshnessSec: 0, signalTtlSec: TTL, channelCount: 1 })).toBe(CONFIDENCE_RULES.singleChannelCap);
    expect(computeConfidence({ freshnessSec: 0, signalTtlSec: TTL, channelCount: 1, crossVerified: true })).toBeLessThanOrEqual(
      CONFIDENCE_RULES.singleChannelCap,
    );
  });

  it('双通道交叉验证 ×1.3 且不超过 0.95', () => {
    const dual = computeConfidence({ freshnessSec: 0, signalTtlSec: TTL, channelCount: 2 });
    const verified = computeConfidence({ freshnessSec: 0, signalTtlSec: TTL, channelCount: 2, crossVerified: true });
    expect(verified).toBeGreaterThan(dual);
    expect(verified).toBeLessThanOrEqual(CONFIDENCE_RULES.cap);
  });

  it('新鲜度衰减单调不增（越旧越不可信）', () => {
    const seq = [0, 3600, 7200, 10800, 14400, 18000, 21600].map(
      (freshnessSec) => computeConfidence({ freshnessSec, signalTtlSec: TTL, channelCount: 2, crossVerified: true }),
    );
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]!).toBeLessThanOrEqual(seq[i - 1]!);
    }
    expect(seq[0]!).toBeGreaterThan(seq[seq.length - 1]!);
    // 超 TTL 边界恰好等于 TTL 时仍有效（未超期）
    expect(isSignalExpired(TTL, TTL)).toBe(false);
    expect(isSignalExpired(TTL + 1, TTL)).toBe(true);
  });

  it('数据陈旧最低降至 0.5 倍', () => {
    const fresh = computeConfidence({ freshnessSec: 0, signalTtlSec: TTL, channelCount: 2 });
    const stale = computeConfidence({ freshnessSec: TTL, signalTtlSec: TTL, channelCount: 2 });
    expect(stale).toBeCloseTo(fresh * CONFIDENCE_RULES.staleFloor, 4);
  });
});

// ---------------------------------------------------------------------------
describe('交叉验证 · crossVerifySatisfied', () => {
  it('required 默认 true：单通道一律 false', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: false, crossSourceHit: true })).toBe(false);
    expect(crossVerifySatisfied({ channelAValid: false, channelBValid: true, crossSourceHit: true })).toBe(false);
  });

  it('双通道有效但无交叉源 → false', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: true, crossSourceHit: false })).toBe(false);
  });

  it('双通道 + 交叉源命中 → true', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: true, crossSourceHit: true })).toBe(true);
  });

  it('required=false（灰度）：任一通道有效即放行', () => {
    expect(crossVerifySatisfied({ channelAValid: true, channelBValid: false, required: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('告警抑制 · shouldSuppressAlert', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');

  it('从未告警 → 不抑制', () => {
    expect(shouldSuppressAlert({ lastAlertAt: null, suppressWindowMin: 180, now })).toBe(false);
  });

  it('窗口内 → 抑制', () => {
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T11:00:00.000Z'), suppressWindowMin: 180, now })).toBe(true);
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T09:00:01.000Z'), suppressWindowMin: 180, now })).toBe(true);
  });

  it('边界：恰好等于 180 分钟 → 仍抑制（闭区间）', () => {
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T09:00:00.000Z'), suppressWindowMin: 180, now })).toBe(true);
  });

  it('超窗口 → 放行', () => {
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T08:59:59.000Z'), suppressWindowMin: 180, now })).toBe(false);
  });

  it('窗口为 0 → 不抑制；时钟回拨 → 保守抑制', () => {
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T11:59:00.000Z'), suppressWindowMin: 0, now })).toBe(false);
    expect(shouldSuppressAlert({ lastAlertAt: new Date('2026-10-20T12:30:00.000Z'), suppressWindowMin: 180, now })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('派单加成 · computeDispatchWeight / rankByActivity', () => {
  it('LOW +5、STILL +10、其余 0', () => {
    expect(computeDispatchWeight({ baseScore: 70, activityStatus: 'LOW' })).toMatchObject({
      baseScore: 70,
      activityBonus: 5,
      finalScore: 75,
      bonusReason: ACTIVITY_BONUS_REASON.ACTIVITY_LOW,
    });
    expect(computeDispatchWeight({ baseScore: 70, activityStatus: 'STILL' }).activityBonus).toBe(10);
    for (const st of ['ACTIVE', 'AWAY', 'UNKNOWN'] as const) {
      expect(computeDispatchWeight({ baseScore: 70, activityStatus: st })).toMatchObject({
        activityBonus: 0,
        finalScore: 70,
        bonusReason: ACTIVITY_BONUS_REASON.NONE,
      });
    }
  });

  it('加成可配置（activity_dispatch_bonus_low / _still）', () => {
    expect(computeDispatchWeight({ baseScore: 50, activityStatus: 'STILL', bonusStill: 20 }).finalScore).toBe(70);
  });

  it('封顶 100，不超', () => {
    const r = computeDispatchWeight({ baseScore: 98, activityStatus: 'STILL' });
    expect(r.baseScore).toBe(98);
    expect(r.activityBonus).toBe(10);
    expect(r.finalScore).toBe(100);
  });

  it('档位只按 baseScore 判定——加成不得跨档', () => {
    // base 68（档 6）+ STILL 10 = 78；base 72（档 7）+ 0 = 72
    // 展示分 low > high，但档位归属仍按 baseScore：low=6、high=7（加成不改档）
    const low = computeDispatchWeight({ baseScore: 68, activityStatus: 'STILL' });
    const high = computeDispatchWeight({ baseScore: 72, activityStatus: 'ACTIVE' });
    expect(low.band).toBe(6);
    expect(high.band).toBe(7);
    expect(low.finalScore).toBe(78);
    expect(high.finalScore).toBe(72);
    // 档位不因加成而改变：STILL 的 78 依然落档 6，而不是 floor(78/10)=7
    expect(low.band).toBe(Math.floor(low.baseScore / 10));
  });

  it('同档内加成生效：LOW/STILL 候选排序前置', () => {
    const ranked = rankByActivity([
      { candidate: 'a', baseScore: 70, activityStatus: 'ACTIVE', withinRadius: true },
      { candidate: 'b', baseScore: 72, activityStatus: 'STILL', withinRadius: true }, // 同档 7：72+10=82
      { candidate: 'c', baseScore: 71, activityStatus: 'LOW', withinRadius: true }, // 同档 7：71+5=76
    ]);
    expect(ranked.map((r) => r.candidate)).toEqual(['b', 'c', 'a']);
  });

  it('跨档不跃升：低档加成后仍排在高档之后', () => {
    const ranked = rankByActivity([
      { candidate: 'low-band-still', baseScore: 69, activityStatus: 'STILL', withinRadius: true }, // 档6 → 79
      { candidate: 'high-band-idle', baseScore: 71, activityStatus: 'UNKNOWN', withinRadius: true }, // 档7 → 71
    ]);
    expect(ranked.map((r) => r.candidate)).toEqual(['high-band-idle', 'low-band-still']);
  });

  it('服务半径外候选不参与比较（硬约束不因加成放宽）', () => {
    const ranked = rankByActivity([
      { candidate: 'far-still', baseScore: 95, activityStatus: 'STILL', withinRadius: false },
      { candidate: 'near-idle', baseScore: 60, activityStatus: 'UNKNOWN', withinRadius: true },
    ]);
    expect(ranked.map((r) => r.candidate)).toEqual(['near-idle']);
  });

  it('落库三列可解释：base / bonus / reason', () => {
    const r = computeDispatchWeight({ baseScore: 66.5, activityStatus: 'LOW' });
    expect([r.baseScore, r.activityBonus, r.bonusReason]).toEqual([66.5, 5, 'ACTIVITY_LOW']);
  });
});

// ---------------------------------------------------------------------------
describe('引流触发器 · detectLeadTriggers', () => {
  const day = (date: string, activeMinutes: number, status: DailyActivityPoint['status'] = 'ACTIVE'): DailyActivityPoint => ({
    date,
    activeMinutes,
    status,
  });

  it('下降幅度恰好 30% 不触发，超 30% 触发', () => {
    // 基线 100，观察窗 70 → 下降 30%，恰好不触发
    const exact = detectLeadTriggers({
      series: [day('10-01', 100), day('10-02', 100), day('10-03', 70), day('10-04', 70), day('10-05', 70)],
      windowDays: 3,
      baselineDays: 2,
      dropPctThreshold: 30,
    });
    expect(exact.some((h) => h.trigger === LEAD_TRIGGER.ACTIVITY_DROP)).toBe(false);

    // 69.9 → 下降 30.1%，触发
    const over = detectLeadTriggers({
      series: [day('10-01', 100), day('10-02', 100), day('10-03', 69.9), day('10-04', 69.9), day('10-05', 69.9)],
      windowDays: 3,
      baselineDays: 2,
      dropPctThreshold: 30,
    });
    const hit = over.find((h) => h.trigger === LEAD_TRIGGER.ACTIVITY_DROP);
    expect(hit).toBeDefined();
    expect(hit!.metrics.dropPct).toBeGreaterThan(30);
  });

  it('阈值可入参（阈值调低则触发）', () => {
    const hits = detectLeadTriggers({
      series: [day('10-01', 100), day('10-02', 100), day('10-03', 70), day('10-04', 70), day('10-05', 70)],
      windowDays: 3,
      baselineDays: 2,
      dropPctThreshold: 20,
    });
    expect(hits.some((h) => h.trigger === LEAD_TRIGGER.ACTIVITY_DROP)).toBe(true);
  });

  it('连续 3 天 LOW/STILL → LOW_TREND', () => {
    const hits = detectLeadTriggers({
      series: [day('10-01', 100), day('10-02', 40, 'LOW'), day('10-03', 30, 'LOW'), day('10-04', 20, 'STILL'), day('10-05', 10, 'LOW')],
      windowDays: 3,
      baselineDays: 2,
      dropPctThreshold: 30,
    });
    expect(hits.some((h) => h.trigger === LEAD_TRIGGER.LOW_TREND)).toBe(true);
  });

  it('连续天数不足 → 不触发 LOW_TREND', () => {
    const hits = detectLeadTriggers({
      series: [day('10-01', 100), day('10-02', 100), day('10-03', 40, 'LOW'), day('10-04', 100), day('10-05', 100)],
      windowDays: 3,
      baselineDays: 2,
    });
    expect(hits.some((h) => h.trigger === LEAD_TRIGGER.LOW_TREND)).toBe(false);
  });

  it('新装体验：isNewInstall 且渠道已激活', () => {
    const hits = detectLeadTriggers({ series: [], isNewInstall: true, windowDays: 3 });
    expect(hits.map((h) => h.trigger)).toContain(LEAD_TRIGGER.NEWINSTALL_EXPERIENCE);
    expect(detectLeadTriggers({ series: [], isNewInstall: true, newInstallChannelActive: false, windowDays: 3 })).toHaveLength(0);
    expect(detectLeadTriggers({ series: [], isNewInstall: false, windowDays: 3 })).toHaveLength(0);
  });

  it('序列长度不足 → 不做趋势判定（只可能出新装）', () => {
    const hits = detectLeadTriggers({ series: [day('10-01', 100), day('10-02', 5, 'STILL')], windowDays: 3, baselineDays: 3 });
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('留存清理 · shouldPurgeSignal', () => {
  it('未到期不清理，到期即清理（闭区间，14 天硬上限由配置控制）', () => {
    const now = new Date('2026-10-20T00:00:00.000Z');
    expect(shouldPurgeSignal(new Date('2026-10-20T00:00:01.000Z'), now)).toBe(false);
    expect(shouldPurgeSignal(new Date('2026-10-20T00:00:00.000Z'), now)).toBe(true);
    expect(shouldPurgeSignal(new Date('2026-10-06T00:00:00.000Z'), now)).toBe(true); // 已超14 天
  });
});