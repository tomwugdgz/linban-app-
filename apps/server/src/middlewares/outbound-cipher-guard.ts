// ============================================================================
// 邻伴 · 出参密文守卫中间件（2026-10）
// ----------------------------------------------------------------------------
// 挂在 `res.json` 上，覆盖**所有**端点，不依赖任何人记得调用。
//
// 行为矩阵（主理人裁定 2026-10）：
//   | 环境          | 含 _cipher 键              | 处置                                  |
//   |---------------|----------------------------|---------------------------------------|
//   | test / dev    | 是                         | 抛 OutboundCipherLeakError，请求失败    |
//   | test / dev    | 否                         | 原样放行                               |
//   | production    | 是                         | 剥离 + error 日志 + **落 risk_events** |
//   |                |                            | + 响应头 `X-Outbound-Sanitized`        |
//   | production    | 否                         | 原样放行                               |
//
// 为什么生产「剥离但不抛错」：抛错会把"一次数据泄漏"变成"一次可用性故障"。
// 一次泄漏不该造成全站不可用 —— 可用性损失是不可逆的，数据泄漏是已发生的、
// 止损即可。保留判断：请求继续走完，只是出参被削掉敏感字段。
//
// 为什么生产还要「主动告警」而不只是 error 日志（这是主理人补的关键一环）：
// error 日志要人去翻日志平台才会看到，而 risk_events 会出现在运营的风控
// 工作台里 —— **主动告警 vs 被动日志，差别是"会不会有人在 3 分钟内发现"。**
// 老人隐私数据，3 分钟可能就是数据已在外部系统里待了半小时。
//
// 为什么响应头要打标记：让前端与网关侧能观测到"这个响应被动过"，
// 便于事后排查与监控告警，不用翻服务端日志反推。
// ============================================================================

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { findCipherKeys, OutboundCipherLeakError, stripCipherKeys } from '../common/outbound';
import { logger } from '../common/logger';

/** 出参守卫是否按生产行为处置（单测里可置 true 验证剥离+告警路径） */
let forceProduction = false;
/** 仅供单测：把守卫切到生产行为 */
export function __setOutboundGuardProduction(v: boolean): void {
  forceProduction = v;
}

const isProduction = (): boolean => forceProduction || process.env.NODE_ENV === 'production';

/**
 * 落一条风控告警记录。
 *
 * **为什么用 fire-and-forget（不 await）**：
 * 告警写库失败绝不能反过来把业务响应搞挂 —— 那是"为了记录一次问题
 * 而制造了一个更大的问题"。所以只记 warn，不向上抛。
 *
 * **为什么延迟 import prisma**：本中间件挂在 app 组装早期，
 * 而 `infra/prisma` 在启动时会做配置自检。静态 import 会让"只想用
 * findCipherKeys 做单测"也拖上整个 Prisma 初始化。
 *
 * **为什么不落字段值**：`hit_detail` 里只放**路径与键名**，
 * 绝不放被剥离字段的值 —— 否则告警记录本身成了新的泄漏源，
 * 且风控工作台是更多人能看到的地方，泄漏面反而扩大。
 *
 * `risk_events.type` 的取值由主理人裁定（schema 是事实源，不自行造值），
 * 当前落`OUTBOUND_CIPHER_LEAK`。若该值未被批准，改这里与 schema 注释两处。
 */
async function raiseRiskEvent(detail: {
  requestId: string;
  method: string;
  path: string;
  paths: string[];
  status: number;
}): Promise<void> {
  try {
    const [{ prisma }, { genBizNo }] = await Promise.all([
      import('../infra/prisma'),
      import('../common/ids'),
    ]);
    await prisma.risk_events.create({
      data: {
        event_no: genBizNo('riskEvent'),
        // 主理人裁定值；schema 是事实源，改动需同步 schema.prisma:1587 注释
        type: 'OUTBOUND_CIPHER_LEAK',
        level: 'CRITICAL',
        // 主体是"接口"而非某个用户/订单，故用 API + 端点路径
        subject_type: 'API',
        subject_id: detail.path.slice(0, 64),
        rule_code: 'OUTBOUND_CIPHER_GUARD',
        // 只放路径与键名，不放任何字段值（见上方注释）
        hit_detail: {
          requestId: detail.requestId,
          method: detail.method,
          path: detail.path,
          responseStatus: detail.status,
          //只列被剥离的键路径；键名本身不是数据，值才是
          strippedPaths: detail.paths.slice(0, 50),
          strippedCount: detail.paths.length,
          env: 'production',
        },
        status: 'PENDING',
      },
    });
  } catch (e) {
    // 告警写库失败只记 warn：不能因为记录问题而制造更大的问题
    logger.warn(
      { err: (e as Error).message, path: detail.path },
      '出参泄漏告警写入 risk_events 失败（守卫仍已剥离，响应不受影响）',
    );
  }
}

/**
 * 出参密文守卫。对 `res.json` 做一层包装，在**写出前**检查出参。
 *
 * 挂在业务路由之前（app.ts 组装顺序：requestId → CORS → body → 日志 →
 * 守卫 → 路由）。用 monkey-patch res.json 而非在每个 handler 里手写检查，
 * 因为后者依赖自觉 —— 而泄漏这个失败模式**从不报错**，靠自觉必漏。
 */
export const outboundCipherGuard: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const originalJson = res.json.bind(res);
  let guarded = false; // 只包一层，防止嵌套 res.json 时重复剥离

  res.json = function guardedJson(body: unknown): Response {
    if (guarded) return originalJson(body);
    guarded = true;

    const paths = findCipherKeys(body);
    if (paths.length === 0) return originalJson(body);

    const ctx = {
      requestId: res.locals.requestId ?? 'unknown',
      method: req.method,
      path: req.path,
      paths,
    };

    if (isProduction()) {
      // 生产：剥离 → 打标记 → 主动告警 → 放行干净副本
      logger.error(ctx, `出参含密文字段已剥离（${paths.length} 处）—— 该端点需显式挑选安全字段`);
      const { data } = stripCipherKeys(body);
      // 让前端/网关能观测到"这个响应被动过"
      res.setHeader('X-Outbound-Sanitized', 'true');
      // 不 await：告警失败不得影响业务响应
      void raiseRiskEvent({ ...ctx, status: res.statusCode });
      return originalJson(data);
    }

    // 开发/测试：立刻炸，避免泄漏在本地就固化下来。
    // 抛在 originalJson 之前 —— 响应头尚未发出，交给 errorHandler 还能返回干净错误。
    throw new OutboundCipherLeakError(paths);
  } as Response['json'];

  next();
};