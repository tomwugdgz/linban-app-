// ============================================================================
// 邻伴 · 安全挂起 / 夜间单确认（domain 层纯函数，team-lead 裁定③④）
// ----------------------------------------------------------------------------
// 裁定③（IN_SERVICE 自动挂起）：
//   · 任一端 SOS 立即挂起（risk 模块链路，order.service.suspendOrderForSafety）；
//   · 超过预约结束时间 N 分钟未完成确认 且 M 分钟无 IM 互动 → 自动挂起待客服核实
//     （N/M 进 system_configs：service_overtime_suspend_min / im_silence_suspend_min）；
//   · 客服手动挂起（既有 POST /verifications/suspend 链路）。
// 裁定④（夜间单确认）：
//   · 22:00–06:00 夜间单需子女确认，确认时限自下单起算（night_confirm_timeout_min），
//     超时 sweep 自动取消并全额退款；
//   · 豁免口径 A：仅「下单账号 == 被服务老人本人账号」且 elder_profile.birthday
//     满 18 岁时老人自确认；子女代下单一律走子女确认（即便老人已成年）。
//
// 本模块只放纯函数（时间/年龄/阈值判定），IO 在 order.service 的 sweep 外壳，
// 保证单测不依赖 DB/Redis。
// ============================================================================

/** 成年判定：now 时已满 18 周岁（birthday 为空或非法 → 未成年） */
export function isAdult(birthday: Date | null | undefined, now: Date): boolean {
  if (!birthday) return false;
  const b = birthday instanceof Date ? birthday : new Date(birthday);
  if (Number.isNaN(b.getTime())) return false;
  // 18 周岁生日当天算成年
  const age = now.getFullYear() - b.getFullYear();
  const monthDayPassed =
    now.getMonth() > b.getMonth() ||
    (now.getMonth() === b.getMonth() && now.getDate() >= b.getDate());
  return monthDayPassed ? age >= 18 : age - 1 >= 18;
}

/** 夜间单自确认豁免（口径 A）：下单账号即老人本人 且 老人已成年 */
export function nightSelfConfirmExempt(
  buyerIsElderSelf: boolean,
  elderBirthday: Date | null | undefined,
  now: Date,
): boolean {
  return buyerIsElderSelf && isAdult(elderBirthday, now);
}

/** 夜间单确认截止时刻 = 下单时刻 + 时限 */
export function nightConfirmDeadline(createdAt: Date, timeoutMin: number): Date {
  return new Date(createdAt.getTime() + timeoutMin * 60_000);
}

export interface NightConfirmOverdueInput {
  nightOrder: boolean;
  familyConfirmedAt: Date | null;
  /** 仅允许在「未派单」前置态取消（CREATED/PAID）；DISATCHED 及之后说明放行有漏，交由人工 */
  status: 'CREATED' | 'PAID' | 'DISPATCHED' | 'ACCEPTED' | 'ARRIVED' | 'IN_SERVICE' | 'PENDING_CONFIRM' | 'COMPLETED' | 'SUSPENDED' | 'CANCELLED' | 'CLOSED' | 'REFUNDED';
  createdAt: Date;
}

/** 夜间单确认超时判定（sweep 用）：夜间单 + 未确认 + 前置态 + 超过时限 */
export function nightConfirmOverdue(
  input: NightConfirmOverdueInput,
  now: Date,
  timeoutMin: number,
): boolean {
  if (!input.nightOrder) return false;
  if (input.familyConfirmedAt) return false;
  if (input.status !== 'CREATED' && input.status !== 'PAID') return false;
  return now.getTime() >= nightConfirmDeadline(input.createdAt, timeoutMin).getTime();
}

export interface ServiceOvertimeInput {
  /** 仅 IN_SERVICE 可被自动挂起（已进 PENDING_CONFIRM 的走确认流，不在此列） */
  status: string;
  /** 预约结束时刻（orders.slot_end，UTC） */
  slotEnd: Date;
  /**
   * 「最后互动」参考时刻：订单 IM 的最近一条消息时间；
   * 无消息时由调用方回退 service_started_at ?? accepted_at ?? created_at。
   */
  lastActivityAt: Date;
}

/**
 * 服务超时挂起判定（裁定③）：
 *   status === IN_SERVICE
 *   && now − slot_end ≥ overtimeMin（超过预约结束时间未完成）
 *   && now − lastActivityAt ≥ silenceMin（IM 静默）
 */
export function serviceOvertimeSuspendDue(
  input: ServiceOvertimeInput,
  now: Date,
  opts: { overtimeMin: number; silenceMin: number },
): boolean {
  if (input.status !== 'IN_SERVICE') return false;
  const overdueMs = opts.overtimeMin * 60_000;
  const silenceMs = opts.silenceMin * 60_000;
  if (now.getTime() - input.slotEnd.getTime() < overdueMs) return false;
  if (now.getTime() - input.lastActivityAt.getTime() < silenceMs) return false;
  return true;
}

/** 可被 SOS 挂起的到岗态（陪聊员已接单/已到岗/服务中） */
export const SOS_SUSPENDABLE_STATUSES = ['ACCEPTED', 'ARRIVED', 'IN_SERVICE'] as const;

/** 该订单状态是否可被 SOS 立即挂起（纯判定；SUSPENDED 之后不重复挂） */
export function sosSuspendable(status: string): boolean {
  return (SOS_SUSPENDABLE_STATUSES as readonly string[]).includes(status);
}
