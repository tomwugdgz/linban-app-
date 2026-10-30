# 邻伴 · 部署与上线前检查

> **本文档的纪律**：只写**已核实**的事实。凡未验证的，明确标「未验证」。
> 不写「已验证」这种含糊话 —— 一个含糊的「已验证」会让上线检查的人以为可以跳过。
>
> 适用范围：广州单城 MVP（架构 §11部署形态：Tom 云服务器 47.253.159.62，Node栈）。

---

## 0. 三种「验证」必须分清（本项目已混淆过一次）

| 说法 | 实际含义 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| **静态核对通过** | 人/AI 逐条读 SQL，比对 MySQL 方言特性 | SQL 语法看起来对 | 库能执行 |
| **离线漂移门禁通过**<br/>`npm run prisma:migrate:check` | 迁移链末态 === 当前 schema（**不连库**） | 迁移文件与 schema 没分叉 | **库 == 迁移链末态** |
| **真机跑通**<br/>`prisma migrate deploy` 连真库 | 迁移 SQL 在**某个** MySQL 上执行成功 | 该 SQL 在该实例可跑 | **生产库已改** |

⚠️ **离线漂移门禁是最容易被当成「迁移已验证」的那一个** —— 它连库都不连。
它保证的是「文件之间一致」，不是「库已更新」。后者的唯一验证手段是
`prisma migrate status`（连真库看 `_prisma_migrations` 表）。

---

## 1. 建库（首次部署）

**必须显式指定字符集**，不能依赖 MySQL 默认值 —— 老人昵称与语音转写文本含生僻字/emoji，
默认 `utf8mb3` 会截断。

```sql
-- ① 建库（utf8mb4 + utf8mb4_0900_ai_ci，MySQL 8 默认 collation）
CREATE DATABASE IF NOT EXISTS `linban`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- ② 时区：链路全程 UTC（DATABASE.md §2.6）。展示层转 +8。
--    设为 UTC 后，DB 与应用对DATETIME 的解释一致，
--    避免「以为存的是 UTC、实际按本地时区解释」导致的订单时段错位。
--    注意：连接串也必须带 timezone=UTC（见 §2），两处都要，缺一不可。
SET GLOBAL time_zone = '+00:00';
```

> **`SET GLOBAL` 只在实例初始化时执行一次。**
> 它写在某个初始化脚本里，**不保证每次启动都生效**（重启、镜像重建后可能失效），
> 更不能放在每次部署都跑的迁移里 —— 那会造成「脚本里有就以为一定生效」的错觉。
> **每次部署后用 `SELECT @@global.time_zone;` 复核**，这是本文档列出的必查项之一。

---

## 2. 环境变量

```bash
cp .env.example .env    # .env 已被 .gitignore 排除，禁止提交真实凭证
```

`DATABASE_URL` **必须同时带 `timezone=UTC` 与 `charset=utf8mb4`**：

```
DATABASE_URL="mysql://user:pass@host:3306/linban?timezone=UTC&charset=utf8mb4"
```

### charset 三层能力边界（别指望参数能解决全部问题）

| 层 | `DATABASE_URL` 加 `charset=utf8mb4` 能做 | 不能做 |
|---|---|---|
| **连接层** | ✅ 客户端与 MySQL 协商字符集，避免中文乱码 | — |
| **建库层** | ❌ 无效。新库字符集由 `CREATE DATABASE` 决定 | ❌ 必须靠 §1 的 DDL |
| **ALTER 层** | ❌ 无效。已有列的字符集由 `ALTER TABLE ... CONVERT TO` 决定 | ❌ 必须显式 ALTER |

> Prisma 的 `datasource` 块**不支持声明 charset**（只有 url/relationMode 等），
> 所以它既不来自 schema 也不来自迁移文件 —— **只能靠连接串或建库语句**。

---

## 3. 迁移执行（每次部署）

```bash
# ① 先备份（不可跳过）
mysqldump --single-transaction --routines --triggers linban > backup_$(date +%F_%H%M).sql

# ② 看库当前处于哪个迁移（**上线前必查**，理由见 §0）
npx prisma migrate status

# ③ 执行未应用的迁移
npx prisma migrate deploy

# ④ 复核：deploy 后status 应显示已是最新
npx prisma migrate status
```

⚠️ **绝不用 `prisma migrate dev` 上生产**（它会重置库/生成新迁移）。
生产只用 `deploy`。

---

## 4. 上线前必查清单

| # | 检查项 | 怎么查 | 不通过的后果 |
|---|---|---|---|
| 1 | **迁移状态** | `npx prisma migrate status` | 库未更新 → 新代码读不到新列，直接 500 |
| 2 | **字符集** | `SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='linban';` | 生僻字/emoji 截断 |
| 3 | **时区** | `SELECT @@global.time_zone;` 须为 `+00:00` | 订单时段错位 |
| 4 | **迁移文件入库** | `git ls-files apps/server/prisma/migrations \| wc -l` > 0 | 生产无迁移历史，schema 无法演进 |
| 5 | **密钥非模板值** | 人工核 `CRYPTO_MASTER_KEY` / `JWT_*` / `SEED_ADMIN_PASSWORD` | **明文落库** / 伪造任意身份 |
| 6 | **分账模式** | `SPLIT_MODE=wechat_profit_sharing` | 走人工兜底，无法规模化 |
| 7 | **B 档凭据齐备** | 见 `.env.example` 分档注释 | 对应能力实为 mock |
| 8 | **测试收集完整性** | `npm run test:check:collection` | 守门测试可能没跑（详见 §5） |

### 关于第 8 项：为什么它进了上线清单

不是形式主义。本机（WorkBuddy 桌面端沙箱）出现过：
`npx vitest run` 报 `Test Files 33 passed` 而磁盘上有 34 个 `.test.ts`——
**被丢的文件连 failed 都不算，报告看起来是「全绿」**，丢的常常正是守门测试。
故 `apps/server/vitest.config.ts` 强制 `pool: 'forks'` + `singleFork`，
并由 `scripts/check-test-collection.ts` 每次按「磁盘 vs 报告」对账。

⚠️ **换机器 / 换 CI 也要保留这两项** —— 这不是本机特有配置。

---

## 5. 测试门禁（为什么「全绿」可能不可信）

```bash
npm test                    # 含 pool:'forks' + singleFork（写在 config 里，不需加 flag）
npm run test:check:collection   # 收集完整性门禁，EXIT=0 才算通过
```

`test:check:collection` 检查四项：

| 编号 | 检查 | 级别 |
|---|---|---|
| 7.1 | 报告收集文件数 === 磁盘 `.test.ts` 数 | ERROR |
| 7.2 | 收集到文件但 0 条测试 | ERROR |
| 7.3 | 各包 vitest config 的 **test 段**配了 `pool:'forks'` + `singleFork` | ERROR |
| 7.4 | **点名的守门测试**都在收集清单里 | ERROR |

**7.4 为什么必须点名**：数量对账能发现「少了 1 个」，但发现不了
「少的正好是守门测试」。守门测试被丢是**完全静默**的。

> 7.3 的匹配会先剥注释、只在 `test: {` 段内找 `pool` ——
> 因为文件头的踩坑注释里就写着 `pool: 'forks'`，
> 直接对整份文件跑正则会让「改成 threads」也照样通过（门禁恒真）。
> 这个坑是实测踩到的，不是预防性设计。

---

## 6. 本项目的迁移验证现状（如实记录）

| 项 | 状态 | 说明 |
|---|---|---|
| 离线漂移门禁 `prisma:migrate:check` | ✅ 已通过 | 4 迁移 / 54 表，EXIT=0 |
| **真机 `migrate deploy`** | ❌ **未执行** | 本机无 MySQL、无 Docker；`apps/server/.env` 不存在 |
| **真机 `migrate status`** | ❌ **未执行** | 同上 |

> ⚠️ **更正一处既有文档的不实陈述**：`docs/DATABASE.md` 第 792/1160 行称
> 「本项目已在开发期用 `mysql-memory-server@1.17.0` 起的真实 MySQL 8.0.36 跑通一次」。
> **核实结果：该包不在任何 `package.json` 里，也不在 `node_modules` 中**，
> 即**从未安装过**，该次「真机验证」没有可查证的痕迹。
> 结论：**截至目前，本项目从未在任何真实 MySQL 上执行过迁移。**
> 这正是本文档把 `migrate status` 列为上线必查第 1 项的原因 ——
> 不能让「文档说跑通过」替代「目标库实跑过」。
>
> `docs/DATABASE.md` 对应的更正块旁已留本文档的引用，两处口径一致。

---

## 6.5 纪律：「已验证」必须留痕

> 这条是 2026-10-22 由一次**自曝造假**沉淀出来的：
> `DATABASE.md` 曾写「已在开发期用 `mysql-memory-server@1.17.0` 跑通一次」，
> 而该依赖**不在任何 `package.json`、不在 `node_modules`、lock 文件零命中**——
> 即那次验证**从未发生**，但文档写得像发生过。

### 规则

**文档里写「已验证」，必须附可查证痕迹，三者至少其一：**

1. **依赖痕迹** —— `package.json` / lock 文件里有对应包与版本
2. **命令痕迹** —— 贴出实际命令与其输出（退出码、关键行）
3. **库上痕迹** —— 目标库 `SHOW TABLES` / `_prisma_migrations` 的残留记录

**三者都没有 = 没验证过。** 此时必须写「未验证」，不能写「已验证」。

### 为什么「没痕迹的已验证」比「没验证」更危险

- 「没验证」会让人去验证；
- 「已验证（无痕迹）」会让人**跳过**验证 —— 它伪装成已完成的工作，
  而它恰恰是唯一会骗到所有人的那种表述。

所以这条规则的执行动作是：**核验痕迹，而不是核验记忆**。
任何人（包括我自己）声称「跑过了」，第一反应都应是
「给我看痕迹：grep 一下依赖、把命令和输出贴出来」。

### 本项目当前受此纪律约束的条目

| 声称 | 痕迹 | 判定 |
|---|---|---|
| 离线漂移门禁通过 | `npm run prisma:migrate:check` 可复现 | ✅ 有痕迹 |
| 真机 `migrate deploy` | 无 `.env`、无 MySQL、无 Docker | ❌ **文档已更正为「未执行」** |
| 券快照回填完成 | `check-coupon-backfill.ts` 可复现，但需真库 | ⏸ 脚本在、实跑未做 |
| 测试收集完整 | `npm run test:collect` 可复现 | ✅ 有痕迹 |

---

## 7. 开发期产物不得入库

| 产物 | 为什么 | 处置 |
|---|---|---|
| `apps/server/.tmp/` | vitest JSON 报告 / SSR 转换产物 | 已被 `.gitignore` 排除 |
| `.shadow/` | Prisma 影子库目录（`migrate diff` 用） | 不得入库 |
| `tools/` | 本地验证脚本 | 整目录排除 |
| `apps/server/.env` | 真实凭证 | 已被 `.gitignore` 排除 |

`prisma/migrations/` **不排除** —— 它是生产 schema 演进的唯一依据，
不入库等于生产无法迁移。