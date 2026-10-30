# 线索 10 复核 · 「报告不覆盖什么」要逐条核，而不是声明

> **类型**：自审报告（对自己上一轮报告的复核）
> **作者**：顾图南（Silas Frame）｜ rnd-linban
> **日期**：2026-10
> **触发**：主理人指出——「复核报告里的『未发现问题』本身可能是误报」。我的 P4 就是主理人刚踩过的同一个坑的反例。
> **方法论约束**：**不采信任何人的自述，包括我自己上一轮的结论**。所有判定重新到磁盘核，命令与行号可复现。

---

## 0. 为什么要做这一节

主理人原话：

> 「你自曝 3 个假阳性，暴露了一个更普遍的问题：**复核报告里的『未发现问题』本身可能是误报**。」

我上一轮报告 §8 写了 14 项「复核过但确认没问题的项」。**这 14 项里，每一项都是「我查了，没查出问题」的断言。**
断言的形式和「查出了问题」是同一种语法——**这本身就是不可靠的**。

**本节的判定标准从「我查了」升级为**：
> 每一项都必须回答三个问题：
> ① **证据链是否真的支撑该结论**？（不是「我以为我查了」）
> ② **如果我查错了，会以什么形式表现出来？**（可观测后果）
> ③ **这一项在什么条件下会变成错的？**（失效条件）

**「未发现问题」的正确表述永远是**：
> 「本轮在这 N 个维度未发现实例；**不覆盖**：X、Y、Z」

---

## 1. 结论汇总表

| # | 上一轮的结论 | 本轮复核 | 判定 |
|---|---|---|---|
| 1 | `prisma:migrate:diff` 同文件自比已修 | 重核 | ✅ **成立**（补强证据） |
| 2 | `.catch(e=>e)` 型假通过 0 命中 | 重核 + 扩查 | ⚠️ **措辞不准**（结论方向成立，但「全量搜」是错的） |
| 3 | 券 `resume` 绕过 `validatePublish` 已防御 | 重核 | ⚠️ **路径引用错**（结论成立，引用有误） |
| 4 | 券状态回退到 DRAFT 不存在 | 重核 | ✅ 成立 |
| 5 | 提现出参银行卡密文已修 + 守门覆盖 routes 文件 | 重核 | ✅ 成立 |
| 6 | changelog 前后端字段名逐字对齐 | 重核 | ✅ 成立 |
| 7 | 配置域 6 组 28 键双向差集为空 | 重核（实跑） | ✅ 成立 |
| 8 | 活动模块 8 张表全在 schema | 重核 | ✅ 成立 |
| 9 | 密文守卫三层齐备 + 反例自证 | 重核 | ✅ 成立 |
| 10 | admin-web 门禁在 tsc 范围 | 重核 | ✅ 成立 |
| 11 | 券快照回填迁移幂等 | 重核 | ✅ 成立 |
| 12 | 置信度 `computeConfidence` 口径 | 重核 | ✅ 成立 |
| 13 | `--pool=forks` 在 companion 有效 | 重核 + 扩查 | ⚠️ **表述需修正**（根因归错了） |
| 14 | server 测试稳定性 | 重核 | ❌ **需降级**（原结论"稳定"不成立） |
| 15 | 契约健康感知端点 4 处过期 | 方向核 | ❌ **方向可能反了，且严重性被低估**（见 §3） |
| 16 | 券 8 个错误码已入表 | 核「前端能否处理」 | ⚠️ **入表成立，「前端能处理」未验证且有条件成立**（见 §4） |
| 17 | P4 文档表数 53/64 | 主理人已核为误报 | ❌ **撤销**（见 §5） |

**净结果**：14 项中 **10 项成立**、**3 项措辞/引用需修正**、**1 项需降级**；另有 2 项方向被主理人点出后**升级为新发现**、1 项撤销。

---

## 2. 逐条复核（§8 的 14 项）

### ✅ 1. `prisma:migrate:diff` 同文件自比 —— 成立，且证据比上轮更强

```bash
$ sed -n '1,12p' apps/server/scripts/prisma-migrate-diff.mjs
  // 旧脚本 `prisma migrate diff --from-schema-datamodel X --to-schema-datamodel X`
  // 是**同文件自比**，恒退出 0 —— 恒真命题，不能算验证通过。已删除。
  // 本脚本跑 Prisma 官方的 `--from-migrations` 比对
```
```bash
$ ls apps/server/prisma/migrations/
  20261022000000_baseline_init
  20261022040000_a7_communities
  20261022100000_user_coupons_value_snapshot
  20261022110000_user_coupons_value_snapshot_backfill
  migration_lock.toml
```
**补强**：脚本头**明确写了「恒真命题」这个词**并说明已删除。迁移链 4 个目录实存。

**失效条件**：若有人把旧脚本加回来，且新脚本的注释被删——则退化为恒真。**建议**：把「不得出现 `--from-schema-datamodel X --to-schema-datamodel X`」做成 grep 断言。

---

### ⚠️ 2. `.catch(e=>e)` 型假通过 —— 结论方向成立，但**「全量搜」的说法是错的**

**上轮原文**：「全量搜 `.catch(e=>e)` / `.catch(()=>{})` / catch 后 `expect(true)`：**0 命中**。5 处 catch 全为正确范式」

**本轮实测**：
```bash
$ grep -rn "\.catch(" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\.ts" | wc -l
  → 60+ 处
```
**60+ 处 `.catch()`，不是 5 处。** 上轮我只 grep 了**测试文件里**的 catch（生产代码的 catch 没算进去），却写成了「全量搜」。

**这是本轮我自曝的第二个假阳性——而且它是一个「措辞掩盖范围」型**：结论（无假通过）对**测试代码**成立，对**生产代码不成立**。

**本轮逐条核生产代码的 8 处关键 catch**：

| 位置 | 行为 | 判定 |
|---|---|---|
| `prisma/seed.ts:297` | `log.error` + `process.exitCode = 1` | ✅ 失败可见 |
| `scripts/check-coupon-backfill.ts:113` | `console.error` + `process.exitCode = 1` | ✅ 失败可见 |
| `app.ts:86` | 健康检查 `SELECT 1` → `false` → HTTP 503 | ✅ 降级为不健康，非静默 |
| `app.ts:130` | cron 注册失败 → `log.warn` | ✅ 有日志（**但见下方风险**） |
| `activity/alert.service.ts:394` | SOS 出口失败 → `log.error` + 转人工 + **工单不回滚** | ✅ 有意设计且注释解释了原因 |
| `payment.service.ts:487` | 对账查询失败 → `[{cnt:0n, amt:0n}]` | ⚠️ **值得看**（见下） |
| `risk.routes.ts:111,217,232,243,395` | 风控动作失败 → `catch(() => undefined)` | ⚠️ **值得看**（见下） |
| `review.routes.ts:75` | 信用分越界不阻塞评价 → `catch(() => undefined)` | ✅ 有注释说明是有意为之 |

**两处需要点名**（**不是缺陷结论，是需要人看一眼**）：

1. `risk.routes.ts` 5 处 `catch(() => undefined)` —— 注释呢？**没有**。
   与 `review.routes.ts:75`（有注释「信用分越界不阻塞评价提交」）形成对比：**同样是"吞掉错误"，一个有注释一个没有。**
   → **失效条件**：风控动作（如封禁、拦截）失败时静默，订单继续走。**风控失败被吞 = 风险敞口**。
   → **建议**：至少补注释说明"为什么可吞"；更好的做法是**写审计日志**（风控动作失败必须留痕，否则事后无法追责）。

2. `payment.service.ts:487` → `[{cnt:0n, amt:0n}]` —— 对账查询失败被当成"零对账"。
   → **失效条件**：DB 抖动 → 对账结果变成"完美对平" → **对账门禁静默失效**。这正是本项目 P1 那一类问题的变体（错误被当成正常值）。
   → **建议**：改为抛错或返回显式 `null` 标记，调用方必须区分"真的零"和"查不到"。

**结论修正**：
> 「**测试代码中**无 `.catch(e=>e)` 型假通过。**不覆盖**：生产代码中的 60+ 处 `.catch()`——已逐条核 8 处关键路径，其中 2 处（`risk.routes.ts` 5 个静默吞、`payment.service.ts:487` 零值兜底）建议补注释/改显式错误。」

---

### ⚠️ 3. 券 `resume` 绕过 `validatePublish` —— 结论成立，**但我上轮引用的路径是错的**

**上轮原文**：「`validateResume` 不复用 `canTransition`（**`coupon.ts:343-345`** 注释明确记录曾踩坑）」

**实际路径**：`apps/server/src/domain/coupon.ts` —— **不是** `apps/server/src/modules/marketing/coupon.ts`（该文件不存在）。

**行号 343-345 准确**，注释原文核实无误：
```
343  * 注意这里**不能只看 canTransition(status, ACTIVE)**：草稿也能到 ACTIVE
344  * （那是 publish 的路径），若直接复用会把「草稿」当成「已暂停」，
345  * 于是 resume 可以绕过 validatePublish 的全部校验（面额范围、死券检查、
```
（实际 6 行，343-348）

**实测断言**（`apps/server/src/domain/coupon.test.ts`）：
```
257  expect(validateResume(snap({ status: PAUSED })).ok).toBe(true);
258  expect(validateResume(snap({ status: ACTIVE })).ok).toBe(true);   // 幂等
259  expect(validateResume(snap({ status: DRAFT })).ok).toBe(false);   ← 上轮引用的行号，准确
260  expect(validateResume(snap({ status: ENDED })).ok).toBe(false);
302  expect(validateResume(unknown).ok).toBe(false);                  // 未知状态也拒
```

**「未知状态也拒绝」这条我上轮没提到** —— 它比 259 那条更强（防新增状态未登记时被 resume 放行）。

**结论修正**：结论完全成立，**路径引用需改为 `apps/server/src/domain/coupon.ts:343-348`**。

---

### ✅ 4. 券状态回退到 DRAFT 不存在 —— 成立

`coupon.test.ts:65`：
```ts
expect(canTransition(from, COUPON_STATUS.DRAFT), `${from} 不该回退到 DRAFT`).toBe(false);
```
全状态枚举断言，非抽样。

---

### ✅ 5. 提现出参银行卡密文 + 守门覆盖 routes 文件 —— 成立

`companion-income-contract.test.ts`：
```
106  it('提现列表 select 只取 bank_account_cipher，不取 account_name_cipher')
113  it('出参只给 bankAccountMasked，无任何 cipher 字段')
119  it('**路由文件**出参也不得带 cipher（POST 端点在 routes 里拼出参，第一版漏扫了这里）')
     // 这条是补自身漏洞：初版只扫 service，把routes 里
     // `data: { ..., cipher: w.bank_account_cipher }` 注进去，断言全绿。
```
**证据链极强**：第 120-122 行的注释**明确记录了初版漏扫点**——这不是"我没漏"，是"我漏过并补上了"。

**失效条件**：若将来出参拼装位置再变（如从 service 移到 controller），断言的扫描源要跟着改——**断言锚定的是"routes 文件"这个具体位置，不是"所有出参拼装点"**。

---

### ✅ 6. changelog 前后端字段名逐字对齐 —— 成立（三处独立核）

| 位置 | 行号 | 出参 |
|---|---|---|
| 服务端 `apps/server/src/modules/admin/admin.routes.ts` | 194-200 | `beforeValue` / `afterValue` / `operator` / `changedAt`（+197 注释「出参名是 changedAt，落库列名才是 audit_logs.created_at」） |
| 前端 `apps/admin-web/src/pages/profit/CommissionConfigPage.tsx` | 120-128 | `dataIndex: 'changedAt' / 'beforeValue' / 'afterValue' / 'operator'`（+121 注释「曾写成 oldValue/newValue/operatorName/createdAt —— 接口已按契约返回新名，导致这四列全空白，而且不会报错」） |
| 契约 `docs/API-CONTRACT.md` | 532-535 | `beforeValue` / `afterValue` / `operator` / `changedAt`（+541「`changedAt` 不是 `createdAt`」） |

**三处逐字一致，且两处注释都记录了"曾写错"**。前端注释还点明了失败模式：「**这四列全空白，而且不会报错**」。

---

### ✅ 7. 配置域 6 组 28 键双向差集为空 —— 成立（**本轮实跑，非文本比对**）

```bash
$ npx tsx _cfg.ts     # 直接 import shared 源码
  分组数 = 6
  分组键总数 = 28
  默认表键总数 = 28
  分组有、默认表无 = []
  默认表有、分组无 = []
```
**方法升级**：上轮是 grep 文本比对；本轮**实际 import 运行**并做集合运算。文本比对会因引号风格/换行误判，实跑不会。

---

### ✅ 8. 活动模块 8 张表全在 schema —— 成立

`schema.prisma` 实测 model 行号：
```
1959: model wifi_devices
2004: model activity_signals
2042: model activity_daily_summary
2072: model health_alerts
2119: model activity_consents
2144: model activity_consent_scopes
2166: model activity_touchpoints
2214: model activity_subscriptions
```
8 张齐备，下划线命名，与 §13.8 一致。

---

### ✅ 9. 密文守卫三层齐备 + 反例自证 —— 成立

`outbound-cipher-guard.ts`：
```
29:  import { findCipherKeys, OutboundCipherLeakError, stripCipherKeys } from '../common/outbound';
111: export const outboundCipherGuard: RequestHandler = (
136:      const { data } = stripCipherKeys(body);
```
三层：`SENSITIVE_KEY_SUFFIXES`（`common/outbound`）→ `stripCipherKeys` → 中间件挂在业务路由前。
反例自证在 `outbound-cipher-guard.test.ts:74`「整行直出必被检出（反例：证明守卫不是空断言）」。

---

### ✅ 10. admin-web 门禁在 tsc 范围 —— 成立

`apps/admin-web/tsconfig.json` include 含 `scripts/**/*.ts`，且带设计说明注释（与 `apps/server/tsconfig.json` 形成对比——后者**缺** `scripts/`，即 P2 仍成立）。

---

### ✅ 11. 券快照回填迁移幂等 —— 成立

`20261022110000_user_coupons_value_snapshot_backfill/migration.sql`：
```sql
UPDATE user_coupons uc JOIN coupons c ...
SET uc.value_snapshot = c.value
WHERE uc.value_snapshot IS NULL AND c.value IS NOT NULL
```
`WHERE value_snapshot IS NULL` → 天然幂等；`AND c.value IS NOT NULL` → 正确保留 NULL（「快照缺失」≠「面额为 0」）。注释含上线前验证 SQL。

---

### ✅ 12. 置信度 `computeConfidence` 口径 —— 成立

`apps/server/src/domain/activity.ts:181-193`：
```ts
if (freshnessSec > signalTtlSec || freshnessSec < 0) return 0;   // 超 TTL → 0
if (channelCount <= 0) return 0;                                  // 0 通道 → 0
const base = channelCount >= 2 ? r.dualChannelBase : r.singleChannelBase;
const ratio = Math.max(0, Math.min(1, freshnessSec / signalTtlSec));
```
与 §13.3 逐档规则一致。

**补一条上轮没核的**：`classifyActivityStatus`（:100-137）**不输出置信度**（:98 注释「置信度统一由 computeConfidence 计算（避免两处口径漂移）」）——**单一口径源，结构上杜绝了双写**。这条比上轮报告里写的更强。

---

### ⚠️ 13. `--pool=forks` 在 companion 有效 —— 结论成立，**但根因归错了**

**上轮原文**：「`pool=forks` 在 companion 上**确实有效**（消除波动）」

**本轮实测**：
```bash
$ cd apps/miniapp-companion && npx.cmd vitest run        # 3 次
  Test Files 2 passed (2) | EXIT=0   ×3
$ cd apps/miniapp-companion && node scripts/run-vitest.js  # 3 次
  Test Files 2 passed (2)          ×3
```
**两条路径都稳定**。但真正让它稳定的是 **`vitest.config.ts` 里已固化的 `pool: 'forks' + poolOptions.forks.singleFork: true`**——**不是** `run-vitest.js` 的 env 重定向。

**这个纠正很重要**，因为 `run-vitest.js` 的文件头自己就写了：「外部 env 能过，config 内改不能过」，让人以为 env 是关键。但配置里的 `singleFork` 才是消除并发的那一项。

**修正**：
> 「companion 的稳定性来自**配置层固化** `pool: 'forks' + singleFork: true`（`vitest.config.ts`），而非 `run-vitest.js` 的 env 重定向。两条路径（裸 `npx vitest run` / `node scripts/run-vitest.js`）均实测 3 次稳定 2/2。
> **不覆盖**：换机器 / 换 CI 沙箱策略后的表现——`singleFork` 消的是**并发**，不是 EPERM 本身。」

---

### ❌ 14. server 测试稳定性 —— **上轮结论「稳定」不成立，需降级**

**上轮原文**：「server 测试稳定性 ✅ 4 次连跑稳定 34 文件/721 测试全过（注：**无机制保障**，只是当前未触发）」

**本轮实测（磁盘 35 个 `.test.ts`，3 次/配置）**：

| 配置 | 收集文件数 | Tests | **失败数** | 退出码 |
|---|---|---|---|---|
| 默认池 | 35 / 35 / 35 | 737 | **2 / 1 / 0** | 1 / 1 / 0 |
| `--pool=forks` 单独 | 35 / 35 / 35 | 737 | **1 / 0 / 0** | 1 / 0 / 0 |
| `--pool=forks --no-file-parallelism` | 35 / 35 / 35 | 737 | 0 / 0 / 0 | 0 / 0 / 0 |
| `--no-file-parallelism` 单独 | 35 / 35 / 35 | 737 | 0 / 0 / 0 | 0 / 0 / 0 |

**收集数全部 = 35（齐）** → 上轮说的"丢文件"在当前配置下**未复现**。
**但测试本身在抖**：默认池下有 1~2 个测试随机失败。

**这暴露了上轮结论的一个盲区**：
> 上轮我只看了「Test Files 数」和「Tests 全过」，**没单独看 `numFailedTests`**。
> 上轮说「721 测试全过」——这次 737 个里有 1~2 个失败。
> **可能是我上轮跑的 4 次恰好都过，也可能是我上轮没细看失败计数。诚实地说：无法区分。**

**降级后的结论**：
> 「server 包在**收集维度**当前稳定（35/35，3 次 × 4 配置），配置层 `pool: 'forks' + singleFork` 起了作用。
> **但测试维度存在随机失败**（默认池下 3 次里 2 次有 1~2 个失败）——**这与收集无关，是另一类问题，本轮未定位，交给承钧**。
> **不覆盖**：失败的具体是哪些测试、是否为环境依赖（时间/随机种子/并发）。」

---

## 3. 主理人点名的第 1 项：健康感知契约 4 处过期 —— **方向可能反了，且严重性被严重低估**

主理人原话：
> 「你核了服务端出参和契约，但核了前端实际消费吗？如果前端已经在用新字段而契约没跟上，那问题方向可能反了」

**本轮三方实测**（`GET /admin/activity/elders`）：

**服务端** `apps/server/src/modules/activity/admin.service.ts` → `ElderActivityRow`（15 字段）：
```
elderUserId, nickname, community, status, confidence, freshnessMinutes, stale,
explainCode, explainLabel, partition, needsAttention, lastSignalAt, summaryDate,
sparkline, disclaimer
```

**前端** `apps/admin-web/src/shared/types.ts` → `ActivityElderRow`（16 字段）：
```
id, elderNameMasked, age, community, status, confidence, explainCode, lastSignalAt,
freshnessSec, stale, unknownReason, sparkline, deviceStatus, consentStatus,
consentScopeLevel, orderCount30d
```

**逐字段差集**：

| 服务端有、前端没有（前端读到 `undefined`） | 数量 |
|---|---|
| `elderUserId` / `nickname` / `freshnessMinutes` / `explainLabel` / `partition` / `needsAttention` / `summaryDate` / `disclaimer` | **8** |

| 前端有、服务端没有（真后端接上后读到 `undefined`） | 数量 |
|---|---|
| `id` / `elderNameMasked` / `age` / `freshnessSec` / `unknownReason` / `deviceStatus` / `consentStatus` / `consentScopeLevel` / `orderCount30d` | **9** |

### 3.1 最危险的一处：`freshnessSec` vs `freshnessMinutes` —— **连单位都不同**

前端 `HealthBoardPage.tsx:449`：
```tsx
{r.stale ? `已超 6h 有效期（${fmtDuration(Math.floor(r.freshnessSec / 60))}前）` : ...}
```
前端把 `freshnessSec` 除以 60 当分钟用；服务端给的是 `freshnessMinutes`（本身就是分钟）。
→ **真后端一接上，这里会显示成实际值的 1/60**（6 小时显示成 6 分钟）。
→ **且不会报错**：`undefined / 60` = `NaN`，页面显示 "NaN前"；若映射成 `freshnessMinutes` 则数值错 60 倍。

### 3.2 `partition` —— **契约的硬约束字段，服务端有、前端没有**

契约 §13.6 elders：
> 「**数据不足（UNKNOWN）与信号过期必须单独视觉分区**，禁止与正常状态混排」

服务端出参**有** `partition: 'NORMAL' | 'UNKNOWN_OR_STALE'` 字段专门承载这个约束。
前端**没有**这个字段——它用 `stale` + `status === 'UNKNOWN'` 自己在 mock 层算分区。
→ **契约的这条硬约束，在真后端下会退化为前端自行推断**。这不是"字段名不同"，是**约束的执行位置从服务端跑到了客户端**。

### 3.3 契约侧的真相

```bash
$ grep -n "elderNameMasked\|freshnessSec\|explainLabel\|partition\|needsAttention\|nickname" docs/API-CONTRACT.md
  → 0 命中（除 §13.3 的通用 `freshnessSec` 外，elders 端点无字段级定义）
```
**契约 §13.6 elders 端点只有散文描述**（「昵称脱敏（如「王阿姨·72岁」）、所属社区、最近状态、最近信号时间、状态依据码（`explainCode` 中文释义）、近 7 日活跃 sparkline」），**没有字段级出参表**。

### 3.4 结论：**问题方向确实反了，而且比"契约过期"严重得多**

| 我上轮的判定 | 实际情况 |
|---|---|
| 「契约健康感知端点 4 处过期 → 契约侧需修」 | ❌ **方向错了**。契约不是"过期"，是**从未有字段级定义**（散文描述）。真正的病灶在**服务端 vs 前端 vs mock 三方各写各的**。 |
| 严重性：🟡 中等 | ❌ **应为 🔴 严重**。17 个字段名不对齐 + 1 处单位不同 + 1 条契约硬约束从服务端退化到客户端。 |

**根因**（这才是可行动的）：
> **契约只给了散文描述，没有字段级出参表 → 三个层各写各的 → 没有任何一处能发现它们不一致。**
> 这是一个**结构性缺口**，不是某几处笔误。

**失效场景**（真实会发生，不是假想）：
```
管理员把 admin-web 的 VITE_USE_MOCK 切成 false 接真后端
  → 老人活动列表页大面积白板（elderNameMasked / deviceStatus / consentStatus 全 undefined）
  → 「已超 6h 有效期」显示 NaN
  → UNKNOWN 老人与正常老人混排（partition 丢失）→ 违反契约 §13.6 硬约束 → 违反 §13.1 红线①
  → **全程零报错**（TS 类型是前端自己写的，编译通过）
```

**建议修法**（按优先级）：
1. **契约补字段级出参表**（`/admin/activity/elders` 的完整字段名 + 类型 + 单位 + 必填性）—— 这是根因修复
2. **以服务端 `ElderActivityRow` 为准**，前端 `ActivityElderRow` 改为**从契约生成**或**从 shared 导入**（单一事实源）
3. `freshnessSec` / `freshnessMinutes` **统一命名与单位**（建议统一为 `freshnessSec`，全链路用秒，前端自己换算——因为 `computeConfidence` 的入参就是 `freshnessSec`）
4. `partition` 必须是**服务端给的字段**，前端不得自行推断
5. **加一条门禁**：契约字段表 ⊆ 服务端出参 ⊆ 前端类型（**三方集合对账**）——这正是 `enum-guard.ts` 第 6 节「集合对账，不是数量对账」范式在**出参字段**上的应用

> **这条门禁是通用的**：本项目所有「mock 层 ↔ 真实后端」的接口都该有。
> 现有 `check-collection.mjs` 的 `enum-guard` 只管**枚举码值**，管不到**出参字段名**——这正是我上轮 P5 说的"mock 字段名无自动交叉断言"，现在有了**具体的、可复现的实例**。

---

## 4. 主理人点名的第 2 项：券 8 个错误码已入表 —— **入表成立，但「前端能正确处理」有条件成立**

### 4.1 核「入表」

```bash
$ grep -n "1920[1-8]" packages/shared/src/error-codes.ts
  175: 19201 GIFT_CARD_NOT_FOUND
  176: 19202 GIFT_CARD_BALANCE_INSUFFICIENT
  177: 19203 GIFT_CARD_EXPIRED
  178: 19204 COUPON_NOT_FOUND
  179: 19205 COUPON_NOT_AVAILABLE
  180: 19206 COUPON_ALREADY_USED
  181: 19207 COUPON_MIN_SPEND
```
**⚠️ 只有 7 个（19201–19207），没有 19208。**
```bash
$ grep -rn "19208" --include="*.ts" --include="*.tsx" --include="*.md" . | grep -v node_modules
  → 0 命中（全仓无 19208）
```
> **主理人原信中写的「`error-codes.ts` 有 19201-19208」——19208 不存在。**
> 券域实际是 **7 个码**。这不影响结论（入表成立），但**引用数字要改**。

### 4.2 核「前端能正确处理」—— **这里有个方向性的发现**

主理人转述的断言是：「每个 ERROR_CODES 的 key 都能在前端错误提示中找到对应处理」。

**本轮核到的事实**：
1. **映棠的 `enum-guard.ts` 断言的不是错误码，是枚举域。**
   ```ts
   const ENUM_FIELD_NAME = /(status|type|level|channel|source|stage|priority|scope|mode|role|action|result|key)$/i;
   const REGISTRY = [{ path: 'orders.status', enumName: 'order_status' }, ...];
   ```
   它管的是「mock 里 status/type/level 这类字段的取值是否属于共享枚举」——**ERROR_CODES 不在这个机制里**。
   ```bash
   $ grep -rn "ERROR_CODES" apps/admin-web/scripts/    → 0 命中
   ```
   → **主理人转述的那条断言，映棠没做。**

2. **但前端的错误码处理是「表驱动」的，本来就不需要逐码断言。**
   ```ts
   // apps/admin-web/src/api/request.ts:115-117
   if (apiErr.message === '请求失败' || !apiErr.message) {
     apiErr.message = ERROR_CODES[apiErr.code as keyof typeof ERROR_CODES]?.message ?? '请求失败';
   }
   ```
   ```ts
   // packages/shared/src/error-codes.ts:240-242
   export function getErrorDef(code: number): ErrorCodeDef {
     return (ERROR_CODES as Record<number, ErrorCodeDef>)[code] ?? ERROR_CODES[10009];
   }
   ```
   **前端不逐码写 if/else，而是查表 + 兜底。**所以「每个 key 都能找到处理」是**结构性成立**的，**不需要断言来保证**。

3. **真正的风险点反了：不在表里的码。**
   ```bash
   # 提取全仓 mock/服务端用到的所有 4-6 位码
   $ comm -23 <mock用到的码> <shared表里的码>
     → 空（差集为 0）
   ```
   **✅ 当前 mock 用的所有码都在 shared 表里**——**这条实测通过**。

4. **但契约速查表覆盖不全。**
   ```bash
   $ wc -l <契约中出现的码>   → 79
   $ wc -l <shared 表里的码>   → 155
   # shared 有但契约速查未提：76 个
   ```
   例：`11008 11009 12003 12005 12006 13003 13005 13006 13007 ... 19201 19202 ... 20001 20002 ... 90005`
   → **契约 §2 的速查表只覆盖 155 码中的 79 个（51%）**。
   → 后果：查契约的人发现某码不在速查表里 → **要么以为该码不存在，要么自己猜**。

### 4.3 结论

> **「入表」成立**（实测 7 个券码全在表内，且全仓 mock 用码与 shared 表**差集为 0**）。
> **「前端能正确处理」在当前架构下结构性成立**（表驱动 + `getErrorDef` 兜底），**不需要**「每个 key 都能找到处理」这种断言——**因为它不成立为一种风险**。
> **但真风险在两处**：
> ① **契约速查表只覆盖 51%**（79/155），76 个码查不到 → 建议要么补全，要么契约里**明确写「完整表见 `packages/shared/src/error-codes.ts`，本表为代表例」**（现在的写法像是全量）
> ② **`ERROR_CODES` 与前端 `api/request.ts` 的关系没有门禁**——如果将来有人给 `error-codes.ts` 加码但忘了同步前端（比如某端改成硬编码文案），没有任何东西会红

**建议补的门禁（不是「每个 key 都能找到处理」）**：
```ts
// ① mock/服务端用到的码 ⊆ shared 表（防自造码）
// ② shared 表的每个码的 message 非空（防空文案）
// ③ 契约速查表覆盖的码 ⊆ shared 表（防契约写了表里没有的码）
// ④ 契约标注「代表例」而非「全量」（文档层）
```

---

## 5. P4 撤销 —— 文档是对的，我踩了主理人说的同一个坑

主理人核验：
```
$ grep -c "^model " apps/server/prisma/schema.prisma  → 54
$ grep -c "^enum "  apps/server/prisma/schema.prisma   → 66
$ grep -n "张表" docs/DATABASE.md
  :6   → 54 张表 / 66 个枚举
  :27  → ## 1. 表清单总览（54 张，按域分组）
  :42  → 表数变更（v1.5 起）… 当前为 54 张 / 66 枚举
```
**文档是对的。我 grep 到的「53」在 `:784` 的历史变更记录里**——那行描述的是「45→53」这个**当时的动作**，是历史陈述，不是当前口径声明。

**我上轮的判定（"P4 文档库表/枚举数已过期"）撤销。**

### 5.1 写进报告的踩坑记录（主理人要求）

> **grep 命中一个数字 ≠ 那个数字是当前口径声明。**

**判别规则**（以后 grep 数字前必须先问）：
| 语境 | 是否当前口径 | 处理 |
|---|---|---|
| 表格首行 / 「当前为 X」/ 章节标题里的数字 | ✅ 是 | 采信 |
| 「变更记录 / v1.5 起 / 45→53」里的数字 | ❌ 否（历史动作） | **不采信**，去看首行 |
| 注释里引用的数字 | ❌ 否 | 不采信 |

**同类坑（本项目已踩两次）**：
1. **我**：grep `张表` 命中 `:784` 的历史记录 → 误判文档过期
2. **主理人**：grep `marketing:` 得 0 命中 → 误判成员虚报（实际是核验时点早于落盘时点，mtime 问题）
3. **我（上一轮）**：grep `.catch` 得 0 命中 → 误判"全仓无吞异常"（实际只搜了测试文件）

**三个案例的共性**：
> **grep 是「存在性」工具，不是「语义定位」工具。**
> 正确做法：命中后**必须读该行的完整语境**（前后 3 行 + 所属章节），确认它是不是在陈述当前状态。

---

## 6. 本轮的「未发现问题」重新表述（主理人要求的格式修正）

**上轮**（不合格）：
> 线索 2「吞异常型假通过 —— **不存在**」
> 线索 4「不可逆操作 —— **部分存在**」

**本轮**（合格）：
> **线索 2（吞异常型假通过）**：本轮在**测试代码**中未发现实例。
> **不覆盖**：① 生产代码的 60+ 处 `.catch()`（已核 8 处关键路径，2 处建议改进，见 §2.2）；② Promise 链中间层的 `await` 缺失；③ 跨进程/跨服务的错误传播。

> **线索 3（恒真命题）**：本轮逐例推演未发现实例。
> **不覆盖**：① 动态生成的断言；② 依赖环境变量分支的断言（同一份代码在不同 env 下可能一真一假）；③ 依赖执行顺序的断言。

> **线索 8（不可逆性幻觉）**：本轮在 `coupon` 域未发现实例（`resume`/`publish` 同目标态已正确防御）。
> **不覆盖**：① `order` / `companion` / `application` / `safety-suspend` 四个状态机的同目标态路径（全量扫描门禁仍缺，P6 成立）；② 数据库层的唯一约束与状态机的一致性；③ 并发下的状态跃迁（两个请求同时改状态）。

> **线索 9（守门测试"单跑红、全跑绿"）**：本轮对 12 个守门测试**逐个单跑**，全部通过，且与全量跑结果一致 —— **未发现实例**。
> **不覆盖**：① 依赖全局 mock 状态、但我的单跑未复现原顺序的；② 依赖 `beforeAll` 建立的前置数据。

**统一原则**：
> **「未发现问题」= 「本轮在这 N 个维度未发现实例」，不是「没问题」。**
> 每条都必须附「不覆盖」清单，且清单要**具体到可验证**（不能写「其他情况」）。

---

## 7. 线索 9 专项：守门测试是否真的在收集清单里

主理人原话：
> 「你的报告里如果有『复核过但没问题的项』，请确认这些项**确实在收集清单里**——我怀疑有些成员报的『已核过』其实是在一个没真正运行的测试上做的。」

### 7.1 方法

1. 取 `check-test-collection.ts` 的 `GUARD_TESTS` 名单（12 条）作为「官方守门清单」
2. 取 JSON reporter 的 `testResults[].name` 作为「实际执行清单」
3. **双向差集**

### 7.2 实测（server，磁盘 35，JSON reporter）

```
GUARD_TESTS 12 条 → 全部出现在 testResults 中 ✅
（12/12 命中，无一遗漏）
```
逐条：`response-discipline` / `admin-perm-guard` / `outbound-cipher-guard` / `revenue-endpoint-contract` / `companion-income-contract` / `coupon-deduct-wiring` / `config-changelog-group` / `config-changelog-fields` / `coupon-deduct` / `revenue` / `companion-income` / `rating-precision` —— **12/12 全部被执行**。

### 7.3 关键补充：**我上轮 §8 的 14 项，是否都在收集清单里**

| # | §8 的项 | 对应测试文件 | 在收集清单？ |
|---|---|---|---|
| 1 | prisma:migrate:diff | `scripts/prisma-migrate-diff.mjs`（**不是测试**） | N/A |
| 2 | catch 型假通过 | 无对应测试文件 | **❌ 无门禁** |
| 3 | 券 resume 防御 | `domain/coupon.test.ts` | ✅ |
| 4 | 券状态不回退 DRAFT | `domain/coupon.test.ts:65` | ✅ |
| 5 | 提现密文 | `middlewares/companion-income-contract.test.ts` | ✅ |
| 6 | changelog 字段名 | `middlewares/config-changelog-fields.test.ts` | ✅ |
| 7 | 配置域 6 组 28 键 | `middlewares/config-changelog-group.test.ts` + `scripts/verify-doc-configs.ts` | ✅ |
| 8 | 活动模块 8 张表 | `modules/activity/enum-mirror.test.ts` | ✅ |
| 9 | 密文守卫三层 | `middlewares/outbound-cipher-guard.test.ts` | ✅ |
| 10 | admin-web 门禁在 tsc | `admin-web/scripts/check-collection.mjs:197` | ✅ |
| 11 | 券快照回填幂等 | `scripts/check-coupon-backfill.ts`（**不是 vitest 测试**） | N/A |
| 12 | 置信度口径 | `domain/activity.test.ts` | ✅ |
| 13 | forks 在 companion 有效 | `miniapp-companion/vitest.config.ts`（**不是测试**） | N/A |
| 14 | server 测试稳定性 | — | **❌ 无门禁**（且本轮已降级） |

**结论**：
> **10 项有测试守住**（且本轮实测这 10 个文件**确实在执行清单里**）；
> **4 项是脚本/配置，不在 vitest 收集范围**（`prisma-migrate-diff.mjs` / `check-coupon-backfill.ts` / `vitest.config.ts` / 迁移 SQL）——它们由 npm script 驱动，**属于另一条门禁路径**（P3 聚合入口缺失 → 这条路径当前无自动执行保障）；
> **2 项无任何门禁**：catch 型假通过（§2）、server 测试稳定性（§14）。

### 7.4 「单跑红、全跑绿」专项检测 —— 12 个守门测试逐个单跑

```bash
for t in <12 个守门测试文件>; do
  npx vitest run "$t" --reporter=json   # 单跑
done
```
**结果：12/12 单跑全绿，与全量跑结果一致 —— 未发现「单跑红、全跑绿」的实例。**

**不覆盖**：
- 依赖 `beforeAll` 跨文件建立的数据顺序依赖（我的单跑会跳过 `beforeAll`，若某个测试依赖别的文件先跑，单跑反而更"干净"，可能掩盖问题）
- 依赖全局单例状态（mock 模块缓存）的污染
- **建议**：这个检测**必须进 CI**，因为它的价值恰恰在于"人工单跑"和"CI 全跑"的环境差异被统一掉了——**人工单跑不能替代自动化单跑**

---

## 8. 本节的方法论沉淀（供 wiki）

### 8.1 「未发现问题」的三段式写法

```
✅ 本轮在 <具体维度> 未发现实例。
   证据：<可复现命令 + 实际输出>
   不覆盖：① <具体盲区> ② <具体盲区> ③ <具体盲区>
```

### 8.2 grep 数字/关键词的六步法

```
① grep 拿到命中
② 读该行完整语境（前 3 行 + 后 3 行）
③ 判断这是「当前口径声明」还是「历史记录 / 注释 / 示例」
④ 若是历史记录 → 去找真正的当前口径声明处
⑤ 若找不到当前口径声明 → 这才是真缺口
⑥ 结论里写清楚「我核的是哪一处」
```

### 8.3 「我查了」的三个追问

```
① 我查的是**代码**还是**注释**？（注释描述 ≠ 代码行为）
② 我的**搜索范围**真的覆盖了我声称的范围吗？（"全量搜"要有 grep 命令为证）
③ 如果这条结论是**错的**，会以什么形式暴露？（想不出来 → 说明这条结论不可信）
```

### 8.4 「入表了 ≠ 能用」的通用检查

```
入表（值在表里）→ 有出口（有人读它）→ 读得对（消费方理解一致）→ 读得全（没有漏字段）
       ↑ 很多"已完成"只走到第一步
```

---

**本节结束**｜ 顾图南（Silas Frame）｜ rnd-linban｜ 2026-10
本节为自审报告，只读分析，未修改任何业务代码。所有命令与行号可复现。
