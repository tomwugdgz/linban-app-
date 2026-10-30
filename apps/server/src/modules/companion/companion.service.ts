// ============================================================================
// 邻伴 · companion 模块 service：入驻四审流 / 信用分 / 保证金 / 日程
// ----------------------------------------------------------------------------
// 四审流（架构 §6.6）状态推进全部经 domain/application-state-machine 校验；
// 信用分规则全部经 domain/credit-rules 计算（本文件只做 DB 副作用）。
// 资金纪律：保证金流水只插不更新，balance_after_fen 使任意时点余额可回放。
// ============================================================================

import { AppError } from '@linban/shared';
import {
  CREDIT_FREEZE_THRESHOLD_DEFAULT,
  CREDIT_LIMIT_THRESHOLD_DEFAULT,
  DEPOSIT_REFUND_GRACE_DAYS,
  HOURLY_RATE_MAX_FEN,
  HOURLY_RATE_MIN_FEN,
  SYSTEM_CONFIG_DEFAULTS,
  defaultConfigInt,
} from '@linban/shared';
import type { application_stage, credit_log_type, step_status } from '@linban/shared';
import { Prisma } from '@prisma/client';
import { prisma, withTransaction } from '../../infra/prisma';
import {
  CREDIT_THRESHOLDS_DEFAULT,
  applyCreditChange,
  assertValidScore,
  fixedDelta,
  isFrozen,
  isLimited,
  requiresBan,
} from '../../domain/credit-rules';
import {
  STEP_PASS_NEXT_STAGE,
  assertStageTransition,
  canAdvanceStage,
  isExamPassed,
  stageToCompanionStatus,
} from '../../domain/application-state-machine';
import { getRealnameAdapter } from '../../adapters/realname';
import { getFaceVerifyAdapter } from '../../adapters/face';
import { encrypt, hmacIndex, isCryptoConfigured } from '../../common/crypto';
import { genBizNo } from '../../common/ids';
import { moduleLogger } from '../../common/logger';

const log = moduleLogger('companion');

/** 读取 system_configs 热值（service 层统一入口；缓存由 admin 模块维护） */
async function getConfigInt(key: string): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  return row ? Number(row.config_value) : defaultConfigInt(key as keyof typeof SYSTEM_CONFIG_DEFAULTS);
}

// ---------------------------------------------------------------------------
// 入驻申请
// ---------------------------------------------------------------------------

export interface SubmitApplicationInput {
  realName: string;
  idCard: string;
  hourlyRateFen: bigint;
  serviceRadiusM?: number;
  tags?: string[];
  anchorLat: number;
  anchorLng: number;
}

/**
 * 提交入驻申请：创建/更新 companion 主档 + application（stage=APPLIED）。
 * 前置：账号角色 COMPANION、无在审申请（active_key='A' 唯一兜底）、
 * 身份证未注册（id_card_hmac unique）、时薪在产品定价带。
 */
export async function submitApplication(userId: bigint, input: SubmitApplicationInput) {
  const user = await prisma.users.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(10002, '账号不存在');
  if (user.role !== 'COMPANION') throw new AppError(10004, '仅陪聊员账号可提交入驻申请');

  // 在审申请查重
  const inReview = await prisma.companion_applications.findFirst({
    where: { companion: { user_id: userId }, active_key: 'A' },
  });
  if (inReview) throw new AppError(13003, '已有在审申请，请勿重复提交');

  if (input.hourlyRateFen < BigInt(HOURLY_RATE_MIN_FEN) || input.hourlyRateFen > BigInt(HOURLY_RATE_MAX_FEN)) {
    throw new AppError(10001, `时薪需在 ¥${HOURLY_RATE_MIN_FEN / 100}–¥${HOURLY_RATE_MAX_FEN / 100}/小时`, {
      hourlyRateFen: input.hourlyRateFen.toString(),
    });
  }
  if (!/^\d{17}[\dXx]$/.test(input.idCard)) throw new AppError(10001, '身份证号格式不正确');

  const idCardHmac = hmacIndex(input.idCard.toUpperCase(), false);
  const idCardCipher = isCryptoConfigured() ? encrypt(input.idCard.toUpperCase()) : `PLAIN_DEV:${input.idCard}`;
  const realNameCipher = isCryptoConfigured() ? encrypt(input.realName) : `PLAIN_DEV:${input.realName}`;

  // GPS 模糊化（架构 §5.3：全精度不落库，模糊至百米级后存锚点）
  const anchor = fuzzyLatLng(input.anchorLat, input.anchorLng);

  return withTransaction(async (tx) => {
    // 主档 upsert（身份证唯一：冲突抛 13013）
    let companion = await tx.companions.findUnique({ where: { user_id: userId } });
    if (companion) {
      if (companion.id_card_hmac !== idCardHmac) {
        const dup = await tx.companions.findUnique({ where: { id_card_hmac: idCardHmac } });
        if (dup) throw new AppError(13013, '该身份证已注册');
      }
      companion = await tx.companions.update({
        where: { id: companion.id },
        data: {
          real_name_cipher: realNameCipher,
          id_card_cipher: idCardCipher,
          id_card_hmac: idCardHmac,
          hourly_rate_fen: input.hourlyRateFen,
          service_radius_m: input.serviceRadiusM ?? 3000,
          anchor_lat: anchor.lat,
          anchor_lng: anchor.lng,
          geo_hash: anchor.geoHash,
          tags: input.tags ? (input.tags as Prisma.InputJsonValue) : Prisma.DbNull,
          status: 'PENDING',
        },
      });
    } else {
      const dup = await tx.companions.findUnique({ where: { id_card_hmac: idCardHmac } });
      if (dup) throw new AppError(13013, '该身份证已注册');
      companion = await tx.companions.create({
        data: {
          user_id: userId,
          real_name_cipher: realNameCipher,
          id_card_cipher: idCardCipher,
          id_card_hmac: idCardHmac,
          hourly_rate_fen: input.hourlyRateFen,
          service_radius_m: input.serviceRadiusM ?? 3000,
          anchor_lat: anchor.lat,
          anchor_lng: anchor.lng,
          geo_hash: anchor.geoHash,
          tags: input.tags ? (input.tags as Prisma.InputJsonValue) : Prisma.DbNull,
          credit_score: 100,
          deposit_balance_fen: 0n,
          status: 'PENDING',
        },
      });
    }

    const application = await tx.companion_applications.create({
      data: {
        application_no: genBizNo('application'),
        companion_id: companion.id,
        stage: 'APPLIED',
        active_key: 'A',
      },
    });
    log.info({ event: 'application-submitted', applicationNo: application.application_no, companionId: companion.id.toString() });
    return { applicationNo: application.application_no, stage: application.stage };
  });
}

/**
 * ① 实名步骤：OCR + 二要素 → PASSED 推进 REALNAME_OK。
 * OCR 结果回填证件信息（加密）；二要素不过 → REJECTED（申请终审）。
 */
export async function submitRealname(companionId: bigint, frontKey: string, backKey: string) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'APPLIED') throw new AppError(13004, '当前阶段不可提交实名');

  const realname = getRealnameAdapter();
  const ocr = await realname.ocrIdCard({ frontObjectKey: frontKey, backObjectKey: backKey });
  const two = await realname.verifyTwoElements({ name: ocr.name, idCard: ocr.idCard });

  if (!two.passed) {
    await prisma.companion_applications.update({
      where: { id: application.id },
      data: { realname_status: 'REJECTED', realname_reviewed_at: new Date(), realname_comment: two.reason ?? '二要素不一致', reject_reason: two.reason ?? '实名未通过', decided_at: new Date(), active_key: null },
    });
    // 同步吊销证件缓存不一致的实名信息（留档可回放）
    throw new AppError(13005, two.reason ?? '实名认证未通过');
  }

  // 通过：回填 OCR 证件信息 + 推进阶段
  return advanceAfterStepPass(application.id, companionId, 'realname', {
    real_name_cipher: isCryptoConfigured() ? encrypt(ocr.name) : `PLAIN_DEV:${ocr.name}`,
    id_card_cipher: isCryptoConfigured() ? encrypt(ocr.idCard.toUpperCase()) : `PLAIN_DEV:${ocr.idCard}`,
    id_card_hmac: hmacIndex(ocr.idCard.toUpperCase(), false),
    realname_ocr_biz_id: `mock_ocr_${Date.now()}`,
  });
}

/**
 * ② 人脸步骤：慧眼活体 + 底照比对 → PASSED 推进 FACE_OK。
 * 底照 file_meta 由 file 模块上传回调建立（此处只存引用）。
 */
export async function submitFace(companionId: bigint, videoKey: string, photoFileId: bigint | null) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'REALNAME_OK') throw new AppError(13004, '请先完成实名');

  const face = getFaceVerifyAdapter();
  const liveness = await face.livenessDetect({ videoObjectKey: videoKey });
  if (!liveness.passed) {
    await prisma.companion_applications.update({
      where: { id: application.id },
      data: { face_status: 'REJECTED', face_reviewed_at: new Date(), face_comment: '活体检测未通过', reject_reason: '活体检测未通过', decided_at: new Date(), active_key: null },
    });
    throw new AppError(13006, '活体检测未通过');
  }

  return advanceAfterStepPass(application.id, companionId, 'face', {
    face_verify_id: `mock_face_${Date.now()}`,
    face_score: 92, // mock 底照比对分
    face_photo_file_id: photoFileId,
    face_status: 'PASSED',
    face_reviewed_at: new Date(),
  });
}

/** ③ 无犯罪记录：上传材料（人工审核，step_status=PENDING，stage 不变） */
export async function submitCriminalMaterial(companionId: bigint, materialFileId: bigint) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'FACE_OK') throw new AppError(13004, '请先完成人脸核验');
  await prisma.companion_applications.update({
    where: { id: application.id },
    data: { criminal_material_file_id: materialFileId },
  });
  return { stage: application.stage, hint: '材料已提交，等待人工审核（1–3 个工作日）' };
}

/** 培训完成（进入 TRAINING） */
export async function completeTraining(companionId: bigint, courseIds: string[]) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'CRIMINAL_OK') throw new AppError(13004, '请先通过无犯罪记录审核');
  const now = new Date();
  const { count } = await prisma.companion_applications.updateMany({
    where: { id: application.id, stage: 'CRIMINAL_OK' },
    data: { stage: 'TRAINING', training_completed_at: now, training_course_ids: courseIds },
  });
  if (count === 0) throw new AppError(13004, '申请状态已变化');
  return { stage: 'TRAINING' as application_stage };
}

/** 认证考试（≥80 分通过 → EXAM_OK；不过可重考，attempt_no 累加） */
export async function submitExam(companionId: bigint, score: number) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'TRAINING') throw new AppError(13004, '请先完成培训课程');
  if (application.exam_attempt_no >= 3) throw new AppError(13008, '考试次数已用尽（3 次），请联系客服');

  const passed = isExamPassed(score);
  if (!passed) {
    await prisma.companion_applications.update({
      where: { id: application.id },
      data: { exam_score: score, exam_attempt_no: { increment: 1 } },
    });
    throw new AppError(13007, `考试未通过（得分 ${score}，需 ≥80）`);
  }
  const { count } = await prisma.companion_applications.updateMany({
    where: { id: application.id, stage: 'TRAINING' },
    data: {
      stage: 'EXAM_OK',
      exam_score: score,
      exam_attempt_no: { increment: 1 },
      exam_passed_at: new Date(),
    },
  });
  if (count === 0) throw new AppError(13004, '申请状态已变化');
  return { stage: 'EXAM_OK' as application_stage, score };
}

/**
 * ④ 保证金：创建微信支付单（mock 适配器）。
 * 支付回调（payment 模块）成功后：写 deposit_transactions(IN) + 推进
 * DEPOSIT_OK → ACTIVE。此处只创建支付单。
 */
export async function createDepositPayment(companionId: bigint, idempotencyKey: string) {
  const application = await getActiveApplication(companionId);
  if (application.stage !== 'EXAM_OK') throw new AppError(13004, '请先通过认证考试');
  const amountFen = BigInt(await getConfigInt('deposit_amount'));

  // 幂等：同 idempotency_key 直接返回原支付单
  const existing = await prisma.deposit_transactions.findUnique({ where: { idempotency_key: idempotencyKey } });
  if (existing) {
    return { txNo: existing.tx_no, amountFen: existing.amount_fen.toString(), status: existing.status };
  }

  const tx = await prisma.deposit_transactions.create({
    data: {
      tx_no: genBizNo('depositTx'),
      companion_id: companionId,
      type: 'IN',
      amount_fen: amountFen,
      balance_after_fen: 0n, // 回调成功后回填（先占位）
      status: 'PENDING',
      related_type: 'APPLICATION',
      related_id: application.id,
      idempotency_key: idempotencyKey,
    },
  });
  // TODO(payment)：微信 JSAPI 下单（getWxPayAdapter().jsapiPrepay），prepay 参数返回前端
  // mock 环境直接返回 PENDING 单，由 payment 模块的补偿任务或后台确认推进
  return { txNo: tx.tx_no, amountFen: amountFen.toString(), status: tx.status };
}

/**
 * 保证金到账确认（支付回调或后台确认调用）：
 * 同事务 deposit_transactions→SUCCESS + companions 余额缓存 + 阶段推进。
 */
export async function confirmDepositPaid(txNo: string, wxTransactionId: string) {
  return withTransaction(async (tx) => {
    const depositTx = await tx.deposit_transactions.findUnique({ where: { tx_no: txNo } });
    if (!depositTx) throw new AppError(13009, '保证金流水不存在');
    if (depositTx.status !== 'PENDING') return { alreadyDone: true };

    const companion = await tx.companions.findUnique({ where: { id: depositTx.companion_id } });
    if (!companion) throw new AppError(13001, '陪聊员不存在');

    // 1) 流水 → SUCCESS（balance_after 可回放）
    const balanceAfter = companion.deposit_balance_fen + depositTx.amount_fen;
    await tx.deposit_transactions.update({
      where: { id: depositTx.id },
      data: { status: 'SUCCESS', balance_after_fen: balanceAfter, wx_transaction_id: wxTransactionId, succeeded_at: new Date() },
    });
    // 2) 主档余额缓存 + 阶段 DEPOSIT_OK → ACTIVE
    await tx.companions.update({ where: { id: companion.id }, data: { deposit_balance_fen: balanceAfter } });
    const application = await tx.companion_applications.findFirst({
      where: { companion_id: companion.id, active_key: 'A' },
    });
    if (application && application.stage === 'EXAM_OK') {
      await tx.companion_applications.updateMany({
        where: { id: application.id, stage: 'EXAM_OK' },
        data: {
          stage: 'DEPOSIT_OK',
          deposit_tx_id: depositTx.id,
          deposit_amount_fen: depositTx.amount_fen,
          deposit_paid_at: new Date(),
        },
      });
      // DEPOSIT_OK → ACTIVE：四审通过上架
      await tx.companion_applications.updateMany({
        where: { id: application.id, stage: 'DEPOSIT_OK' },
        data: { stage: 'ACTIVE', decided_at: new Date(), active_key: null },
      });
      await tx.companions.update({ where: { id: companion.id }, data: { status: 'ACTIVE' } });
    }
    log.info({ event: 'deposit-confirmed', txNo, companionId: companion.id.toString() });
    return { alreadyDone: false, balanceAfterFen: balanceAfter.toString() };
  });
}

// ---------------------------------------------------------------------------
// 信用分
// ---------------------------------------------------------------------------

/**
 * 应用一次信用分变更（domain 规则 + credit_logs 流水 + 主档缓存）。
 * 飞单坐实联动：companion → BANNED（保证金罚扣在 penalty 流程单独做）。
 */
export async function applyCredit(
  companionId: bigint,
  type: credit_log_type,
  opts: { delta?: number; reason: string; relatedOrderId?: bigint; operatorId?: bigint },
) {
  const companion = await prisma.companions.findUnique({ where: { id: companionId } });
  if (!companion) throw new AppError(13001, '陪聊员不存在');
  assertValidScore(companion.credit_score);

  const delta = opts.delta ?? fixedDelta(type);
  if (delta === null || delta === undefined) {
    throw new AppError(10001, `事由 ${type} 必须显式传入变更量`);
  }
  if (Math.abs(delta) > 20) throw new AppError(10001, '单次信用分变更不得超过 ±20');

  const result = applyCreditChange(companion.credit_score, delta, CREDIT_THRESHOLDS_DEFAULT);
  const ban = requiresBan(type);

  await withTransaction(async (tx) => {
    // 流水只插不更新（可回放）
    await tx.credit_logs.create({
      data: {
        companion_id: companionId,
        change_score: result.change,
        type,
        before_score: result.before,
        after_score: result.after,
        reason: opts.reason,
        related_order_id: opts.relatedOrderId ?? null,
        operator_id: opts.operatorId ?? null,
      },
    });
    await tx.companions.update({
      where: { id: companionId },
      data: {
        credit_score: result.after,
        // 飞单坐实 → 清退（保证金罚扣走 penalty_records 流程）
        ...(ban ? { status: 'BANNED' as const } : {}),
      },
    });
  });

  return {
    before: result.before,
    after: result.after,
    limited: result.limited,
    frozen: result.frozen,
    banned: ban,
  };
}

/** 接单前置校验：ACTIVE + 信用分 ≥ 冻结阈值（domain 判定） */
export async function ensureCompanionAcceptable(companionId: bigint) {
  const companion = await prisma.companions.findUnique({ where: { id: companionId } });
  if (!companion) throw new AppError(13001, '陪聊员不存在');
  if (companion.status !== 'ACTIVE') throw new AppError(13011, `陪聊员状态 ${companion.status}，不可接单`);
  if (isFrozen(companion.credit_score)) {
    throw new AppError(13012, `信用分 ${companion.credit_score} 低于冻结阈值，已停止接单`);
  }
  return companion;
}

/** 限流判定（派单引擎用：<60 限流派单） */
export async function isCompanionLimited(companionId: bigint): Promise<boolean> {
  const companion = await prisma.companions.findUnique({ where: { id: companionId } });
  if (!companion) return true;
  return isLimited(companion.credit_score);
}

// ---------------------------------------------------------------------------
// 保证金充足性（罚扣前置）
// ---------------------------------------------------------------------------

/** 保证金余额是否足够罚扣 */
export async function ensureDepositSufficient(companionId: bigint, penaltyFen: bigint): Promise<void> {
  const companion = await prisma.companions.findUnique({ where: { id: companionId } });
  if (!companion) throw new AppError(13001, '陪聊员不存在');
  if (companion.deposit_balance_fen < penaltyFen) {
    throw new AppError(13010, `保证金余额不足（余 ${companion.deposit_balance_fen} 分，需 ${penaltyFen} 分）`);
  }
}

/** 退出退还冷静期（天） */
export function depositRefundGraceDays(): number {
  return DEPOSIT_REFUND_GRACE_DAYS;
}

// ---------------------------------------------------------------------------
// 内部助手
// ---------------------------------------------------------------------------

/** 取在审申请（无则 13002） */
async function getActiveApplication(companionId: bigint) {
  const application = await prisma.companion_applications.findFirst({
    where: { companion_id: companionId, active_key: 'A' },
  });
  if (!application) throw new AppError(13002, '没有在审的入驻申请');
  return application;
}

/** 步骤通过后：写 step 结果 + 推进 stage（domain 校验 + 乐观并发） */
async function advanceAfterStepPass(
  applicationId: bigint,
  companionId: bigint,
  step: 'realname' | 'face',
  extraData: Record<string, unknown>,
) {
  const application = await prisma.companion_applications.findUnique({ where: { id: applicationId } });
  if (!application) throw new AppError(13002, '申请不存在');
  const nextStage = STEP_PASS_NEXT_STAGE[step];
  assertStageTransition(application.stage, nextStage);
  if (!canAdvanceStage(application.stage, nextStage)) {
    throw new AppError(13004, `${application.stage} 不可推进到 ${nextStage}`);
  }

  await withTransaction(async (tx) => {
    const { count } = await tx.companion_applications.updateMany({
      where: { id: applicationId, stage: application.stage },
      data: { stage: nextStage, ...extraData },
    });
    if (count === 0) throw new AppError(13004, '申请状态已被其他操作推进');
    // 主档状态同步（PENDING 阶段仍为 PENDING，不提前 ACTIVE）
    await tx.companions.update({
      where: { id: companionId },
      data: { status: stageToCompanionStatus(nextStage) },
    });
  });
  return { stage: nextStage };
}

/**
 * GPS 模糊化（架构 §5.3：百米级）。
 * 保留 3 位小数 ≈ 110m 精度；geohash 用 5 字符前缀（≈ ±2.4km，
 * 配合 status 索引做候选扫描，精确距离在内存打分）。
 */
export function fuzzyLatLng(lat: number, lng: number): { lat: number; lng: number; geoHash: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new AppError(10001, '坐标不合法');
  }
  // 广州业务范围粗校验（MVP 单城）
  if (lat < 22.5 || lat > 24.5 || lng < 112.5 || lng > 114.5) {
    throw new AppError(10001, '锚点超出广州服务范围（MVP 单城）');
  }
  const flat = Math.round(lat * 1000) / 1000;
  const flng = Math.round(lng * 1000) / 1000;
  return { lat: flat, lng: flng, geoHash: encodeGeoHash(flat, flng, 5) };
}

/** 简化 geohash 编码（5 字符 base32，与常见 geohash 库前缀兼容） */
function encodeGeoHash(lat: number, lng: number, precision: number): string {
  const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '';
  let bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) { ch |= 1 << (4 - bit); lngMin = mid; } else { lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) { ch |= 1 << (4 - bit); latMin = mid; } else { latMax = mid; }
    }
    even = !even;
    if (bit < 4) { bit++; } else { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export { getConfigInt };
