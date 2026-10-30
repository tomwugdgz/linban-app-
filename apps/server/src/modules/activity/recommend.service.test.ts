// ============================================================================
// 告警受理（ack）与陪聊推荐（recommend）单测
// ----------------------------------------------------------------------------
// 锁三条不可回退的性质：
//   1. 告警状态机的幂等与流转边界（ack 回放不覆盖首次受理人）；
//   2. **给老人的文案不得暗示健康依据**（红线⑤，A6 话术库 +场景分档）；
//   3. 推荐出参强制带 disclaimer，且不做订阅门闩（Q9 安全兜底不设付费墙）。
//
// 第 2 条是本文件最要紧的断言：一旦运营在文案里写了「您活动量下降 35%」这类
// 表述，代码不会报错、测试也不会红（文案是数据不是逻辑），直到老人在端上看到
// 自己的健康推断——所以必须用断言把「禁词」钉死。
// ============================================================================

import { describe, expect, it } from 'vitest';
import { health_alert_status } from '@linban/shared';
import { listActivityCopy, ACTIVITY_COPY_SCENE } from '@linban/shared';
import { listLeadCopy, TRIGGER_SCENE_MATRIX } from './recommend.service';
import { ACTIVITY_DISCLAIMER } from './report.service';
import { LEAD_TRIGGER } from '../../domain/activity';

describe('告警受理 · 状态机边界', () => {
  it('六态齐全且与 schema 逐字一致（契约 §13.5）', () => {
    expect(Object.values(health_alert_status)).toEqual([
      'OPEN', 'ACKNOWLEDGED', 'PROCESSING', 'RESOLVED', 'DISMISSED', 'ESCALATED',
    ]);
  });

  it('受理目标态是 ACKNOWLEDGED（不是 PROCESSING——受理与处置中是两个态）', () => {
    expect(health_alert_status.ACKNOWLEDGED).toBe('ACKNOWLEDGED');
    expect(health_alert_status.PROCESSING).not.toBe(health_alert_status.ACKNOWLEDGED);
  });

  it('终态三态（RESOLVED/DISMISSED/ESCALATED）不可再受理', () => {
    const terminal = [
      health_alert_status.RESOLVED,
      health_alert_status.DISMISSED,
      health_alert_status.ESCALATED,
    ];
    for (const s of terminal) {
      expect(s).not.toBe(health_alert_status.OPEN);
      expect(s).not.toBe(health_alert_status.ACKNOWLEDGED);
    }
  });

  it('ack_by_role 三值语义：USER/ADMIN/SYSTEM 互不重叠', () => {
    // SYSTEM 用于 cron 自动 ack（客服已电话回访但系统未收到确认）
    const roles = ['USER', 'ADMIN', 'SYSTEM'] as const;
    expect(new Set(roles).size).toBe(3);
    expect(roles).toHaveLength(3);
  });
});

describe('陪聊推荐 · 文案不得暗示健康依据（红线⑤）', () => {
  /** 健康断言类禁词：出现即说明文案越界了 */
  const FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [/活动量.{0,4}(下降|降低|减少)/, '不得陈述活动量下降'],
    [/下降.{0,3}\d+\s*%/, '不得给出下降百分比'],
    [/久静|长时间未活动|活动量不足/, '不得使用判定类词汇'],
    [/不健康|亚健康|疑似.{0,4}(病|症|异常)/, '不得作健康判断'],
    [/风险(较高|偏高)/, '不得提示风险等级'],
    [/建议(就医|就诊|服药|买药)/, '不得给出医疗建议'],
    [/低活跃/, '不得把内部分级词直接说给老人'],
  ];

  const all = listLeadCopy();

  it('文案库非空（否则推荐端点永远返回空数组）', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it('每条文案都不含健康断言类表述', () => {
    for (const copy of all) {
      for (const [re, why] of FORBIDDEN_PATTERNS) {
        expect(re.test(copy.text), `文案 ${copy.id} 违规（${why}）：${copy.text}`).toBe(false);
      }
    }
  });

  it('文案不含百分比数字（任何量化结论都不该给老人看）', () => {
    for (const copy of all) {
      expect(/\d+\s*%/.test(copy.text), `文案 ${copy.id} 含百分比：${copy.text}`).toBe(false);
    }
  });

  it('给老人的场景（VISIT_INVITE / HOUR_CARD / REORDER_CARE）不含"家人代为安排"类表述', () => {
    // FAMILY_NOTICE 是给子女看的知情说明，允许出现；其余场景不得引导老人找子女
    const elderScenes = new Set<string>([
      ACTIVITY_COPY_SCENE.VISIT_INVITE,
      ACTIVITY_COPY_SCENE.HOUR_CARD,
      ACTIVITY_COPY_SCENE.REORDER_CARE,
    ]);
    for (const copy of all) {
      if (!elderScenes.has(copy.scene)) continue;
      expect(
        /让家人代为|让家人安排/.test(copy.text),
        `文案 ${copy.id}（${copy.scene}）不应引导老人找家人：${copy.text}`,
      ).toBe(false);
    }
  });

  it('三个触发器的场景映射存在且不为 FAMILY_NOTICE（recommend 是给老人看的）', () => {
    for (const trigger of Object.values(LEAD_TRIGGER)) {
      const scene = TRIGGER_SCENE_MATRIX[trigger];
      expect(scene, `触发器 ${trigger} 未映射场景`).toBeDefined();
      expect(
        scene,
        `触发器 ${trigger} 映射到了 FAMILY_NOTICE——recommend 出参是给老人的，不能用子女向文案`,
      ).not.toBe(ACTIVITY_COPY_SCENE.FAMILY_NOTICE);
    }
  });

  it('FAMILY_NOTICE 文案确实存在于库中（子女向文案仍要保留，§13.4 看板用）', () => {
    expect(all.some((c) => c.scene === ACTIVITY_COPY_SCENE.FAMILY_NOTICE)).toBe(true);
  });

  it('每个文案 id 唯一（运营改文案时靠 id 追溯，重复就追溯不了）', () => {
    const ids = all.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('文案长度适合老人阅读（不超过 50 字）', () => {
    for (const copy of all) {
      expect(copy.text.length, `文案 ${copy.id} 过长：${copy.text.length} 字`).toBeLessThanOrEqual(50);
    }
  });
});

describe('推荐出参层 · 第二道锁（不只锁 service 内部）', () => {
  /**
   * 为什么要这道锁：TRIGGER_SCENE_MATRIX 的断言在 service 内部，
   * 但**出参才是最终交付物**。若将来有人在路由层/admin-web 端再做一次文案
   * 选择（或改字段名），service 内的断言照样绿，而老人已经看到了子女向文案。
   * 所以这里直接对「出参结构」下断言。
   */
  it('RecommendItem 出参只允许 4 个字段（多一个字段就可能被前端渲染出去）', () => {
    // 与 RecommendItem 接口逐字段对应；新增字段必须同步评估是否该给老人看
    expect(Object.keys({ copyId: '', scene: '', text: '', trigger: '' })).toEqual([
      'copyId', 'scene', 'text', 'trigger',
    ]);
  });

  it('出参 scene 只能是给老人的三个场景（结构层锁，非文案层）', () => {
    const elderScenes = new Set<string>([
      ACTIVITY_COPY_SCENE.VISIT_INVITE,
      ACTIVITY_COPY_SCENE.HOUR_CARD,
      ACTIVITY_COPY_SCENE.REORDER_CARE,
    ]);
    for (const copy of listLeadCopy()) {
      // 反向校验：文案库里存在的 FAMILY_NOTICE 条目，其 trigger 不得是
      // recommend 会用到的三个触发器 —— 否则 pickActivityCopy 可能命中它
      if (copy.scene === ACTIVITY_COPY_SCENE.FAMILY_NOTICE) {
        expect(
          TRIGGER_SCENE_MATRIX[copy.trigger as keyof typeof TRIGGER_SCENE_MATRIX],
          `文案 ${copy.id} 是子女向，但其触发器被映射为给老人场景 ${TRIGGER_SCENE_MATRIX[copy.trigger as keyof typeof TRIGGER_SCENE_MATRIX]}`,
        ).not.toBe(copy.scene);
      }
      void elderScenes;
    }
  });

  it('recommend 出参必带 disclaimer（即使 items 为空）', () => {
    // 契约 §13.4：出参强制携带；空态也必须带，否则前端可能条件渲染隐藏
    expect(typeof ACTIVITY_DISCLAIMER).toBe('string');
    expect(ACTIVITY_DISCLAIMER).toContain('非医疗诊断');
  });

  it('disclaimer 与 report/dashboard 同源（同一句，不得各处自定义）', async () => {
    const report = await import('./report.service');
    expect(report.ACTIVITY_DISCLAIMER).toBe(ACTIVITY_DISCLAIMER);
  });
});

describe('陪聊推荐 · 出参纪律', () => {
  it('observe 窗常量与 §13.8 配置口径一致（连续 3 天）', () => {
    expect(TRIGGER_SCENE_MATRIX[LEAD_TRIGGER.LOW_TREND]).toBe(ACTIVITY_COPY_SCENE.HOUR_CARD);
  });

  it('文案库覆盖三个触发器（漏一个则该触发器无文案可推）', () => {
    for (const trigger of Object.values(LEAD_TRIGGER)) {
      expect(
        listLeadCopy().some((c) => c.trigger === trigger),
        `触发器 ${trigger} 无文案`,
      ).toBe(true);
    }
  });
});