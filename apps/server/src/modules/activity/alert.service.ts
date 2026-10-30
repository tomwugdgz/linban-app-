// ============================================================================
// 邻伴 · 健康活动感知 · 告警生成与升级（service 层，架构 §13.5 / PRD §8）
// ----------------------------------------------------------------------------
// 告警状态流**自闭环**（Q11 裁定）：OPEN → ACKNOWLEDGED → PROCESSING → RESOLVED
//                              / DISMISSED / ESCALATED
//   · 不新建工单表；仅 escalate（对外追责/赔付）时才落 complaints；
//   · complaints.complainant_id 为 NOT NULL FK → 用**系统服务账号**兜底（Q11）。
//
// 交叉验证门闩（不可绕过）：URGENT 必须crossVerifySatisfied=true（A、B 双通道
// 有效 **且** 交叉源命中）。不通过一律降级 WARN 等人工确认并抛 24004——
// 这是把红线变成代码，而不是让调用方自觉。
//
// Q9 安全兜底不设付费墙：久静/离线的 URGENT 路径**不查订阅状态**，
// 代码里刻意不出现任何 subscription 门闩（此注释即为证据）。
// ============================================================================

import { AppError, health_alert_status } from '@linban/shared';
import type { health_alert_level } from '@linban/shared';
import { prisma, withTransaction } from '../../infra/prisma';
import { genBizNo } from '../../common/ids';
import { moduleLogger } from '../../common/logger';
import { crossVerifySatisfied, shouldSuppressAlert } from '../../domain/activity';
import { sendNotification } from '../notification/notification.routes';
import { suspendOrderForSafety } from '../order/order.service';

const log = moduleLogger('activity');

/** 系统服务账号的 openid 约定（Q11：escalate / 自动 ack 时记该账号，audit_logs 留痕） */
export const SYSTEM_SERVICE_OPENID = 'sys_health_alert';

/** 事务客户端的最小能力集（PrismaClient 与 TransactionClient 都满足） */
type UserStore = Pick<typeof prisma, 'users'>;

/**
 * 取系统服务账号（A2 已定稿：users 表标记，**不建独立表**）。
 *
 * 为什么必须是 users 表：complaints.complainant_id 是指向 users 的 NOT NULL FK，
 * 独立表无法被该 FK 引用（宋砚秋已验证并回退该方案）。
 *
 * 三条硬约束（schema 注释 + 主理人裁定 A2）：
 *   · role = SYSTEM、is_system = true —— 不得用 ELDER 充数，
 *     那会让老人角色统计口径凭空多出一个假老人（后台看板直接错）；
 *   · is_system = true 的账号**不可登录**（authMiddleware 守卫）；
 *   · 不计入任何用户数/陪聊员数/活跃统计（查询侧一律带 is_system=false）。
 *
 * 幂等：按 openid 唯一索引取；并发下race 由唯一索引兜底（P2002 → 回查）。
 */
export async function getSystemServiceAccountId(tx: UserStore = prisma): Promise<bigint> {
  const existing = await tx.users.findUnique({ where: { openid: SYSTEM_SERVICE_OPENID } });
  if (existing) return existing.id;
  try {
    const created = await tx.users.create({
      data: {
        openid: SYSTEM_SERVICE_OPENID,
        nickname: '系统服务账号',
        role: 'SYSTEM',
        is_system: true,
      },
      select: { id: true },
    });
    log.info(
      { event: 'activity-system-account-created', userId: created.id.toString() },
      '已创建系统服务账号（role=SYSTEM, is_system=true）',
    );
    return created.id;
  } catch (e) {
    // 并发创建撞 openid 唯一索引 → 回查（另一个请求已建好）
    if ((e as { code?: string })?.code !== 'P2002') throw e;
    const again = await tx.users.findUnique({
      where: { openid: SYSTEM_SERVICE_OPENID },
      select: { id: true },
    });
    if (!again) throw e;
    return again.id;
  }
}

/** 告警生成入参 */
export interface RaiseAlertInput {
  elderUserId: bigint;
  deviceId?: bigint | null;
  summaryId?: bigint | null;
  type: 'STILL_TOO_LONG' | 'FALL_SUSPECT' | 'DEVICE_OFFLINE' | 'NOCTURNAL_ACTIVITY' | 'LOW_TREND' | 'RESPIRATORY_TREND';
  /** 触发明则编码（explain_code 语义，落 triggered_by_rule） */
  triggeredByRule: string;
  /** 置信度 0–1（domain 口径），落库转 0–100 */
  confidence: number;
  /** 来源通道 */
  sourceChannel?: 'CHANNEL_A_APP' | 'CHANNEL_B_GATEWAY' | null;
  /** 期望级别；URGENT 会被交叉验证门闩强制降级 */
  desiredLevel: health_alert_level;
  /** 交叉验证证据（required=true 时三者需同时成立） */
  crossVerify: { channelAValid: boolean; channelBValid: boolean; crossSourceHit: boolean };
  /** 是否需要订单联动挂起（久静/离线且有在服务订单） */
  orderId?: bigint | null;
  now?: Date;
}

export interface RaiseAlertResult {
  alertId: string;
  alertNo: string;
  level: health_alert_level;
  /** 是否被交叉验证门闩降级 */
  downgraded: boolean;
  /** 是否因抑制窗口被跳过 */
  suppressed: boolean;
}

/**
 * 生成告警（含抑制窗口与交叉验证门闩）。
 * 抑制窗口：同老人 + 同类型告警在 activity_alert_suppress_min 内不重复推送。
 */
export async function raiseAlert(input: RaiseAlertInput): Promise<RaiseAlertResult> {
  const now = input.now ?? new Date();

  // 闸 1：交叉验证门闩——URGENT 必须双通道交叉通过，否则降级 WARN
  const verified = crossVerifySatisfied({ ...input.crossVerify, required: true });
  const downgraded = input.desiredLevel === 'URGENT' && !verified;
  const level: health_alert_level = downgraded ? 'WARN' : input.desiredLevel;

  // 闸 2：抑制窗口（同老人 + 同类型 + 未过窗口 → 跳过，不重复推送）
  const last = await prisma.health_alerts.findFirst({
    where: { elder_user_id: input.elderUserId, type: input.type },
    orderBy: { triggered_at: 'desc' },
    select: { id: true, triggered_at: true },
  });
  const suppressMin = await getConfigInt('activity_alert_suppress_min', 180);
  if (last && shouldSuppressAlert({ lastAlertAt: last.triggered_at, suppressWindowMin: suppressMin, now })) {
    log.debug(
      { event: 'activity-alert-suppressed', elder: String(input.elderUserId), type: input.type },
      '同类告警处于抑制窗口内，跳过（24003）',
    );
    return {
      alertId: last.id.toString(),
      alertNo: '',
      level,
      downgraded,
      suppressed: true,
    };
  }

  const alertNo = genBizNo('healthAlert');
  const created = await prisma.health_alerts.create({
    data: {
      alert_no: alertNo,
      elder_user_id: input.elderUserId,
      device_id: input.deviceId ?? null,
      summary_id: input.summaryId ?? null,
      type: input.type,
      level,
      status: 'OPEN',
      confidence: Math.round(input.confidence * 100),
      is_reference_only: true, // 红线⑤恒为参考指标
      source_channel: input.sourceChannel ?? 'CHANNEL_A_APP',
      triggered_by_rule: input.triggeredByRule,
      triggered_at: now,
      order_id: input.orderId ?? null,
    },
    select: { id: true },
  });

  // 抑制窗口截止时点（落库便于前端展示「预计恢复推送时间」）
  await prisma.health_alerts.update({
    where: { id: created.id },
    data: { suppressed_until: new Date(now.getTime() + suppressMin * 60000) },
  });

  // 触点埋点（漏斗第4 层 ALERT_RAISED）
  await prisma.activity_touchpoints.create({
    data: {
      elder_user_id: input.elderUserId,
      event_type: 'ALERT_RAISED',
      funnel_stage: 'ALERT_RAISED',
      source_channel: input.sourceChannel ?? 'CHANNEL_A_APP',
      alert_id: created.id,
      order_id: input.orderId ?? null,
      touchpoint_at: now,
    },
  });

  // URGENT 人工兜底（Q9：不设付费墙，订阅状态不参与判断）
  if (level === 'URGENT') {
    await notifyUrgentFallback(input.elderUserId, input.type, created.id, now);
  }

  log.info(
    { event: 'activity-alert-raised', alert: alertNo, type: input.type, level, downgraded },
    '健康告警已生成',
  );

  return {
    alertId: created.id.toString(),
    alertNo,
    level,
    downgraded,
    suppressed: false,
  };
}

/**
 * URGENT 人工兜底通知（与 SOS 同出口，Q9）。
 * 顺序：到岗态订单挂起 → 紧急联系人/子女通知 → 落投诉工单。
 */
/** URGENT / escalate 的 SOS 出口结果（精确信号，不做状态推断） */
export interface UrgentFallbackResult {
  /** 是否真的挂起了订单（读 suspendOrderForSafety 返回值，非推断） */
  orderSuspended: boolean;
  /** 成功通知到几个子女 */
  notifiedFamilyCount: number;
  /** 未挂起的原因（运营判读用；null = 已挂起或无待挂订单） */
  orderSkipReason: string | null;
}

async function notifyUrgentFallback(
  elderUserId: bigint,
  type: RaiseAlertInput['type'],
  alertId: bigint,
  now: Date,
): Promise<UrgentFallbackResult> {
  const result: UrgentFallbackResult = {
    orderSuspended: false,
    notifiedFamilyCount: 0,
    orderSkipReason: null,
  };

  // ① 订单联动：仅挂起到岗态订单（ACCEPTED/ARRIVED/IN_SERVICE）
  const activeOrder = await prisma.orders.findFirst({
    where: {
      elder_user_id: elderUserId,
      status: { in: ['ACCEPTED', 'ARRIVED', 'IN_SERVICE'] },
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, order_no: true, status: true },
  });
  if (activeOrder) {
    try {
      // 精确信号：读 suspendOrderForSafety 的返回值，不靠 order_id 前后差推断
      const suspended = await suspendOrderForSafety(
        { id: activeOrder.id, order_no: activeOrder.order_no, status: activeOrder.status },
        `健康告警自动挂起（type=${type}）：安全兜底不设付费墙，URGENT 立即转人工核实`,
        { type: 'SYSTEM' },
        'auto_suspend',
      );
      result.orderSuspended = suspended.suspended;
      result.orderSkipReason = suspended.skipReason ?? null;
      if (suspended.suspended) {
        await prisma.health_alerts.update({ where: { id: alertId }, data: { order_id: activeOrder.id } });
      }
    } catch (e) {
      // 挂起失败不阻断告警本身（告警已落库，人工仍会看到）
      result.orderSkipReason = (e as Error)?.message ?? '挂起异常';
      log.error({ event: 'activity-alert-suspend-failed', alertId: alertId.toString() }, '告警联动挂起失败');
    }
  } else {
    result.orderSkipReason = '无到岗态订单';
  }

  // ② 通知：先IM（绑定子女），再降级短信
  const bindings = await prisma.family_bindings.findMany({
    where: { elder_user_id: elderUserId, active_key: 'A', status: 'ACTIVE' },
    select: { family_user_id: true },
  });
  const typeText = type === 'STILL_TOO_LONG' ? '长时间未检测到活动' : type === 'DEVICE_OFFLINE' ? '感知设备离线' : '健康提醒';
  let notified = 0;
  for (const b of bindings) {
    try {
      await sendNotification({
        targetUserId: b.family_user_id,
        channel: 'IM_SYSTEM',
        title: '健康提醒',
        content: `您的家人${typeText}，工作人员将尽快联系您核实。以上为参考指标，非医疗诊断。`,
        bizType: 'ACTIVITY_ALERT_URGENT',
      });
      notified += 1;
    } catch {
      // 单个失败不阻断其他接收人
    }
  }
  result.notifiedFamilyCount = notified;
  // 无生效子女绑定时不硬发短信（无收件人，且 sendSmsDirect 是验证码专用通道）；
  // 改由 cron 重试 + 客服工作台兜底，避免「通知发不出去」被误认为已通知。
  if (notified === 0) {
    log.warn(
      { event: 'activity-urgent-no-recipient', alertId: alertId.toString() },
      'URGENT 告警无生效子女绑定，通知未送达——转客服工作台人工外呼',
    );
  }
  log.warn(
    { event: 'activity-urgent-fallback', alertId: alertId.toString(), notified, at: now.toISOString() },
    'URGENT 人工兜底已触发',
  );
  return result;
}

/**
 * 升级对外追责（契约 §13.6 escalate 端点）。
 *
 * **工单 + SOS 出口两条并存**（主理人裁定）：工单是留痕与追责载体（事后可查谁
 * 处理了哪条告警、依据是什么），SOS 出口是时效保障（老人真出事不能等工单流程
 * 走完）。只有工单没出口 → 紧急情况会慢；只有出口没工单 → 事后无从追溯。
 *
 * 顺序刻意是「先落工单（事务内），再走出口（事务外）」：
 * 工单是**追责凭证**，必须先保证落库成功；出口失败（挂起失败/通知发不出）
 * 只记 warn 不回滚工单——老人已经处于风险中，此时因为通知失败而丢掉追责凭证，
 * 是把「可追溯」让给了「时效」，方向错了。
 */
export async function escalateAlert(
  alertId: bigint,
  adminId: bigint,
  crossVerify: { channelAValid: boolean; channelBValid: boolean; crossSourceHit: boolean },
  requestId?: string,
): Promise<{
  complaintId: string;
  complaintNo: string;
  alertStatus: string;
  sos: { orderSuspended: boolean; notifiedFamilyCount: number };
}> {
  // 闸 1：交叉验证门闩——不通过一律拒绝（24004），这是红线不可绕过的证据
  if (!crossVerifySatisfied({ ...crossVerify, required: true })) {
    throw new AppError(24004, '交叉验证不足，需人工确认后方可升级对外追责');
  }

  const alert = await prisma.health_alerts.findUnique({
    where: { id: alertId },
    select: {
      id: true,
      alert_no: true,
      elder_user_id: true,
      type: true,
      status: true,
      order_id: true,
      triggered_at: true,
    },
  });
  if (!alert) throw new AppError(24001, '告警不存在');
  if (['RESOLVED', 'DISMISSED', 'ESCALATED'].includes(alert.status)) {
    throw new AppError(24002, '该告警已处置，不可重复升级');
  }

  const result = await withTransaction(async (tx) => {
    // 系统服务账号兜底 complainant_id（Q11）
    const systemAccountId = await getSystemServiceAccountId(tx);
    const complaintNo = genBizNo('complaint');
    const complaint = await tx.complaints.create({
      data: {
        complaint_no: complaintNo,
        complainant_id: systemAccountId,
        complainant_role: 'SYSTEM',
        target_type: 'PLATFORM',
        target_id: alert.alert_no,
        order_id: alert.order_id,
        type: 'SAFETY',
        priority: 'URGENT',
        description: `健康告警升级追责：${alert.type}（告警号 ${alert.alert_no}，触发于 ${alert.triggered_at.toISOString()}）。系统服务账号代为登记，请客服核实处置。`,
      },
      select: { id: true, complaint_no: true },
    });
    const updated = await tx.health_alerts.update({
      where: { id: alert.id },
      data: {
        status: 'ESCALATED',
        escalated_at: new Date(),
        complaint_id: complaint.id,
        handled_by: adminId,
        handled_at: new Date(),
      },
      select: { status: true },
    });
    // audit_logs 留痕（Q11 硬要求）
    await tx.audit_logs.create({
      data: {
        admin_id: adminId,
        action: 'activity_alert_escalate',
        module: 'activity',
        target_type: 'health_alert',
        target_id: alert.id.toString(),
        request_id: requestId ?? null,
        before_json: { status: alert.status, complaint_id: null },
        after_json: {
          status: updated.status,
          complaint_id: complaint.id.toString(),
          complainant_role: 'SYSTEM',
          crossVerify,
        },
      },
    });
    return { complaint, status: updated.status };
  });

  // ② SOS 出口（事务外）：紧急联系人 / 绑定子女 IM / 到岗态订单挂起。
  // 失败只记 warn 不回滚工单——工单是追责凭证，必须已经落库；
  // 此时因通知失败丢掉凭证，等于用「可追溯」换「时效」，方向错了。
  const sos = await notifyUrgentFallback(alert.elder_user_id, alert.type, alert.id, new Date())
    .catch((e: unknown) => {
      log.error(
        { event: 'activity-escalate-sos-failed', alert: alert.alert_no },
        '升级的SOS 出口失败（工单已落库，不回滚）——转客服工作台人工外呼',
      );
      return {
        orderSuspended: false,
        notifiedFamilyCount: 0,
        orderSkipReason: (e as Error)?.message ?? 'SOS 出口异常',
      } satisfies UrgentFallbackResult;
    });

  return {
    complaintId: result.complaint.id.toString(),
    complaintNo: result.complaint.complaint_no,
    alertStatus: result.status,
    sos,
  };
}

/**
 * 受理确认（契约 §13.6.1 / §13.6 的 ack 端点）。
 *
 * 三条语义（A3 已定稿）：
 *   1. **幂等回放**：重复 ack 返回首次结果（首次的 ack_by / ack_by_role / ack_at），
 *      **不重复写、不覆盖首次受理人**。理由：受理是「谁接下了这件事」的记录，
 *      被后续重复点击覆盖掉会导致责任归属丢失——这在安全事件里是要追责的。
 *   2. **非 OPEN 态 → 24002**，但**幂等回放优先于状态校验**：
 *      已是 ACKNOWLEDGED 的重复 ack 必须回放成功（否则端上重试会收到错误，
 *      而它其实已经ack 过了）。只有「压根不是 OPEN 也不是 ACKNOWLEDGED」
 *      才抛24002。
 *   3. **ack_by_role 三值**：USER（子女/老人）/ ADMIN（客服工作台）/ SYSTEM
 *      （cron 自动 ack —— 场景：客服已电话回访但系统未收到确认，系统代为ack）。
 *
 * ack_by 是 BigInt? 且**跨域不建 FK**（users 与 admins 两套 id 空间），
 * 靠 ack_by_role 区分域——这是宋砚秋的设计，保留。
 */
export type AckByRole = 'USER' | 'ADMIN' | 'SYSTEM';

export interface AckAlertInput {
  alertId: bigint;
  /** 受理人 id：USER/SYSTEM 域传users.id，ADMIN 域传 admins.id */
  actorId: bigint;
  /** 受理人域 */
  actorRole: AckByRole;
  requestId?: string;
}

export interface AckAlertResult {
  alertId: string;
  alertNo: string;
  status: health_alert_status;
  /** 首次受理人（幂等回放时是首次那次的值，不是本次入参） */
  ackBy: string | null;
  ackByRole: AckByRole | null;
  ackAt: string | null;
  /** 幂等回放标记：true = 本次未写库，返回的是首次结果 */
  replayed: boolean;
}

export async function ackAlert(input: AckAlertInput): Promise<AckAlertResult> {
  const alert = await prisma.health_alerts.findUnique({
    where: { id: input.alertId },
    select: {
      id: true,
      alert_no: true,
      status: true,
      ack_by: true,
      ack_by_role: true,
      ack_at: true,
    },
  });
  if (!alert) throw new AppError(24001, '告警不存在');

  // 幂等回放优先：已受理过就直接回放首次结果，不看actorRole、不校验流转
  if (alert.status === health_alert_status.ACKNOWLEDGED && alert.ack_at) {
    return {
      alertId: alert.id.toString(),
      alertNo: alert.alert_no,
      status: alert.status,
      ackBy: alert.ack_by?.toString() ?? null,
      ackByRole: (alert.ack_by_role as AckByRole | null) ?? null,
      ackAt: alert.ack_at.toISOString(),
      replayed: true,
    };
  }

  // 非法流转：非 OPEN 一律 24007（已处置/已升级/已受理但无 ack_at 的异常行）
  if (alert.status !== health_alert_status.OPEN) {
    throw new AppError(
      24007,
      `告警状态 ${alert.status} 不允许受理（仅 OPEN 可受理）`,
    );
  }

  const now = new Date();
  // 条件更新兜并发：status 仍是 OPEN 才写，避免两个受理人同时点击各写一次
  const updated = await prisma.health_alerts.updateMany({
    where: { id: alert.id, status: health_alert_status.OPEN },
    data: {
      status: health_alert_status.ACKNOWLEDGED,
      ack_by: input.actorId,
      ack_by_role: input.actorRole,
      ack_at: now,
    },
  });
  if (updated.count === 0) {
    // 并发：别人已先受理 → 回放他的结果（不报错，语义上确实是「已受理」）
    const again = await prisma.health_alerts.findUnique({
      where: { id: alert.id },
      select: { id: true, alert_no: true, status: true, ack_by: true, ack_by_role: true, ack_at: true },
    });
    if (again?.status === health_alert_status.ACKNOWLEDGED && again.ack_at) {
      return {
        alertId: again.id.toString(),
        alertNo: again.alert_no,
        status: again.status,
        ackBy: again.ack_by?.toString() ?? null,
        ackByRole: (again.ack_by_role as AckByRole | null) ?? null,
        ackAt: again.ack_at.toISOString(),
        replayed: true,
      };
    }
    throw new AppError(24002, '该告警状态已变更，请刷新后重试');
  }

  log.info(
    {
      event: 'activity-alert-ack',
      alert: alert.alert_no,
      actorRole: input.actorRole,
      actorId: input.actorId.toString(),
    },
    '告警已受理',
  );

  return {
    alertId: alert.id.toString(),
    alertNo: alert.alert_no,
    status: health_alert_status.ACKNOWLEDGED,
    ackBy: input.actorId.toString(),
    ackByRole: input.actorRole,
    ackAt: now.toISOString(),
    replayed: false,
  };
}

/** 读配置整数（DB 优先回落默认） */
async function getConfigInt(key: string, fallback: number): Promise<number> {
  const row = await prisma.system_configs.findUnique({ where: { config_key: key } });
  const n = row ? Number(row.config_value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}