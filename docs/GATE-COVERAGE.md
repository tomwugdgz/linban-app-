# ============================================================================
# 全仓门禁覆盖清单（GATE-COVERAGE）
# ----------------------------------------------------------------------------
# 【这份文档解决什么问题】
#   三处门禁各自写了「不覆盖什么」（砚秋在verify-doc-configs.ts、
#   映棠在 enum-guard.ts、我在 check-test-collection.ts），
#   **分散在三个文件里**，结果是：review 时看不到全貌，新人得读完三个脚本
#   才知道边界，而门禁漏了某个域时**没有对照物可查**。
#   本清单把「守什么 / 不守什么 / 若真发生谁发现」集中到一处。
#
# 【本清单本身也会漂移】
#   故配一条反向断言（verify-doc-configs.ts 段 6.9）：
#   **本文件里列出的门禁，都必须存在于某个 package.json 的 scripts 里。**
#   反向也判：scripts 里引用了但脚本在磁盘上不存在 → ERROR（真事故）。
#   判定分两档（与守门测试三态同源）：
#     脚本在磁盘上 但未挂进 scripts → **WARN**（中间态：先写脚本后接线，本项目常态）
#     scripts 引用了 但 脚本不存在   → **ERROR**（真事故：门禁必失败）
#
# 【维护纪律】
#   新增/删除门禁时，**本清单与断言必须同批改**。
#   只改一边 = 一份没人看的文档（比没有文档更坏）。
#
# 维护人：霍承钧（server 各行）· 宋砚秋（doc:check:configs 行）
#         苏映棠（admin-web / 枚举门禁行）· 顾图南（契约层行）· team-lead 合并
# ============================================================================

## 一、服务端（apps/server）

| 门禁 | 命令 | 守什么 | 不守什么 | 若真发生谁发现 |
|---|---|---|---|---|
| 收集完整性 | `npm run test:collect`（`pretest` 自动先跑） | 测试文件**没被静默丢弃**；磁盘 vs 报告三数比对；`pool/singleFork/fileParallelism/cacheDir` 四项配置未被改动；守门测试逐个点名 | **不校验任何业务逻辑**；不保证「测试本身写得对」；不检测「测试被删」（只检测基线下降） | 各测试文件自身的断言 |
| 路由路径契约 | `npx vitest run src/middlewares/route-path-contract.test.ts` | **运行时注册路径 ≡ 契约登记路径**（双向：已注册必须在契约里 / 契约点名的必须真注册） | 不校验出参字段名；不校验 handler 内部逻辑 | 前后端联调时的 404 |
| 券核销口径 | `... src/domain/coupon-deduct.test.ts` | 快照优先 / null 回退 / 回退打日志 | 不校验 DB 实际写入 | 券核销集成测试（待建） |
| 券状态机准入 | `... src/middlewares/coupon-state-machine.test.ts` | **准入条件**（不是目标态）：`resume` 不能绕过 `publish` 的校验；终态不可逆 | 不校验 DB 实际状态；不校验 service 层是否正确调用了域函数 | 券后台端到端 |
| 券核销接线 | `... src/middlewares/coupon-deduct-wiring.test.ts` | 核销逻辑**真的被调用**（曾出现「标记为在别处」的孤儿逻辑） | 不校验核销的并发正确性 | 双花防护相关集成测试（待建） |
| 出参密文巡检 | `... src/middlewares/outbound-cipher-guard.test.ts` + `response-discipline.test.ts` + `no-cipher-in-response.test.ts` | 响应体**不含密文**；响应纪律（禁止 Prisma 整行直出等） | 不校验响应体的**业务正确性**；不保证「密文列本身没被日志打印」 | 生产侧日志审计 |
| RBAC 权限 | `... src/middlewares/admin-perm-guard.test.ts` | `adminPermGuard` 的**三态**：允许 / 拒绝 / 通配 | 不校验权限**粒度**是否合理（配了 `*` 它不拦） | 越权举报流程 |
| 营收端点契约 | `... src/middlewares/revenue-endpoint-contract.test.ts` | 营收端点出参契约 + **账务隔离**（订阅收入不进分账池） | 不校验营收计算的业务正确性 | `domain/revenue.test.ts` |
| 陪聊员资金契约 | `... src/middlewares/companion-income-contract.test.ts` | 三个端点出参 + **不得带密文** + 越权红线 | **不校验提现是否真的到账** | 对账脚本 |
| 评分精度 | `... src/middlewares/rating-precision.test.ts` | `reviews.rating` 值域 ⊆ `rating_avg` DECIMAL 值域 | 不校验均值计算 | — |
| 配置变更历史 | `... config-changelog-fields.test.ts` / `config-changelog-group.test.ts` | changelog 出参**字段名**（契约口径，非落库列名）+ 六组分组 | 不校验权限 | — |
| 券后台契约 | `... src/middlewares/coupon-admin-contract.test.ts` | 券写端点契约（`10001/10008/19204`错误码、状态机守卫） | 不校验 DB 状态 | — |

## 二、号段与文档（apps/server/scripts）

| 门禁 | 命令 | 守什么 | 不守什么 | 若真发生谁发现 |
|---|---|---|---|---|
| 号段双向核对 | `npm run doc:check:configs` 段 6.7 | 6.7-a 用了但未登记 = 0；**6.7-b 登记未使用 = 0（除白名单）** | **不校验业务上是否真的该有这个单号场景**（白名单理由靠人核） | 人工 review |
| 配置键文档一致 | 同上 段 1–6 | 配置键在shared / schema / 文档三处一致 | 不判断中文名的**语义**是否正确 | 人工 review |
| 探针不得变门禁 | 同上 段 6.8 | `scripts/probes/` 下的文件不得被任何 npm script 引用 | — | — |
| **本清单不漂移** | 同上 段 6.9（新增） | 本文件列出的门禁都存在于 package.json scripts | 不校验门禁**逻辑**是否正确 | 人工 review |
| 迁移链漂移 | `npm run prisma:migrate:check` | 迁移链末态 === 当前 schema（**离线**，不连库） | 🔴 **不保证「库== 迁移链末态」** —— 见下方警告 | 真机 `migrate status`（上线必查第 1 项） |

> 🔴 **迁移类门禁的固有局限（务必读）**：
> `prisma:migrate:check` 通过**只证明「两个文件描述的结构一致」**，
> **不证明「迁移能在真实 MySQL 上跑通」**。后者需要真实 DB。
> **在真正的 MySQL 上跑过 `migrate deploy` 之前，一切「可上线」的结论都是推断。**
> 这一条是从「静态核对冒充可应用性已验证」那次事故学来的
> —— `DATABASE.md` 曾写「已用 mysql-memory-server 跑通一次」，
> 而该依赖**不在任何 package.json、不在 node_modules**。

## 三、共享包（packages/shared）

| 门禁 | 命令 | 守什么 | 不守什么 | 若真发生谁发现 |
|---|---|---|---|---|
| 枚举镜像 | `... src/modules/activity/enum-mirror.test.ts` | schema 落库枚举 ≡ shared 导出枚举；TS-only 纯常量须登记 `TS_ONLY_ALLOWLIST` | **不覆盖 mock 里的平行码表** | 各端冒烟（映棠/小笺） |
| 类型检查 | `packages/shared$ npx tsc --noEmit` | 类型一致性 | — | — |

## 四、枚举 / 前端（apps/admin-web、apps/miniapp-*）

| 门禁 | 命令 | 守什么 | 不守什么 | 若真发生谁发现 |
|---|---|---|---|---|
| 枚举守卫 | 映棠 `enum-guard.ts` | 契约字段/参数名与代码一致 | **不覆盖 mock 与真实后端行为的一致性** | 集成测试（待建） |
| 跨端路径对账 | `apps/admin-web/scripts/smoke.mjs` | 从 `routes/index.ts` 的 `use()` 推导真实前缀，与前端 API 层逐条比对 | 不校验响应体 | 服务端 `route-path-contract.test.ts`（对偶） |
| 端点契约测试 | 小笺 陪聊员端 | 端侧调用路径/方法 ≡ 契约登记 | 不校验出参 | — |

## 五、已知盲区（**没人守**的事，故列在这里而非分散在各脚本里）

| 盲区 | 后果 | 谁会发现 |
|---|---|---|
| **真机 `migrate deploy` 从未执行** | 迁移能否在真实 MySQL 跑通**未知** | 上线前必查（`DEPLOYMENT.md` §4） |
| `miniapp-user` / `admin-web` **零测试** | 两端行为靠对账门禁，不靠单测 | 目前无人 |
| **多个 vitest 并发跑**互相抢报告目录 | 报告数字失真；且**默认 reporter 在该场景下报全绿** | 门禁（`B≠C` 判定，但默认 reporter 不可信） |
| 契约 §3.3 缺 7 个 payments 端点登记 | 「以契约为准」在支付章节是空的 | 已报 team-lead → 归图南 |
| `commissions` 表零写入路径 | 已设计未实现；一旦有人写，`commission_no` 无生成逻辑 → 唯一索引冲突 | 门禁 6.7-b（白名单可豁免） |
| `insurance_policies.policy_no` **两种历史格式**并存 | 解析时依赖格式会失效（**只能精确匹配查库**） | 人工 review（已写进 schema 注释） |
| 配置键 **11 个无中文名** | 前端回退显示 key 原名（**设计如此，不是缺口**） | 段 6.6 INFO |