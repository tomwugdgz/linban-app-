// ============================================================================
// 邻伴 · 健康活动感知 · 授权门闩接线（service 层，架构 §13）
// ----------------------------------------------------------------------------
// 职责：把 DB 行读成 domain 纯函数的入参形状 → 调用 → 拒绝时抛 AppError。
// 本文件**不含任何规则**（规则全在 domain/activity-consent.ts），只做 IO 与
// 错误映射。这条边界是刻意的：红线判定要能纯函数单测，而 IO 接线要能替换。
//
// A4 已闭环：activity_consents 有 purge_status / unaggregated_purged_at，
// 故撤销与清理解耦（裁定②）可完整实现：撤销即时停采、清理异步、完成后回写。
// ============================================================================

import {
  activity_consent_scope_level,
  activity_consent_status,
  activity_purge_status,
  AppError,
  family_binding_status,
} from '@linban/shared';
import { prisma } from '../../infra/prisma';
import { moduleLogger } from '../../common/logger';
import {
  ACTIVITY_SCOPE,
  CONSENT_DENY_REASON,
  assertConsent,
  isScopeVisibleToFamily,
  planRevoke,
} from '../../domain/activity-consent';
import type { ActivityScope, ConsentGateResult, ConsentLayer } from '../../domain/activity-consent';

const log = moduleLogger('activity');

/** 拒绝码映射：门闩 reason → 对外错误码（22001/22006 为主） */
function denyToAppError(result: ConsentGateResult, scope: ActivityScope): AppError {
  const message = result.impactNote ?? '健康活动感知授权校验未通过';
  // 总开关关闭与「已撤销停采」对外都是 403，但 message 区分（用户能看到确切原因）
  if (result.denyReason === CONSENT_DENY_REASON.WATCH_DISABLED) {
    return new AppError(22006, message);
  }
  if (result.denyReason === CONSENT_DENY_REASON.SCOPE_NOT_COVERED) {
    return new AppError(22001, message);
  }
  log.warn({ event: 'activity-consent-denied', reason: result.denyReason, scope }, '活动感知授权拒绝');
  return new AppError(22001, message);
}

/** 读老人本人层授权（含范围子表聚合） */
async function loadElderLayer(elderUserId: bigint): Promise<ConsentLayer | null> {
  const row = await prisma.activity_consents.findUnique({
    where: { elder_user_id: elderUserId },
    include: { scopes: { where: { revoked_at: null } } },
  });
  if (!row) return null;
  // 老人本人层的 scope 集合：本表 scopes 行挂 family_binding_id，
  // 故本人层的「采集范围授权」以 status=GRANTED 为准，
  // 具体采集数据类别由 FAMILY_VISIBLE 档位之外单独控制（见 sharingAllowed 判定）。
  return {
    status: row.status,
    scopes: [ACTIVITY_SCOPE.SUMMARY, ACTIVITY_SCOPE.ALERT, ACTIVITY_SCOPE.FAMILY_VISIBLE],
    expiresAt: null,
  };
}

/**
 * 读子女层授权（可能有多个子女，取「是否存在任一有效授权」）。
 * 注意：子女层只影响 **sharingAllowed**，不影响采集（Q9 安全兜底刻意偏离）。
 */
async function loadFamilyLayer(elderUserId: bigint): Promise<ConsentLayer | null> {
  const rows = await prisma.activity_consent_scopes.findMany({
    where: { consent: { elder_user_id: elderUserId }, revoked_at: null },
    include: { family_binding: true },
  });
  if (rows.length === 0) return null;
  // 存在任一生效绑定（active_key='A' 且未撤销）即视为子女层已授权 FAMILY_VISIBLE
  const effective = rows.some(
    (r) => r.family_binding?.active_key === 'A' && r.family_binding.status === family_binding_status.ACTIVE,
  );
  if (!effective) return null;
  return {
    status: activity_consent_status.GRANTED,
    scopes: [ACTIVITY_SCOPE.FAMILY_VISIBLE],
    expiresAt: null,
  };
}

/**
 * 采集门闩（ingest 入口专用）。
 * 顺序：总开关 → 老人本人层 → 范围覆盖。失败抛 AppError（22001/22006）。
 */
export async function assertCollectAllowed(
  elderUserId: bigint,
  scope: ActivityScope,
  now = new Date(),
): Promise<void> {
  const watchEnabled = await getWatchEnabled();
  const [elder, family] = await Promise.all([loadElderLayer(elderUserId), loadFamilyLayer(elderUserId)]);
  const result = assertConsent({ watchEnabled, elder, family, scope, now });
  if (!result.allowed) throw denyToAppError(result, scope);
}

/**
 * 读取判定（含 sharingAllowed），供隐私中心/看板复用——不抛错，返回判定结果。
 */
export async function evaluateConsent(
  elderUserId: bigint,
  scope: ActivityScope,
  now = new Date(),
): Promise<ConsentGateResult> {
  const watchEnabled = await getWatchEnabled();
  const [elder, family] = await Promise.all([loadElderLayer(elderUserId), loadFamilyLayer(elderUserId)]);
  return assertConsent({ watchEnabled, elder, family, scope, now });
}

/** 采集总开关（读system_configs，DB 优先回落 shared 默认 false） */
export async function getWatchEnabled(): Promise<boolean> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: 'activity_watch_enabled' } });
  if (!row) return false; // opt-in：配置缺失时视为关闭（fail-safe）
  return row.config_value === 'true';
}

/**
 * 一键关闭（红线④/裁定②）。
 * 即时停采 + 异步清理解耦：本方法只做「停采」与「标记待清理」，
 * 真正的批量清理由 retention sweep 依据 purge_status 扫描完成并回写确认态。
 *
 * 出参对齐契约 §13.3：`{ collecting:false, aggregateRetained:true, effectiveAt }`。
 */
export async function revokeConsent(elderUserId: bigint, now = new Date()): Promise<{
  collecting: false;
  aggregateRetained: true;
  effectiveAt: Date;
  note: string;
  purgeStatus: activity_purge_status;
}> {
  const plan = planRevoke(now);
  const existing = await prisma.activity_consents.findUnique({ where: { elder_user_id: elderUserId } });
  if (!existing) {
    // 无授权行=本就未采集；仍返回成功（幂等），并落一行 REVOKED 以留痕
    await prisma.activity_consents.create({
      data: {
        elder_user_id: elderUserId,
        status: activity_consent_status.REVOKED,
        policy_version: 'v1',
        revoked_at: plan.effectiveAt,
        collect_stopped_at: plan.effectiveAt,
        purge_status: activity_purge_status.NOT_STARTED,
      },
    });
    log.info({ event: 'activity-revoke', elder: String(elderUserId), hadRow: false }, '无授权行，幂等落REVOKED 留痕');
    return {
      collecting: false,
      aggregateRetained: true,
      effectiveAt: plan.effectiveAt,
      note: plan.note,
      purgeStatus: activity_purge_status.NOT_STARTED,
    };
  }

  // 已撤销：幂等回放，不重复写时间戳
  if (existing.status === activity_consent_status.REVOKED) {
    return {
      collecting: false,
      aggregateRetained: true,
      effectiveAt: existing.collect_stopped_at ?? existing.revoked_at ?? plan.effectiveAt,
      note: plan.note,
      purgeStatus: existing.purge_status,
    };
  }

  const updated = await prisma.activity_consents.update({
    where: { elder_user_id: elderUserId },
    data: {
      status: activity_consent_status.REVOKED,
      revoked_at: plan.effectiveAt,
      collect_stopped_at: plan.effectiveAt,
      device_stop_requested_at: plan.effectiveAt,
      // 撤销即标记待清理；清理由sweep 完成后回写 unaggregated_purged_at
      ...(existing.purge_status === activity_purge_status.NOT_STARTED
        || existing.purge_status === activity_purge_status.FAILED
        ? { purge_status: activity_purge_status.NOT_STARTED }
        : {}),
      purge_error: null,
    },
  });
  log.info(
    { event: 'activity-revoke', elder: String(elderUserId), purgeStatus: updated.purge_status },
    '健康活动感知已撤销（采集即时停止，清理异步执行）',
  );
  return {
    collecting: false,
    aggregateRetained: true,
    effectiveAt: updated.collect_stopped_at ?? plan.effectiveAt,
    note: plan.note,
    purgeStatus: updated.purge_status,
  };
}

/**
 * 越权面统一助手（契约 §13.3/§13.4/§13.6.1）：
 * 校验「当前登录者是否有权查看该老人的感知数据」。
 * · 本人 → 通过；
 * · 子女 → 需 family_bindings ACTIVE + 授权范围档位≥ required。
 * 失败统一抛 23004（不区分「不存在」与「无权限」，防存在性探测）。
 */
export async function assertActivityReadable(
  viewerUserId: bigint,
  elderUserId: bigint,
  required: Exclude<activity_consent_scope_level, 'NONE'>,
): Promise<void> {
  if (viewerUserId === elderUserId) return;
  const binding = await prisma.family_bindings.findFirst({
    where: {
      family_user_id: viewerUserId,
      elder_user_id: elderUserId,
      active_key: 'A',
      status: family_binding_status.ACTIVE,
      revoked_at: null,
    },
  });
  if (!binding) throw new AppError(23004, '无权查看该老人的健康活动数据');

  const scopeRow = await prisma.activity_consent_scopes.findFirst({
    where: { consent: { elder_user_id: elderUserId }, family_binding_id: binding.id, revoked_at: null },
  });
  if (!scopeRow || !isScopeVisibleToFamily(scopeRow.viewer_level, required)) {
    throw new AppError(23004, '无权查看该老人的健康活动数据');
  }
}