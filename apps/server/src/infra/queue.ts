// ============================================================================
// 邻伴 · BullMQ 队列定义（infra 层，架构 §3.4）
// ----------------------------------------------------------------------------
// 队列清单与用途（架构 §3.4 / §6.2）：
//   profit-sharing  分账执行与重试（订单完成后门闩校验 → 执行/重试/升级工单）
//   notification    订阅消息 / 短信 / IM 系统消息发送（失败重试）
//   pay-callback    支付回调补偿（微信回调丢失时的掉单扫描）
//   ai-pipeline     ASR→LLM→TTS 管道（重活异步，老人端不等长耗时）
//   ai-sample       AI 会话人工抽检（ai_sample_rate）
//   reconciliation  每日对账（03:00，架构 §7.5）
//   privacy-expire  隐私号到期自动解绑
//   coupon-expire   优惠券 / 时长卡过期扫描
//   order-timeout   支付超时关单 / 派单超时扫描
//   sharing-stale   待分账超时告警（>7 天，架构 §7.2）
//   content-review  IM / AI 内容审核
//
// 无 Redis 环境：队列实例懒创建，add 时连接失败仅告警不崩进程
// （worker 未启动，任务不消费——本地 POC 由 service 同步路径兜底）。
// ============================================================================

import { Queue, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES } from '@linban/shared';
import { redis } from './redis';

/** 队列名联合类型 */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** 队列单例表（按需创建） */
const queues = new Map<string, Queue>();

/** 获取（懒创建）队列实例 */
export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    q.on('error', (err) => console.error(`[queue:${name}] 错误: ${err.message}`));
    queues.set(name, q);
  }
  return q;
}

/** 默认作业选项：指数退避重试 3 次 + 保留近期记录 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** 入队助手（失败不抛：调用方决定是否降级为同步执行） */
export async function enqueue<T>(
  name: QueueName,
  jobName: string,
  data: T,
  options?: JobsOptions,
): Promise<string | null> {
  try {
    const job = await getQueue(name).add(jobName, data, options);
    return job?.id ?? null;
  } catch (err) {
    console.warn(`[queue:${name}] 入队失败（${jobName}），调用方应降级: ${(err as Error).message}`);
    return null;
  }
}

/** 注册每日定时任务（repeatable job；cron 表达式，架构 §7.5） */
export async function registerDailyJob<T>(
  name: QueueName,
  jobName: string,
  data: T,
  cronExpr: string,
): Promise<void> {
  await enqueue(name, jobName, data, {
    repeat: { pattern: cronExpr },
    jobId: `${jobName}:daily`, // 固定 jobId 防重复注册
  });
}

/** 关闭全部队列（优雅停机） */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
}

// ---------------------------------------------------------------------------
// 任务载荷类型（service/worker 共享；worker 注册在 modules 各域）
// ---------------------------------------------------------------------------

/** 分账执行任务载荷 */
export interface ProfitSharingJob {
  orderId: string;
  /** 第几次尝试（0 = 首次） */
  attempt: number;
  /** 触发来源：完成确认 / 重试 / 补偿扫描 */
  trigger: 'complete' | 'retry' | 'sweep';
}

/** 通知任务载荷 */
export interface NotificationJob {
  notificationLogId: string;
  channel: 'SUBSCRIBE_MESSAGE' | 'SMS' | 'IM_SYSTEM';
  targetUserId?: string;
  targetPhone?: string;
  title?: string;
  content: string;
  /** 订阅消息模板参数（channel=SUBSCRIBE_MESSAGE） */
  templateData?: Record<string, string>;
  templateId?: string;
}

/** 支付回调补偿任务载荷 */
export interface PayCallbackJob {
  outTradeNo: string;
}

/** AI 管道任务载荷 */
export interface AiPipelineJob {
  sessionNo: string;
  /** 输入音频的 COS objectKey（前端直传后回调携带） */
  audioObjectKey: string;
  userId: string;
}

/** AI 抽检任务载荷 */
export interface AiSampleJob {
  sessionNo: string;
}

/** 对账任务载荷 */
export interface ReconciliationJob {
  batchDate: string; // YYYY-MM-DD（本地日）
  channel: 'WX_PAY' | 'WX_SHARING' | 'WX_REFUND' | 'WX_WITHDRAW';
}

/** 隐私号到期扫描载荷 */
export interface PrivacyExpireJob {
  sweepAt: string; // ISO
}

/** 券过期扫描载荷 */
export interface CouponExpireJob {
  sweepAt: string;
}

/** 订单超时扫描载荷 */
export interface OrderTimeoutJob {
  sweepAt: string;
}

/** 待分账超时告警扫描载荷 */
export interface SharingStaleJob {
  sweepAt: string;
}

/** 内容审核任务载荷 */
export interface ContentReviewJob {
  target: 'IM_MESSAGE' | 'AI_MESSAGE';
  targetId: string;
}
