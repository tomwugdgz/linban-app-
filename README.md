# 邻伴 · 社区养老陪伴匹配平台

![CI](https://github.com/tomwugdgz/linban-app-/actions/workflows/ci.yml/badge.svg)

![License](https://img.shields.io/badge/license-MIT-blue.svg)

> **让每一位老人都能被看见、被陪伴** —— 基于社区网格的养老陪伴智能匹配与调度平台

---

## 📖 项目简介

「邻伴」是一个面向中国老龄化社区的陪伴服务匹配平台，通过数字化手段连接：

- **老人及其家属**（需求方）—— 发布陪伴需求（就医陪同、日常照料、情感交流等）
- **陪聊员/志愿者**（供给方）—— 提供陪伴服务并获得合理报酬
- **社区运营者**（管理方）—— 监控服务质量、调配资源、处理异常

平台核心能力包括：

| 模块       | 功能                                   |
| -------- | ------------------------------------ |
| **智能匹配** | 基于老人画像、陪聊员技能、地理位置、时间窗口的多因子匹配算法       |
| **订单流转** | 预约 → 派单 → 接单 → 服务中 → 完成 → 评价的全生命周期管理 |
| **风控体系** | SOS 紧急求助、举报机制、异常行为检测、黑名单联动           |
| **营收分析** | 多维度营收报表（按社区/渠道/时间）、分账结算、优惠券核销        |
| **归因追踪** | 触点采集 → 漏斗分析 → 渠道 ROI 评估，支持投放决策优化     |

---

## 🏗️ 技术架构

### Monorepo 结构

```
linban-app/
├── packages/
│   └── shared/              # 共享包：类型定义、常量、工具函数、错误码
├── apps/
│   ├── server/              # 后端服务（Node.js + Express + Prisma + MySQL）
│   ├── admin-web/           # 管理后台（React + Ant Design + Vite）
│   ├── miniapp-user/        # 用户端小程序（Taro + React）
│   └── miniapp-companion/   # 陪聊员端小程序（Taro + React）
├── docs/                    # 架构文档、API 契约、数据库设计、门禁规范
├── scripts/                 # 门禁脚本、验证工具、CI 辅助
├── ci/                      # CI/CD 配置、MySQL 初始化脚本
├── docker-compose.yml       # 本地开发环境编排
└── .github/workflows/       # GitHub Actions CI
```

### 技术栈

| 层级      | 技术选型                                           |
| ------- | ---------------------------------------------- |
| **前端**  | React 18, Taro 4 (小程序), Ant Design, Vite 6     |
| **后端**  | Node.js 20+, Express 5, TypeScript, Prisma ORM |
| **数据库** | MySQL 8.0 (utf8mb4, UTC 时区)                    |
| **测试**  | Vitest 2.1, 自定义收集完整性门禁                         |
| **部署**  | Docker, GitHub Actions, EdgeOne Makers         |

---

## 🚀 快速开始

### 前置要求

- Node.js >= 20
- npm >= 10
- Docker & Docker Compose（本地开发可选）
- MySQL 8.0（本地或远程）

### 安装依赖

```bash
npm install
```

### 本地启动

#### 方式一：Docker Compose（推荐）

```bash
docker-compose up -d
```

这将启动 MySQL 容器并自动执行初始化脚本（字符集、时区）。

#### 方式二：手动启动

1. **配置环境变量**

   在 `apps/server/.env` 中设置：
   ```env
   DATABASE_URL="mysql://user:password@localhost:3306/linban"
   JWT_SECRET="your-secret-key"
   ```
2. **数据库迁移**
   ```bash
   cd apps/server
   npx prisma migrate deploy
   npx prisma generate
   ```
3. **启动各服务**
   ```bash
   # 后端
   npm run dev --workspace @linban/server

   # 管理后台
   npm run dev --workspace @linban/admin-web

   # 小程序（需 H5 预览模式）
   npm run dev:h5 --workspace @linban/miniapp-user
   ```

---

## ✅ 门禁系统（Phase 3 交付）

本项目实施了严格的 **16 项聚合门禁**，确保代码质量与数据一致性。所有门禁通过单一入口 `scripts/verify-all.cjs` 执行。

### 运行门禁

```bash
# 全量门禁
npm run verify:all

# 列出所有门禁项
npm run verify:list

# 只跑特定分组
npm run verify:all -- --only=typecheck,test,collect
```

### 门禁分组

| 分组          | 包含项                                     | 说明                                      |
| ----------- | --------------------------------------- | --------------------------------------- |
| `collect`   | 收集完整性（server vitest）                    | 守门测试被静默丢弃检测                             |
| `test`      | 服务端/管理后台/陪聊员端/用户端单测                     | 领域纯函数 + 状态机 + 契约守卫回归网                   |
| `typecheck` | 四端 TypeScript 检查                        | shared / server / admin-web / miniapp-* |
| `doc`       | 文档↔代码配置一致性                              | 段 1-7 号段登记、迁移链、配置域分组键集                  |
| `db`        | Prisma schema 校验 / 客户端生成 / 迁移状态 / 存量券回填 | 部分需 DB 可达                               |

### 退出码分级

| 退出码 | 含义                                 |
| --- | ---------------------------------- |
| 0   | 全部通过                               |
| 1   | 存在真失败（断言失败）                        |
| 2   | 疑似收集阶段失败（EPERM / 进程崩溃 / B>A 口径不一致） |
| 3   | 有跳过项且 `--strict` 模式                |

### 关键设计原则

1. **收集完整性断言必须是第一步** —— 防止守门测试被静默丢弃导致报告全绿但关键守卫没跑
2. **不依赖 DB 就能跑通必需门禁** —— PR 门禁可在无数据库环境下执行
3. **三态区分** —— 「还没写」（WARN）≠「写了但没跑」（ERROR）≠「正常」（PASS），只有后者才是假绿事故
4. **B > A 判据** —— 报告收集数比磁盘文件数还多时，判定为两侧口径不一致（非并发污染），点名差集文件

详细规范见 [docs/GATE-COLLECTION-SPEC.md](docs/GATE-COLLECTION-SPEC.md)。

---

## 📚 文档索引

| 文档                                                        | 说明                 |
| --------------------------------------------------------- | ------------------ |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                   | 整体架构、模块划分、依赖方向     |
| [DATABASE.md](docs/DATABASE.md)                           | 数据库设计、表结构、索引策略     |
| [API-CONTRACT.md](docs/API-CONTRACT.md)                   | API 契约、端点定义、出参字段   |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md)                       | 部署流程、环境变量、CI/CD 配置 |
| [GATE-COVERAGE.md](docs/GATE-COVERAGE.md)                 | 门禁覆盖清单、已知盲区        |
| [GATE-DECISIONS.md](docs/GATE-DECISIONS.md)               | 门禁相关决策记录           |
| [MODULE-ACTIVITY-SENSE.md](docs/MODULE-ACTIVITY-SENSE.md) | 活动感知模块设计           |
| [RECONCILE-REPORT.md](docs/RECONCILE-REPORT.md)           | 对账报告生成逻辑           |

---

## 🧪 测试

### 运行测试

```bash
# 服务端测试
npm test --workspace @linban/server

# 管理后台冒烟测试
npm run smoke --workspace @linban/admin-web

# 陪聊员端测试
npm test --workspace @linban/miniapp-companion
```

### 测试收集完整性

```bash
npm run test:check:collection --workspace @linban/server
```

该命令会验证：

- 磁盘上的测试文件是否都被 vitest 收集
- 守门测试是否在收集清单中
- 基线是否只增不减

---

## 🤝 贡献指南

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 代码规范

- TypeScript 严格模式，禁止 `any`
- 所有公共 API 必须有 JSDoc 注释
- 新增功能必须配套测试用例
- 提交前运行 `npm run verify:all` 确保门禁通过

### 门禁纪律

- **破坏法自证必须先验收集完整** —— 磁盘数 === 报告数 === 守门点名全绿，破坏才有意义
- **门禁必须声明「不覆盖什么」** —— 禁列要带「理由 + 若真发生去哪查」两栏
- **「已验证」三问**：跑的是什么命令 / 输出是什么 / 谁复核过

---

## 📄 License

MIT License — 详见 [LICENSE](LICENSE) 文件

---

## 👥 核心团队

| 角色     | 成员  |
| ------ | --- |
| 研发总监   | 岑执衡 |
| 架构师    | 顾图南 |
| 后端架构师  | 霍承钧 |
| 前端开发   | 苏映棠 |
| 小程序开发  | 夏小笺 |
| 数据库优化  | 宋砚秋 |
| DevOps | 韩渡川 |
| 上线验收   | 关千锤 |

---

## 🙏 致谢

感谢所有为本项目做出贡献的开发者和测试人员。

---

**Made with ❤️ by 阿客实验室 · 研发部**
