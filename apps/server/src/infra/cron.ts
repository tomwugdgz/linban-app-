// ============================================================================
// 邻伴 · 定时任务骨架（infra 层，架构 §7.5 / DATABASE.md §7.2）
// ----------------------------------------------------------------------------
// 全部定时任务经 BullMQ repeatable job 注册（Redis 驱动，天然分布式），
// worker 处理器散在各 modules 域（payment 对账、order 超时、marketing
// 过期扫描……），本文件只负责「注册表 + 启停」。
//
// 时刻表（架构 §7.5 + DATABASE.md §7.2）：
//   03:00  每日对账（支付/分账/退款/提现四渠道各一批次）
//   每 5min 订单超时扫描（支付 15min 关单 / 派单 30min 转人工）
//   每 5min 隐私号到期解绑扫描
//   每 5min 优惠券 / 时长卡过期扫描
//   每 30min 待分账超时告警扫描（>7 天未分账，架构 §7.2）
//   每月 1 日 03:30 大表归档（im_messages 90d / ai_messages 60d /
//                notification_logs 180d，DATABASE.md §7.2）
// ============================================================================

import { QUEUE_NAMES } from '@linban/shared';
import { enqueue, registerDailyJob } from './queue';

/** 任务开关（CRON_ENABLED=false 时不注册，供无 Redis 环境启动） */
function cronEnabled(): boolean {
  return (process.env.CRON_ENABLED ?? 'true') !== 'false';
}

/** 注册全部定时任务（app.ts 启动尾段调用；失败仅告警不阻塞启动） */
export async function registerCronJobs(): Promise<void> {
  if (!cronEnabled()) {
    console.warn('[cron] CRON_ENABLED=false，定时任务未注册（本地 POC 模式）');
    return;
  }
  try {
    // 每日 03:00 对账（四渠道各一批次）
    for (const channel of ['WX_PAY', 'WX_SHARING', 'WX_REFUND', 'WX_WITHDRAW'] as const) {
      await registerDailyJob(QUEUE_NAMES.reconciliation, 'daily-recon', { batchDate: '', channel }, '0 3 * * *');
    }

    // 每 5 分钟：订单超时扫描
    await enqueue(
      QUEUE_NAMES.orderTimeout,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'order-timeout:sweep' },
    );

    // 每 5 分钟：安全挂起扫描（服务超时+IM 静默自动挂起，裁定③）
    await enqueue(
      QUEUE_NAMES.orderTimeout,
      'safety-suspend',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'safety-suspend:sweep' },
    );

    // 每 5 分钟：夜间单确认超时扫描（超时自动取消+全额退款，裁定④）
    await enqueue(
      QUEUE_NAMES.orderTimeout,
      'night-confirm-timeout',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'night-confirm-timeout:sweep' },
    );

    // 每 5 分钟：隐私号到期解绑扫描
    await enqueue(
      QUEUE_NAMES.privacyExpire,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'privacy-expire:sweep' },
    );

    // 每 5 分钟：优惠券 / 时长卡过期扫描
    await enqueue(
      QUEUE_NAMES.couponExpire,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/5 * * * *' }, jobId: 'coupon-expire:sweep' },
    );

    // 每 30 分钟：待分账超时告警扫描（>7 天，架构 §7.2）
    await enqueue(
      QUEUE_NAMES.sharingStale,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '*/30 * * * *' }, jobId: 'sharing-stale:sweep' },
    );

    // ---- 健康活动感知（架构 §13.7）----
    // 日聚合：昨日信号 → activity_daily_summary（对外唯一读源，红线③的代码级落点）
    await enqueue(
      QUEUE_NAMES.activityAggregate,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '15 2 * * *' }, jobId: 'activity:daily-aggregate' },
    );
    // 留存清理：原始特征 ≤14 天硬红线；清理后写 audit_logs 并回写 consents 确认态（A4）
    await enqueue(
      QUEUE_NAMES.activityRetention,
      'sweep',
      { sweepAt: new Date().toISOString() },
      { repeat: { pattern: '40 3 * * *' }, jobId: 'activity:retention:sweep' },
    );

    // 每月 1 日 03:30：大表归档（DATABASE.md §7.2）
    // TODO(归档 worker)：archival 任务处理器在 im/ai 模块 worker 注册后启用；
    // MVP 单机数据量小，可暂以手动脚本执行，见 docs/DATABASE.md §7.2。

    console.info('[cron] 定时任务注册完成（对账 03:00 / 超时扫描 5min / 告警扫描 30min / 活动聚合 02:15 / 留存清理 03:40）');
  } catch (err) {
    console.error(`[cron] 注册失败（Redis 未就绪？）: ${(err as Error).message}`);
  }
}

/** 任务清单（供 /healthz 与管理后台巡检展示） */
export const CRON_JOB_MANIFEST = [
  { jobId: 'daily-recon:WX_PAY', schedule: '0 3 * * *', desc: '支付渠道每日对账' },
  { jobId: 'daily-recon:WX_SHARING', schedule: '0 3 * * *', desc: '分账渠道每日对账' },
  { jobId: 'daily-recon:WX_REFUND', schedule: '0 3 * * *', desc: '退款渠道每日对账' },
  { jobId: 'daily-recon:WX_WITHDRAW', schedule: '0 3 * * *', desc: '提现渠道每日对账' },
  { jobId: 'order-timeout:sweep', schedule: '*/5 * * * *', desc: '支付超时关单 / 派单超时转人工' },
  { jobId: 'safety-suspend:sweep', schedule: '*/5 * * * *', desc: '服务超时+IM 静默自动挂起（裁定③）' },
  { jobId: 'night-confirm-timeout:sweep', schedule: '*/5 * * * *', desc: '夜间单子女确认超时自动取消+全额退款（裁定④）' },
  { jobId: 'privacy-expire:sweep', schedule: '*/5 * * * *', desc: '隐私号到期自动解绑' },
  { jobId: 'coupon-expire:sweep', schedule: '*/5 * * * *', desc: '优惠券 / 时长卡过期扫描' },
  { jobId: 'sharing-stale:sweep', schedule: '*/30 * * * *', desc: '待分账超 7 天告警扫描' },
  { jobId: 'activity:daily-aggregate', schedule: '15 2 * * *', desc: '活动感知日聚合（→ activity_daily_summary）' },
  { jobId: 'activity:retention:sweep', schedule: '40 3 * * *', desc: '活动原始特征留存清理（≤14 天红线）+ 写 audit_logs' },
] as const;
