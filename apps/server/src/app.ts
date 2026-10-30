// ============================================================================
// 邻伴 · Express 应用组装（app.ts）
// ----------------------------------------------------------------------------
// 中间件顺序（架构附录 B + §10.1）：
//   requestId → CORS → body 解析 → 请求日志 → 限流 → 路由 → 404 → 错误处理。
// 启动序列：配置自检 → Prisma 连接 → 队列/cron 注册 → 监听。
// ============================================================================

import express from 'express';
import cors from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { CODE_SUCCESS } from '@linban/shared';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler, errorCodeCatalog } from './common/errors';
import { requestIdMiddleware } from './middlewares/auth';
import { outboundCipherGuard } from './middlewares/outbound-cipher-guard';
import { logger, moduleLogger } from './common/logger';
import { isCryptoConfigured } from './common/crypto';
import { redisHealthy } from './infra/redis';
import { disconnectPrisma, prisma } from './infra/prisma';
import { disconnectRedis } from './infra/redis';
import { closeQueues } from './infra/queue';
import { registerCronJobs } from './infra/cron';
import { registerReconCron } from './modules/payment/payment.service';

const log = moduleLogger('app');

export function createApp() {
  const app = express();

  // 信任代理（Nginx 反代后取真实 IP，限流按 IP 需要）
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // 1) requestId 全链路透传
  app.use(requestIdMiddleware);

  // 2) CORS（小程序无跨域；admin-web 需要）
  app.use(
    cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // 3) body 解析（微信回调验签需要 rawBody，故保留 raw 缓冲）
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // 4) 请求访问日志（脱敏由 pino redact 负责）
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          requestId: res.locals.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - start,
        },
        'access',
      );
    });
    next();
  });

  // 5) 出参密文守卫（必须在业务路由之前——它靠包装 res.json 生效）
  //    覆盖全部端点，新写接口零成本受保护，不依赖开发者记得手写检查
  app.use(outboundCipherGuard);

  // 6) 健康检查（免鉴权）
  app.get('/healthz', async (_req: Request, res: Response) => {
    const [redisOk, dbOk] = await Promise.all([
      redisHealthy(),
      prisma
        .$queryRaw`SELECT 1`
        .then(() => true)
        .catch(() => false),
    ]);
    const ok = redisOk && dbOk;
    res.status(ok ? 200 : 503).json({
      code: ok ? CODE_SUCCESS : 10009,
      data: { redis: redisOk, db: dbOk, uptimeSec: Math.floor(process.uptime()) },
      requestId: res.locals.requestId,
    });
  });

  // 7) 错误码表查询（三端开发联调）
  app.get('/api/v1/error-codes', (_req: Request, res: Response) => {
    res.json({ code: CODE_SUCCESS, data: errorCodeCatalog(), requestId: res.locals.requestId });
  });

  // 8) 业务路由（/api/v1）
  app.use('/api/v1', apiRouter);

  // 9) 404 + 统一错误处理（必须最后）
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** 启动（含自检与资源注册） */
export async function start(): Promise<void> {
  // 配置自检（缺失密钥时 fail-fast 提示，但不阻塞 mock 模式启动）
  if (!isCryptoConfigured()) {
    log.warn('加密密钥未配置（CRYPTO_MASTER_KEY/CRYPTO_HMAC_KEY），_cipher 字段将以 PLAIN_DEV 明文回落——仅限开发');
  }
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    log.warn('JWT 密钥未配置，登录将不可用——请复制 .env.example 为 .env 并生成密钥');
  }

  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);

  const server = app.listen(port, () => {
    log.info({ port }, `邻伴服务端启动 → http://127.0.0.1:${port}/api/v1`);
  });

  // 定时任务与对账注册（Redis 未就绪时仅告警）
  await registerCronJobs();
  await registerReconCron().catch((e) => log.warn({ err: (e as Error).message }, '对账 cron 注册失败'));

  // 优雅停机
  const shutdown = async (signal: string) => {
    log.info({ signal }, '收到停机信号，优雅关闭中…');
    server.close(async () => {
      await Promise.allSettled([disconnectPrisma(), disconnectRedis(), closeQueues()]);
      process.exit(0);
    });
    // 兜底强退
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error({ err: String(reason) }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err: { message: err.message, stack: err.stack } }, 'uncaughtException');
    // 未知异常不静默：记录后退出（由进程守护重启）
    process.exit(1);
  });
}

// 入口：`tsx src/app.ts` / `npm run dev` / `npm start` 均走这里。
// 注意：domain 单测（vitest）不 import 本文件，无服务器副作用。
start().catch((e) => {
  log.error({ err: (e as Error).stack }, '启动失败');
  process.exit(1);
});
