// ============================================================================
// 邻伴 · 陪聊员入驻四审状态机（10 态，架构 §6.6 单一事实源）
// ----------------------------------------------------------------------------
// 主链路（线性四审 + 培训考试 + 保证金）：
//   APPLIED → REALNAME_OK → FACE_OK → CRIMINAL_OK → TRAINING → EXAM_OK
//     → DEPOSIT_OK → ACTIVE
// 运营处置：
//   ACTIVE → SUSPENDED（投诉 / 信用分低于阈值 / 审核抽检不合格）
//   SUSPENDED → ACTIVE（复审通过）
//   SUSPENDED → BANNED（黑名单清退，保证金罚扣）
//
// 关于单步 REJECTED：§6.6 状态图未画回退边。服务层约定（不在本状态机内）：
//   任一步骤 step_status=REJECTED → 申请终审（active_key 置 NULL），
//   companion 主档保持 PENDING，陪聊员可重新提交新申请（新 application_no）。
//   已通过的步骤在重新申请时需重新走查（材料可能过期），MVP 不做步骤豁免。
// ============================================================================

import { AppError } from '@linban/shared';
import type { application_stage, step_status } from '@linban/shared';

/** 四审阶段转移表（合法 from → to 集合） */
export const APPLICATION_STAGE_TRANSITIONS: Readonly<
  Record<application_stage, readonly application_stage[]>
> = Object.freeze({
  APPLIED: ['REALNAME_OK'], // ①实名：OCR 身份证 + 二要素核验通过
  REALNAME_OK: ['FACE_OK'], // ②人脸：慧眼活体 + 底照留存通过
  FACE_OK: ['CRIMINAL_OK'], // ③无犯罪记录：材料人工审核通过
  CRIMINAL_OK: ['TRAINING'], // 进入培训课程（服务边界/适老沟通/安全）
  TRAINING: ['EXAM_OK'], // 认证考试 ≥80 分通过
  EXAM_OK: ['DEPOSIT_OK'], // ④保证金缴纳完成（默认 ¥500=50000 分，可配）
  DEPOSIT_OK: ['ACTIVE'], // 四审通过，上架接单
  ACTIVE: ['SUSPENDED'], // 投诉 / 信用分低于阈值 / 抽检不合格
  SUSPENDED: ['ACTIVE', 'BANNED'], // 复审通过 / 黑名单清退
  BANNED: [], // 终态
});

/** 四审步骤键（对应 companion_applications 每步列组） */
export type ApplicationStep = 'realname' | 'face' | 'criminal' | 'exam' | 'deposit';

/** 每一步骤通过后应进入的阶段（服务层按 step 推进 stage） */
export const STEP_PASS_NEXT_STAGE: Readonly<Record<ApplicationStep, application_stage>> = Object.freeze({
  realname: 'REALNAME_OK',
  face: 'FACE_OK',
  criminal: 'CRIMINAL_OK',
  // exam 步骤对应 TRAINING → EXAM_OK；deposit 对应 EXAM_OK → DEPOSIT_OK
  exam: 'EXAM_OK',
  deposit: 'DEPOSIT_OK',
});

/** 判断一次阶段推进是否合法 */
export function canAdvanceStage(from: application_stage, to: application_stage): boolean {
  return APPLICATION_STAGE_TRANSITIONS[from].includes(to);
}

/** 某阶段的合法后继集合 */
export function nextStages(from: application_stage): readonly application_stage[] {
  return APPLICATION_STAGE_TRANSITIONS[from];
}

/** 终态：BANNED（不可恢复） */
export function isStageTerminal(stage: application_stage): boolean {
  return APPLICATION_STAGE_TRANSITIONS[stage].length === 0;
}

/** ACTIVE 为「四审通过」成功态（仍可被 SUSPENDED） */
export function isStageActive(stage: application_stage): boolean {
  return stage === 'ACTIVE';
}

/** 断言阶段推进合法，非法抛 AppError(13004) */
export function assertStageTransition(from: application_stage, to: application_stage): void {
  if (!canAdvanceStage(from, to)) {
    throw new AppError(13004, `${from} → ${to}`, {
      from,
      to,
      allowed: [...APPLICATION_STAGE_TRANSITIONS[from]],
    });
  }
}

/** 步骤结果是否通过 */
export function isStepPassed(s: step_status): boolean {
  return s === 'PASSED';
}

/** 考试通过线（架构 §6.6：≥80 分） */
export const EXAM_PASS_SCORE = 80;

/** 考试是否通过（分数 ≥ EXAM_PASS_SCORE；null 视为未考） */
export function isExamPassed(score: number | null): boolean {
  return score !== null && score >= EXAM_PASS_SCORE;
}

/** 阶段对应的 companion 主档状态映射（companion_status 五态）：
 *  DEPOSIT_OK 之前的在审阶段 → PENDING；ACTIVE → ACTIVE；
 *  SUSPENDED → SUSPENDED；BANNED → BANNED。 */
export function stageToCompanionStatus(
  stage: application_stage,
): 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'BANNED' {
  switch (stage) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'BANNED':
      return 'BANNED';
    default:
      return 'PENDING';
  }
}
