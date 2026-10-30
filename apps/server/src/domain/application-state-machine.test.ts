// 四审状态机单测：主链路、非法跳跃、暂停/清退、考试线（架构 §6.6）
import { describe, expect, it } from 'vitest';
import type { application_stage } from '@linban/shared';
import {
  APPLICATION_STAGE_TRANSITIONS,
  EXAM_PASS_SCORE,
  assertStageTransition,
  canAdvanceStage,
  isExamPassed,
  isStageTerminal,
  nextStages,
  stageToCompanionStatus,
} from './application-state-machine';

const ALL_STAGES = Object.keys(APPLICATION_STAGE_TRANSITIONS) as application_stage[];

describe('四审状态机 · 转移表完整性', () => {
  it('覆盖 10 个阶段（架构 §6.6）', () => {
    expect(ALL_STAGES).toHaveLength(10);
    expect(new Set(ALL_STAGES).size).toBe(10);
  });

  it('主链路全部合法（APPLIED→…→ACTIVE）', () => {
    const path: application_stage[] = [
      'APPLIED',
      'REALNAME_OK',
      'FACE_OK',
      'CRIMINAL_OK',
      'TRAINING',
      'EXAM_OK',
      'DEPOSIT_OK',
      'ACTIVE',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canAdvanceStage(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('运营处置链路合法（ACTIVE↔SUSPENDED，SUSPENDED→BANNED）', () => {
    expect(canAdvanceStage('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canAdvanceStage('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canAdvanceStage('SUSPENDED', 'BANNED')).toBe(true);
  });
});

describe('四审状态机 · 非法流转拒绝', () => {
  it.each<[application_stage, application_stage]>([
    // 跳过步骤（四审不可并行/跳步）
    ['APPLIED', 'FACE_OK'],
    ['APPLIED', 'ACTIVE'],
    ['REALNAME_OK', 'CRIMINAL_OK'],
    ['FACE_OK', 'TRAINING'],
    ['CRIMINAL_OK', 'EXAM_OK'],
    ['TRAINING', 'DEPOSIT_OK'],
    ['EXAM_OK', 'ACTIVE'],
    // 未缴保证金不可上架
    ['EXAM_OK', 'SUSPENDED'],
    // 在审阶段不可被暂停（仅 ACTIVE 可）
    ['APPLIED', 'SUSPENDED'],
    ['TRAINING', 'SUSPENDED'],
    // 回退：已过的步骤不倒退（重走须重新提交申请）
    ['REALNAME_OK', 'APPLIED'],
    ['EXAM_OK', 'TRAINING'],
    ['ACTIVE', 'DEPOSIT_OK'],
    // 清退为终态
    ['BANNED', 'ACTIVE'],
    ['BANNED', 'SUSPENDED'],
  ])('%s → %s 被拒绝', (from, to) => {
    expect(canAdvanceStage(from, to)).toBe(false);
    expect(() => assertStageTransition(from, to)).toThrowError(/四审流程不允许的流转/);
  });

  it('assertTransition 错误码为 13004', () => {
    try {
      assertStageTransition('APPLIED', 'ACTIVE');
      expect.unreachable();
    } catch (e) {
      expect((e as { code: number }).code).toBe(13004);
    }
  });
});

describe('四审状态机 · 谓词与映射', () => {
  it('BANNED 为终态', () => {
    expect(isStageTerminal('BANNED')).toBe(true);
    expect(isStageTerminal('ACTIVE')).toBe(false);
    expect(isStageTerminal('APPLIED')).toBe(false);
  });

  it('考试通过线 80 分（§6.6）', () => {
    expect(EXAM_PASS_SCORE).toBe(80);
    expect(isExamPassed(80)).toBe(true);
    expect(isExamPassed(79)).toBe(false);
    expect(isExamPassed(100)).toBe(true);
    expect(isExamPassed(0)).toBe(false);
    expect(isExamPassed(null)).toBe(false);
  });

  it('阶段 → companion 主档状态映射', () => {
    expect(stageToCompanionStatus('APPLIED')).toBe('PENDING');
    expect(stageToCompanionStatus('TRAINING')).toBe('PENDING');
    expect(stageToCompanionStatus('DEPOSIT_OK')).toBe('PENDING');
    expect(stageToCompanionStatus('ACTIVE')).toBe('ACTIVE');
    expect(stageToCompanionStatus('SUSPENDED')).toBe('SUSPENDED');
    expect(stageToCompanionStatus('BANNED')).toBe('BANNED');
  });

  it('后继集合查询', () => {
    expect([...nextStages('SUSPENDED')].sort()).toEqual(['ACTIVE', 'BANNED']);
    expect(nextStages('BANNED')).toEqual([]);
  });
});
