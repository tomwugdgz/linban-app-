# ============================================================================
# 邻伴服务端镜像（apps/server/Dockerfile）
# ----------------------------------------------------------------------------
# 阶段划分：deps → build → runtime
#   deps    只装依赖，用 layer cache（package.json 不变就不重装）
#   build   tsc 编译 + prisma generate
#   runtime 只带产物 + 生产依赖，**不含源码 / 不含 devDependencies**
#
# 关键决策：
#   1. **不跑 migrate 在镜像构建期** —— 迁移必须发生在部署时（连接的是目标库，
#      不是构建机）。且多副本并发构建会竞争迁移锁。部署时由 compose 的
#      migrate 一次性容器执行。
#   2. **不用 `npm ci --omit=dev` 在 runtime 阶段重装** —— 那样要在镜像里
#      再放一份 package.json + lock，体积翻倍。改成 deps 阶段装全量、
#      runtime 阶段用 `npm prune --omit=dev`。
#   3. **非 root 运行** —— 生产容器不该是 root。
# ============================================================================

# ---------- 阶段 1：依赖 ----------
FROM node:22-alpine AS deps
WORKDIR /app

# openssl：Prisma 查询引擎需要；wget：healthcheck 用
RUN apk add --no-cache openssl wget

# 先只拷 lock + package，命中 layer cache
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/admin-web/package.json apps/admin-web/
COPY apps/miniapp-user/package.json apps/miniapp-user/
COPY apps/miniapp-companion/package.json apps/miniapp-companion/

# 整仓安装（workspaces 需要整仓结构）
RUN npm ci --no-audit --no-fund

# ---------- 阶段 2：构建 ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/admin-web ./apps/admin-web
COPY apps/miniapp-user ./apps/miniapp-user
COPY apps/miniapp-companion ./apps/miniapp-companion

# shared 先编（server 依赖它的产物）
RUN npm run build --workspace @linban/shared \
 && npx prisma generate --schema apps/server/prisma/schema.prisma \
 && npm run build --workspace @linban/server

# ---------- 阶段 3：运行时 ----------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl wget \
 && addgroup -g 1001 -S nodejs \
 && adduser -u 1001 -S nodejs -G nodejs

ENV NODE_ENV=production \
    PORT=3000 \
    PRISMA_CLIENT_ENGINE_TYPE=binary

# 只带构建产物
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/package.json ./package.json
COPY --from=build --chown=nodejs:nodejs /app/packages ./packages
COPY --from=build --chown=nodejs:nodejs /app/apps/server ./apps/server

# 剔除 devDependencies（package.json/lock 已在上面带过来，prune 需要它们）
USER root
RUN npm prune --omit=dev
USER nodejs

EXPOSE 3000

# 用 node 直接跑编译后的 JS，不用 tsx（tsx 是 devDependency，被 prune 掉了）
CMD ["node", "apps/server/dist/app.js"]
