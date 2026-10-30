# 邻伴 · 架构复核报告（九项）

>复核员：顾图南（软件架构专家）｜复核窗口：**2026-10-22 04:32 – 04:45**（磁盘快照）
> 项目根：`D:/VC/linban-app/`｜**只读复核，未修改任何源文件**（仅新增本报告）
> 方法：不采信任何口头结论，全部以磁盘实际内容 +脚本实跑为准；对既有校验脚本做了**反向证伪测试**

---

## 0. 结论摘要表

| # | 复核项 | 状态 | 一句话结论 |
|---|---|---|---|
| ① | 配置三处同值（28 项） | ⚠️ **不一致** | `shared` ↔ `DATABASE.md §8` **28/28 四维全等**；但 `ARCHITECTURE.md 附录C` **只有 25 键、缺 3 键、且把 `split_mode` 写成 `SPLIT_MODE`**。既有脚本**只校验两处**，漏掉第三处 |
| ② | 错误码 153 码 16 段零重叠 | ⚠️ **不一致** | 实测 **155 码 / 16 段 / 零重复**（码本身干净）；但契约 `§2` 速查表**11 处代表码语义错配** + `9002` 是不存在的码 |
| ③ | 枚举镜像零失配 | ✅ **一致** | **66/66** 枚举同名同值**同序**；6 项 `TS_ONLY_ALLOWLIST` 例外理由均已写清 |
| ④ | RBAC 三处双写面一致 | ✅ **一致** | 四角色权限集**三处逐值全等**；`revenue:read` 确只给 admin+finance；`permGranted` 三档逻辑正确，18 条单测覆盖三条边界 |
| ⑤ | A7 社区字段闭环 | ✅ **一致** | `communities` 10 列双 `@unique`；三条裁定全部落地；`community: null` **已改真读取** |
| ⑥ | 社区编码全库一致 | ✅ **一致** | 七条`GZ_*` 三处逐字一致，`GZ_TH_HUAYING`（两字母）**已修正**，seed.ts **已落 7 条** |
| ⑦ | 地址脱敏三档 | ✅ **一致** | 失败兜底 / `PLAIN_DEV:` / 三类单测全覆盖；`outboundCipherGuard` 确在 `apiRouter` 之前 |
| ⑧ | 迁移链完整 | ⚠️ **不一致** | 漂移校验 exit=0 且**经证伪测试非恒真**；但 baseline 是**53 表非 54**，且 `value_snapshot` 迁移**已落盘而两份文档均声明「刻意不落 migration」** |
| ⑨ | 契约端点 vs 实现覆盖 | ⚠️ **不一致** | §5.7 实为 **48 项非 45**；服务端实现 **9/48**；重点 5 端点**4 个已落但路径前缀与契约不符**、1 个未落|

**总判定**：9 项中 **4 项完全一致（③④⑤⑥⑦，实为 5 项）**、**4 项不一致**。所有不一致均为**文档侧或双写面滞后**，未发现数据损坏级问题；但 ⑧ 的 `value_snapshot` 是**复核期间的活跃变更且文档仍标「未放行/暂不实现」**，属需立即收口的治理风险。

---

## 1. 逐项详证

### ① 配置三处同值 —— ⚠️ 不一致

#### ①-1 `shared` ↔ `DATABASE.md §8`：28/28 四维全等 ✅

脚本实跑（`apps/server`，退出码 0）：

```
§8 SQL 解析项数：28
shared 常量项数：28
仅 §8 有（应在 shared 无）: 无
仅 shared 有（应在 §8 补）: 无
[PASS] §8 与 shared 逐值一致（键名/值/value_type/顺序 全等）
```

脚本逻辑`apps/server/scripts/verify-doc-configs.ts:52-73` 确实逐位比对**键名、值、value_type、顺序**四维，且做双向差集（`:45-48`），无漏检。

#### ①-2 独立手工核对 4 项（两个口径项+ 两个 DECIMAL/INT 项）

| 键 | `constants.ts` | `DATABASE.md §8` | 类型 | 判定 |
|---|---|---|---|---|
| `cancel_penalty_rate_bp` | `'1000'` / `INT`（`constants.ts:116-120`） | `'1000', 'INT'`（§8 第 18 行） | 一致 | ✅ |
| `commission_rate` | `'0.05'` / `DECIMAL`（`constants.ts:27-31`） | `'0.05', 'DECIMAL'`（§8 第 1 行） | 一致 | ✅ |
| `ai_sample_rate` | `'0.05'` / `DECIMAL`（`constants.ts:67-71`） | `'0.05', 'DECIMAL'` | 一致 | ✅ |
| `deposit_amount` | `'50000'` / `INT`（`constants.ts:32-36`） | `'50000', 'INT'` | 一致 | ✅ |

**两个口径未互相换算、未判为不一致** —— 按任务要求处理。二者口径确实不同且**各自被正确消费**：

- `cancel_penalty_rate_bp` 是**基点整数**，消费侧按 ÷10000：`apps/server/src/modules/order/order.service.ts:515-516`
  ```ts
  const rateBp = await getCancelPenaltyRateBp();
  cancelFee = (order.total_amount_fen * rateBp + 5000n) / 10000n;
  ```
  且有越界回落保护（`order.service.ts:99-109`，`raw<0 || raw>10000` →回落默认）。
- `commission_rate` 是**DECIMAL 比例小数**，消费侧显式换算为 bp：`apps/server/src/domain/commission.ts:78-85`
  ```ts
  const bp = Math.round(rate * BP_PER_PERCENT * BP_PER_PERCENT);  // 0.05 → 500bp
  ```
  `DATABASE.md §8` 亦有互斥口径标注（原文明示「基点整数与比例小数是两套口径，禁止互相换算或合并同列」）。

#### ①-3 `ARCHITECTURE.md 附录C`：❌ 缺 3 键 + 1 处键名错 —— 这就是脚本漏检处

`ARCHITECTURE.md` 附录 C 实测 **25 个配置键**，shared 有 28 键。差集（`diff` 实跑）：

```
===DIFF shared vs archC===
11,12c11,12
< credit_limit_threshold
< credit_freeze_threshold
---
> SPLIT_MODE
> night_confirm_timeout_min
15,17d14
< night_confirm_timeout_min
< split_mode
< cancel_penalty_rate_bp
```

具体证据（`docs/ARCHITECTURE.md` 附录 C，行1238-1263）：

- `:1248` 写的是 **`| \`SPLIT_MODE\` | wechat_profit_sharing |** —— `SPLIT_MODE` 是**代码常量名**（`constants.ts:391`），而 `system_configs` 的**配置键是 `split_mode`**（`constants.ts:105-110`，§8 亦为 `'split_mode'`）。**键名错，运营按文档去后台改配置会找不到键。**
- **缺 `credit_limit_threshold`（60/INT）** —— 信用限流阈值，是真实运行期配置。
- **缺 `credit_freeze_threshold`（40/INT）** —— 信用冻结阈值，同上。
- **缺 `cancel_penalty_rate_bp`（1000/INT）** —— 违约金比例，**这是财务审计口径项**（团队裁定要求任何改动必须落 `audit_logs`，`constants.ts:111-120`）。附录 C 是架构层配置清单，缺它等于架构文档不认这个配置项。
- 顺序也与 shared 不一致：shared 中 `split_mode` 在 `night_confirm_timeout_min` **之后**、`cancel_penalty_rate_bp` 紧随其后；附录 C 把 `SPLIT_MODE` 放在 `report_reward` 之后。

#### ①-4 `ARCHITECTURE.md §13.11`：✅ 11 项权威 activity 配置全等

`ARCHITECTURE.md:1113-1123` 的 11 行与 shared 的 11 个 `activity_*` 键**键名/值/类型全等**（`activity_watch_enabled=false`、`activity_signal_ttl=21600`、`activity_alert_suppress_min=180`、`activity_dispatch_bonus_low=5`/`_still=10` 等逐项核对一致）。§13.11 只管 activity 11 项，**不含**其余 17 项属正常（它自称「权威 11 项」），故此项✅。

**根因**：`verify-doc-configs.ts:24-25` 只读 `docs/DATABASE.md`，**全文无`ARCHITECTURE.md` 字样** —— 脚本结构性无法发现附录 C 的偏差。这正是「脚本绿≠文档对」的典型。

---

### ② 错误码 —— ⚠️ 不一致

#### ②-1 码表本体：16 段 / 零重叠 / 段内连续 ✅

独立解析 `packages/shared/src/error-codes.ts:40-231` 实测：

```
TOTAL CODES: 155
SEGMENTS(16): 10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,90
dup codes: 0
dup keys: 0
```

分段明细（每段 `contig=true` 即段内码连续无空洞）：

| 段 | 码数 | 区间 | 连续 |
|---|---|---|---|
| 10xxx | 10 | 10001-10010 | ✅ |
| 11xxx | 9 | 11001-11009 | ✅ |
| 12xxx | 6 | 12001-12006 | ✅ |
| 13xxx | 15 | 13001-13015 | ✅ |
| 14xxx | 19 | 14001-14019 | ✅ |
| 15xxx | 20 | 15001-15020 | ✅ |
| 16xxx | 11 | 16001-16011 | ✅ |
| 17xxx | 7 | 17001-17007 | ✅ |
| 18xxx | 7 | 18001-18007 | ✅ |
| 19xxx | 14 | 19001/19101/19207 | ✅（三子段，符合设计） |
| 20xxx | 8 | 20001-20008 | ✅ |
| 21xxx | 6 | 21001-21006 | ✅ |
| **22xxx** | **6** | 22001-22006 | ✅ |
| **23xxx** | **5** | 23001-23005 | ✅ |
| **24xxx** | **7** | 24001-24007 | ✅ |
| 90xxx | 5 | 90001-90005 | ✅ |

- **段号连续** ✅：16 段无跳号。
- **段内无重叠** ✅：`dup codes: 0` / `dup keys: 0`；三段 activity 码互不交叉。
- **总数**：实测 **155**，任务口径为 153。差异说明见 🔴-2。

#### ②-2 22xxx/23xxx/24xxx 三段 18 码：文档与代码**完全一致** ✅

`API-CONTRACT.md §13.2`（`:579-616`）明细表实测 18 行，码集`22001-22006, 23001-23005, 24001-24007`，与 `error-codes.ts:201-223` **逐码逐 key 一致**：

- `22001 ACTIVITY_CONSENT_REQUIRED` / `22002 ACTIVITY_DEVICE_NOT_BOUND` / `22003 ACTIVITY_DEVICE_OFFLINE` / `22004 ACTIVITY_FEATURE_INVALID` / `22005 ACTIVITY_CHANNEL_AUTH_FAILED` / `22006 ACTIVITY_COLLECTION_STOPPED`
- `23001 ACTIVITY_DATA_NOT_READY` / `23002 ACTIVITY_CONFIDENCE_TOO_LOW` / `23003 ACTIVITY_DATE_RANGE_INVALID` / `23004 ACTIVITY_ACCESS_DENIED` / `23005 ACTIVITY_SUMMARY_NOT_FOUND`
- `24001 ACTIVITY_ALERT_NOT_FOUND` / `24002 ACTIVITY_ALERT_ALREADY_HANDLED` / `24003 ACTIVITY_ALERT_SUPPRESSED` / `24004 ACTIVITY_CROSS_VERIFY_INSUFFICIENT` / `24005 ACTIVITY_ALERT_ESCALATE_FAILED` / `24006 ACTIVITY_ALERT_LEVEL_INVALID` / `24007 ACTIVITY_ALERT_TRANSITION_INVALID`

契约 `§2` 速查表 `:78-79` 的三段代表码也与代码一致（23001/23002/23004/23005、24001/24002/24003/24004/24006/24007 语义均对）。

#### ②-3 ❌ `API-CONTRACT.md §2` 速查表：11 处代表码语义错配 + 1 个不存在的码

`docs/API-CONTRACT.md:64-80`。实测逐条比对（文档标注 vs `error-codes.ts` 实际key）：

| 行 | 段 | 文档称 | 该码实际是 | 问题 |
|---|---|---|---|---|
| `:65` | 10xxx | `10009` 幂等冲突 | `INTERNAL_ERROR`「服务开小差了」 | ❌ 幂等冲突实为 `10006 IDEMPOTENCY_CONFLICT` |
| `:65` | 10xxx | `10010` 触发限流 | `DEPENDENCY_UNAVAILABLE` | ❌ 限流实为 `10005 RATE_LIMITED` |
| `:66` | 11xxx | `11001` 未登录 | `WX_CODE_INVALID`「微信 code 无效」 | ❌ 未登录实为 `10002 UNAUTHORIZED` |
| `:66` | 11xxx | `11002` token 过期 | `WX_LOGIN_FAILED` | ❌ token 过期实为 `10003 TOKEN_EXPIRED` |
| `:68` | 13xxx | `13002` 四审状态不允许 | `APPLICATION_NOT_FOUND` | ❌ 四审非法流转实为 `13004 STAGE_ILLEGAL_TRANSITION` |
| `:71` | 16xxx | `16005` 动态码错误 | `FACE_SCORE_TOO_LOW` | ❌ 动态码错误实为 `16002 DYNAMIC_CODE_INVALID` |
| `:71` | 16xxx | `16007` 人脸分不足 | `GPS_DEVIATION_TOO_LARGE` | ❌ 人脸分不足实为 `16005 FACE_SCORE_TOO_LOW` |
| `:72` | 17xxx | `17003` 禁止脱离订单私聊 | `MESSAGE_BLOCKED`「消息含违规内容」 | ❌ 语义完全不同 |
| `:75` | 21xxx | `21001` 缺少权限 | `ADMIN_NOT_FOUND` | ❌ 无权限实为 `10004 FORBIDDEN` |
| `:80` | 90xxx | `90001` 内部错误 | `DB_ERROR`「数据库服务异常」 | ❌ 内部错误实为 `10009 INTERNAL_ERROR` |
| `:80` | 90xxx | `9002` 第三方超时 | **该码不存在** | ❌ 第三方超时实为 `90004 THIRD_PARTY_ERROR`；且 `9002` 只有 4 位，是**笔误** |

共**11 处语义错配**。这类错误最危险的地方在于：前端/后端若照 `§2` 速查表做「码→文案」映射，会把「限流」提示成「依赖服务不可用」，把「无权限」提示成「后台账号不存在」——**用户看到的提示是错的，且不报错**。

---

### ③ 枚举镜像零失配 —— ✅ 一致

#### ③-1 脚本实跑

`npx vitest run src/modules/activity/enum-mirror.test.ts` → **9 passed**（`Test Files 1 passed / Tests 9 passed`）。

#### ③-2 独立复核（自写解析器，CRLF 已归一）

```
schema enums: 66 | shared enum consts: 67
--- RESULT ---
MATCH: 66
MISSING in shared: none
ORDER DIFF: none
VALUE DIFF: none
model count: 54
schema enum count: 66
```

**66/66 枚举同名、同值、同序，零缺失零错序**。shared 多出的 1 个const 是 `activity_bonus_reason`（合法 TS-only 例外）。计数与任务口径一致：**54 model / 66 enum** ✅。

#### ③-3 三个指定枚举独立核验

| 枚举 | schema.prisma | shared/enums.ts | 判定 |
|---|---|---|---|
| `activity_touch_channel` | `["PUSH","SMS","IM","MEDIA_SCREEN","MEDIA_STICKER","DISTRIBUTOR","OPENING_APP"]`（7 值） | 同| ✅ **7 值同序** |
| `activity_status` | `["ACTIVE","LOW","STILL","AWAY","UNKNOWN"]`（5 值） | 同 | ✅ **5 值同序** |
| `user_coupon_status` | `["UNUSED","USED","EXPIRED"]`（3 值） | 同 | ✅ **3 值同序** |

schema 侧证据：`activity_touch_channel` 定义在 `schema.prisma`（`@@index([touch_channel, touchpoint_at])` 对应 `DATABASE.md:769` 变更记录「七值」），shared 侧 `enums.ts:708-718`。

#### ③-4 `TS_ONLY_ALLOWLIST` 六项例外理由均已写清 ✅

`apps/server/src/modules/activity/enum-mirror.test.ts:29-38` 原文：

```ts
const TS_ONLY_ALLOWLIST: Record<string, string> = {
  activity_bonus_reason: '落 orders.dispatch_reason_code（VarChar(32) 字符串列），schema 侧刻意不用 enum，避免 ALTER TYPE 锁表',
  COUPON_STATUS: 'coupons.status 为 String 列（避免 ALTER 锁表），常量即其唯一口径来源',
  QUEUE_NAMES: 'BullMQ 队列名常量（Redis 侧约定，非落库枚举）',
  BIZ_NO_PREFIX: '业务单号前缀（genBizNo 用，落orders.biz_no 等字符串列）',
  SPLIT_MODE: '分账模式标识（落 profit_sharing_records.split_mode 字符串列）',
  ACTIVITY_COPY_SCENE: '推荐话术场景码（A6 话术库选句键，落activity_touchpoints 之外的内存映射）',
};
```

六项在 shared 中**均真实存在**（逐一 grep 确认）：`activity_bonus_reason`+`COUPON_STATUS` → `coupon-status.ts` / `enums.ts`；`QUEUE_NAMES`/`BIZ_NO_PREFIX`/`SPLIT_MODE` → `constants.ts`；`ACTIVITY_COPY_SCENE` → `activity-copy.ts`。理由均写明「为什么 shared 有而 schema 无」，✅。

`COUPON_STATUS` 另有独立文件详述（`packages/shared/src/coupon-status.ts:3-20`），明确「与 `user_coupon_status` 勿混淆」「单独成文件以免污染 enum 镜像关系」——理由链完整。

---

### ④ RBAC 三处双写面 —— ✅ 一致

#### ④-1 角色权限集三处逐值全等

`apps/server/prisma/seed.ts:79-110`（`ROLES`）vs `apps/server/src/middlewares/auth.ts:147-182`（`ROLE_PERMISSIONS`）：

```
seed roles: admin,ops,finance,cs
auth roles: admin,ops,finance,cs
[admin]   seed(1)  vs auth(1)  : MATCH
[ops]     seed(11) vs auth(11) : MATCH
[finance] seed(8)  vs auth(8)  : MATCH
[cs]      seed(7)  vs auth(7)  : MATCH
```

第三处 `apps/admin-web/src/shared/permissions.ts:114-133`（`ROLE_DEFAULT_PERMISSIONS`）：

- `ops`（`:118-122`）11 项，与前两处逐值同（同序：`order:*`…`marketing:*`/`marketing:read`）。
- `finance`（`:123-128`）8 项，同。
- `cs`（`:129-132`）7 项，同。
- `admin` 为 `['*', ...ALL_PERMISSION_KEYS]`（`:115`）—— 前端按钮级渲染需要展开全量键，**语义等价**（`*` 仍含首元素），单测 `:180-200` 对 admin 单独处理并断言 `body).toContain('admin:')`。

**角色数 = 4** ✅（admin/ops/finance/cs）。

#### ④-2 三条关键裁定

| 裁定 | 核验| 证据 |
|---|---|---|
| `revenue:read` **只给 admin+finance** | ✅ | `auth.ts:170`（finance 有）、`:180` 注释「刻意不给 revenue:read」（cs 无）、ops 无。单测 `:141-149` 断言 admin/finance=true、ops/cs=false。**admin 经 `*` 通配通过**（实测 `permGranted(['*'],'revenue:read')=true`） |
| `marketing:*` 与 `marketing:read` **都在** | ✅ | `seed.ts:58-59` 两权限点均登记；`auth.ts:159-160`（ops）、`:169`（finance）、`:179`（cs）均有 `marketing:read`；`ops` 另有 `marketing:*`。单测 `:165-169` |
| 三处无重复项 | ✅ | 单测 `:171-176`断言 `new Set(perms).size === perms.length` |

#### ④-3 `permGranted` 三档匹配逻辑 ✅

`apps/server/src/middlewares/auth.ts:181-187` 原文：

```ts
export function permGranted(rolePerms: readonly string[], need: string): boolean {
  if (rolePerms.includes('*')) return true;
  if (rolePerms.includes(need)) return true;
  // 模块级通配：`risk:*` 覆盖 `risk:read` / `risk:*` / `risk:alert:handle`
  const mod = need.split(':')[0] ?? '';
  return mod.length > 0 && rolePerms.includes(`${mod}:*`);
}
```

三档齐备且**取模块段（第 0 段）而非子动作段**，注释 `:100-104` 明确修正原因（原精确匹配导致 admin `['*']` 全被拒、持有 `risk:*` 者访问 `risk:read` 被拒）。

#### ④-4 三条边界测试覆盖 ✅

`apps/server/src/middlewares/admin-perm-guard.test.ts` 实跑 **18 passed**。三条边界逐条对应：

| 要求边界 | 测试位置 | 断言 |
|---|---|---|
| admin 的 `*` 能过 `risk:read` | `:71-76` | `forneed of ['risk:read','order:refund','revenue:read','complaint:handle','marketing:*']` 全 true |
| `risk:*` 能过 `risk:read` | `:78-82` | `expect(ops).toContain('risk:*')` + `permGranted(ops,'risk:read')===true` |
| `order:read` 不能过 `risk:read` | `:90-94` | `permGranted(['order:read'],'risk:read')===false` 且反向亦 false |

额外亮点：`:104-121` 有**元测试**（meta-test）—— 用「坏实现 `split(':')[1]`」喂进矩阵，断言必须暴露 ≥3 处差异且含三段式 case，并断言矩阵非空。**这证明该测试组不是恒真**，是本项目测试纪律中最扎实的一处。

#### ④-5 附带发现（非不一致，但值得记账）🟢

`PERMISSIONS`（`seed.ts:38-68`，20 个权限点）与 admin-web `PERMISSION_GROUPS`（`permissions.ts:13-99`，14 个）**权限点全集**存在差集：

```
ONLY IN SEED (missing in admin-web): order:read, verification:*, review:*, commission:*, support:*, user:read
ONLY IN WEB  (missing in seed): none
```

即**前端按钮级权限表少登记 6 个权限点**。这不影响 `ROLE_DEFAULT_PERMISSIONS` 三处一致性（④-1 已验），但意味着 admin-web 无法对这 6 个权限点做按钮级渲染管控。属可延后项。

---

### ⑤ A7 社区字段闭环 —— ✅ 一致

#### ⑤-1 `communities` 表：10 列，双 `@unique` ✅

`apps/server/prisma/schema.prisma:534-552` 原文关键行：

```prisma
534: model communities {
535:   id             BigInt    @id @default(autoincrement())
536:   community_code String    @unique @db.VarChar(32) // 社区编码（运营唯一标识，如 GZ_TH_HUAYING）
537:   community_name String    @unique @db.VarChar(128) // 社区名称（展示用，权威唯一来源）
538:   city           String?   @db.VarChar(32)
539:   address        String?   @db.VarChar(256)
540:   lng            Decimal?  @db.Decimal(10, 6)
541:   lat            Decimal?  @db.Decimal(10, 6)
542:   distributor_id BigInt?
543:   created_at     DateTime  @default(now()) @db.DateTime(3)
544:   updated_at     DateTime  @updatedAt @db.DateTime(3)
546:   distributor   distributors?         @relation(...)
547:   elders        elder_profiles[]
548:   touchpoints   activity_touchpoints[]
549:   verifications verifications[]
551:   @@index([distributor_id])
```

计**10 列**（id/code/name/city/address/lng/lat/distributor_id/created_at/updated_at）✅；`:536` `:537` **均 `@unique`** ✅（主理人裁定 name 必须唯一，理由见 `DATABASE.md:770`「别学 `distributors.community_name` 那种无约束 VarChar」）。

#### ⑤-2 三处 `community_id` 外键+ 索引 ✅

| 表 | 列 | 外键 | 索引 | 证据 |
|---|---|---|---|---|
| `elder_profiles` | `BigInt?`（`:569`） | `:575` `@relation(fields:[community_id],references:[id])` | `:577` `@@index([community_id])` | ✅ 可空+FK+索引 |
| `verifications` | `BigInt?`（`:1098`） | `:1126` | `:1131` `@@index([community_id, created_at])` | ✅ |
| `activity_touchpoints` | `BigInt?`（`:2172`） | `:2195` | `:2201` `@@index([community_id, touchpoint_at])` | ✅ |

#### ⑤-3 `distributors` 反向关系 ✅

`schema.prisma:1531`：`communities communities[] // 该团长所管的社区（反向关系：community.distributor_id 指向本表）`✅

#### ⑤-4 三条关键裁定全部落地 ✅

| 裁定 | 实测 | 判定 |
|---|---|---|
| `orders` **不得有** `community_id` | `awk '/^model orders \{/,/^\}/' \| grep community` → **空** | ✅ 订单快照未被污染 |
| `distributors` **不得有** `community_id` 列 | 仅 `community_name String @db.VarChar(128)`（`:1520`）+反向关系，**无 `community_id`** | ✅ 单向外键 |
| `coupons.status` 仍是 `String` 非 enum | `schema.prisma` coupons 模型：`status String @default("DRAFT") @db.VarChar(16) // DRAFT/ACTIVE/PAUSED/ENDED` | ✅刻意不改，避免 ALTER 锁表 |

> 注：`distributors.community_name`（无 `@unique`）与 `communities.community_name`（有 `@unique`）并存，是 `DATABASE.md:1145` 明确点出的「反面教训」，两处口径不一致是已知取舍（`community_name` 权威源在 `communities`），非缺陷。

#### ⑤-5 `admin.service.ts` 的 `community: null` —— ✅ **已改真读取**

`apps/server/src/modules/activity/admin.service.ts:138` 原文：

```ts
community: latest.elder_user.elder_profile?.community?.community_name ?? null,
```

配合 `:105` 的真实 JOIN：

```ts
elder_profile: { select: { community: { select: { community_name: true } } } },
```

`:102-104` 注释明确「为 null 是正常业务态……服务端不兜假值」。**已从硬编码 null 改为真读取，且保留 `?? null` 语义** ✅ —— 这正是 `DATABASE.md:1023` 遗留项要求的结果。

#### ⑤-6 `value_snapshot` 裁定（复核期间活跃变更，见 ⑧）

`user_coupons.value_snapshot Int?` 已落 schema（`schema.prisma:1491`）+ 已落迁移 `20261022100000_user_coupons_value_snapshot`。

`DATABASE.md:774`（变更记录 #15）记载：主理人**已放行**该列（「纪律不是护栏，字段才是」），但声明「**migration 刻意未落**，等 A 组做完一起走增量」；`API-CONTRACT.md:413-422` 同步声明「本轮只改 schema 与契约，不落 migration」。

⇒ **迁移实际已落盘，与两份文档声明矛盾**；且核销「快照优先 / null 回退读模板」双分支代码**尚未实现**（grep `apps/server/src/` 零命中）。→ 见 🔴-1。

> 说明：本项在复核过程中状态变化两次（先「文档标未批准」→ 后「文档标已放行但称不落 migration」，而磁盘已落迁移）。此处按 **04:47 最终磁盘状态**记录。

---

### ⑥ 社区编码 `GZ_TH_HUAYING` 全库一致 —— ✅ 一致

**已知问题已修正**：全库 grep 无 `GZ_TIANHE_HUAYING`（四字母），当前磁盘统一为 `GZ_TH_HUAYING`（两字母）。`DATABASE.md:1145` 已是 `GZ_TH_HUAYING`。

#### 七条权威对照表（三处逐字一致）

| # | `community_code` | `community_name` | DATABASE.md | admin-web `channelKey` | seed.ts |
|---|---|---|---|---|---|
| 1 | `GZ_TH_HUAYING` | 天河区华颖社区 | `:1147` ✅ | `db-activity.ts:341` ✅ | `seed.ts:246` ✅ |
| 2 | `GZ_YX_BEIJINGJIE` | 越秀区北京街 | `:1147` ✅ | `:342` ✅ | `:247` ✅ |
| 3 | `GZ_HZ_CHIGANGJIE` | 海珠区赤岗街 | `:1147` ✅ | `:343` ✅ | `:248` ✅ |
| 4 | `GZ_LW_JINHUAJIE` | 荔湾区金花街 | `:1147` ✅ | `:344` ✅ | `:249` ✅ |
| 5 | `GZ_BY_SANYUANLI` | 白云区三元里 | `:1147` ✅ | `:345` ✅ | `:250` ✅ |
| 6 | `GZ_TH_SHIPAIJIE` | 天河区石牌街 | `:1147` ✅ | `:346` ✅ | `:251` ✅ |
| 7 | `GZ_PY_SHIQIAOJIE` | 番禺区市桥街 | `:1147` ✅ | `:347` ✅ | `:252` ✅ |

- **权威表位置**：`DATABASE.md:1147`（§13.6「落地约束」项下）列出七条种子建议值 + 行政区对应 ✅（任务要求的「§13.6 七条值权威表」已存在）。
- **admin-web**：`apps/admin-web/src/api/mock/db-activity.ts:340-348` `funnelChannels` 七条 `channelKey` 逐字一致 ✅。`:330-338` 注释说明「按下标派生的错位风险」，`:333` 亦引用 `GZ_TH_HUAYING`。
- **seed.ts**：任务提示「可能还没落，是已知待办」——**实测已落**。`seed.ts:246-252` 七条齐备，`:258-267` 按 `community_code` upsert（`where:{community_code: c.code}`），幂等 ✅。`:279` `:290` 已接入主流程并回显计数。
- 编码规则见 `DATABASE.md:1029`：`{城市拼音首字母}_{行政区简称}_{社区拼音首字母}`；`GZ_TH_` 出现两次靠第 3 段区分，与 `:1147` 注释一致 ✅。
- `db-activity.ts:18-26` 的 `ACTIVITY_COMMUNITIES` 七条**全称**（不带 code）与 `communities.community_name` 口径一致 ✅（符合 `DATABASE.md:1151` 「全称写法保持不变，前端零改动」）。

---

### ⑦ 地址脱敏三档 —— ✅ 一致

实现位于 `apps/server/src/common/crypto.ts`（`packages/` 内无同名文件）。

#### ⑦-1 三档 API 齐备 ✅

| API | 位置 | 说明 |
|---|---|---|
| `maskAddress(cipher, 'community' \| 'full')` | `crypto.ts:190-201` | 分档入口 |
| `maskAddressToCommunity(address)` | `crypto.ts:222-240` | 纯函数小区级降级 |
| `addressVisibilityForOrder(status)` | **`apps/server/src/modules/order/order.service.ts:942-953`**（非 crypto.ts） | 按订单态解锁 |

> 任务描述把 `addressVisibilityForOrder` 放在 crypto.ts，实际在 `order.service.ts` —— 属位置描述偏差，**功能存在且正确**，不影响结论。

`crypto.ts:190-201`：

```ts
export function maskAddress(cipher: string | null | undefined, level: AddressVisibility): string {
  if (!cipher) return ADDRESS_UNAVAILABLE;
  const devPrefix = 'PLAIN_DEV:';
  const plain = cipher.startsWith(devPrefix) ? cipher.slice(devPrefix.length) : safeDecrypt(cipher);
  if (!plain) return ADDRESS_UNAVAILABLE;
  if (level === 'full') return plain;
  return maskAddressToCommunity(plain);
}
```

`order.service.ts:942-953` 按「到岗核销后 → full / 到岗前 → community」解锁，`AFTER_ARRIVE` 含 `ARRIVED/IN_SERVICE/PENDING_CONFIRM/COMPLETED/SUSPENDED/CLOSED`；`:969-973` `getOrderDetail` 先剥 `address_cipher` 再挂脱敏 `address`（**密文列不出参**）✅。

#### ⑦-2 三件事逐条核验 ✅

**（a）解密失败返回固定兜底文案，不返回密文或异常栈** ✅
- 兜底常量：`crypto.ts:183` `export const ADDRESS_UNAVAILABLE = '地址已加密，请联系客服';`（**不区分具体原因，避免探测**）。
- `safeDecrypt`（`:204-210`）`catch { return null }` —— **吞掉异常不外抛**，绝不回吐密文或栈。
- `:177-178` 注释明示理由：「密文本身也是信息（长度会泄漏原文长度），异常栈则是信息泄露的直接入口」。

**（b）`PLAIN_DEV:` 前缀有显式处理** ✅
`crypto.ts:194-197` 显式 `startsWith(devPrefix)` 判定后切片；`:192-193` 注释说明「否则 decrypt() 会抛，整条地址对开发环境全变兜底文案」。

**（c）单测覆盖三类** ✅（`crypto.address.test.ts` 实跑 **13 passed**）

| 要求覆盖 | 测试用例 | 行号 |
|---|---|---|
| 解密失败兜底 | `解密失败返回固定兜底文案，绝不吐密文` / `密文本身不得出现在出参（长度会泄漏原文长度…）` / `null/undefined/空串 一律兜底文案` / `失败文案不含异常信息` | `:76,83,90,103` |
| 门牌号不外泄 | `保留小区名，剥掉门牌与房号` / `短地址「路+门牌」也能正确截断` / `多种门牌后缀都能识别` / **`任何输出都不得含数字门牌（防则漏网）`** | `:21,31,35,61` |
| 小区名保留 | `「小区/大院/花园/新村」后缀优先保留` / `「X 号院」是小区名不是门牌，须保留` / `无门牌特征时退化到街道/路` | `:52,26,48` |

正则设计稳健（`:226`保留 `号院/小区/大院/花园/新村/公寓/家园/苑`；`:231` 门牌前缀允许**字母或数字**以覆盖 `A-3栋`；`:237` 明确**排除 `区`** 以免把「广州市天河区天河北路」截成「广州市天河区」）——三处都有注释说明踩过的坑，工程质量高。

#### ⑦-3 `outbound-cipher-guard` 挂载在业务路由之前 ✅

`apps/server/src/app.ts`：

```
:77   app.use(outboundCipherGuard);
:102app.use('/api/v1', apiRouter);
```

**77 < 102** —— 出参脱敏守卫在业务路由**之前**挂载 ✅。（`:16` import，`:105-106` `notFoundHandler`/`errorHandler`）。守卫单测实跑 **24 passed**。

---

### ⑧ 迁移链完整 —— ⚠️ 不一致

#### ⑧-1 目录结构✅（但现为 3 个迁移）

```
apps/server/prisma/migrations/
├── 20261022000000_baseline_init/
├── 20261022040000_a7_communities/
├── 20261022100000_user_coupons_value_snapshot/   ← 复核期间新增（04:39）
└── migration_lock.toml
```

`migration_lock.toml` 内容 `provider = "mysql"` ✅。

#### ⑧-2 漂移校验 EXIT=0，且**经证伪测试证明非恒真** ✅

`node scripts/check-migration-drift.mjs` 实跑：

```
迁移文件：3 个 → 20261022000000_baseline_init, 20261022040000_a7_communities, 20261022100000_user_coupons_value_snapshot
结构规模：迁移链 54 表 / 当前 schema 54 表
[PASS] 迁移链末态 === 当前 schema（无漂移）
```

**我没有只看这个 PASS 就下结论**，而是在 `/tmp` 副本上注入一列`drift_probe_col`（未触碰项目文件）做反向证伪：

```
[FAIL] 发现 1 处漂移：
  - 表 communities 列缺失：drift_probe_col varchar(8)
EXIT=1
```

✅ **脚本能真实检出漂移，非恒真命题**。脚本实现（`check-migration-drift.mjs:236-244`）逐目录解析 SQL 合成末态，`:260-269` 调 `prisma migrate diff --from-empty` 得当前结构，`:284-320` 做表/列/索引/外键/NOT NULL 五维比对 —— 逻辑严谨。

#### ⑧-3 ⚠️ baseline 的 `CREATE TABLE` 是 **53**，不是 54

```
baseline CREATE TABLE count: 53
baseline ADD CONSTRAINT count: 89
baseline 内联 INDEX 条目: 159（含 UNIQUE INDEX）
```

任务口径为「baseline 的 CREATE TABLE 数量应等于当前 schema 的 model 数（54）」。实测 **53**。

**哪边对**：**53 是正确的**。`communities` 表由**第二个迁移** `20261022040000_a7_communities` 创建（`ALTER TABLE... ADD COLUMN` 三处 + `CREATE TABLE communities`），不在 baseline 内。故 53（baseline）+ 1（a7）= 54，**迁移链末态与 schema 一致**，`DATABASE.md:770` 变更记录也明写「表数 **53→54**」、`:1154` 写「54 表 / 66 枚举」—— **文档是对的，任务口径的表述有误**。此项不计为缺陷。

#### ⑧-4 ✅ `prisma:migrate:diff` 已不再自比

`apps/server/package.json:22` → `"prisma:migrate:diff": "node scripts/prisma-migrate-diff.mjs"`。脚本实现 `scripts/prisma-migrate-diff.mjs:60-70` 用官方通道：

```js
PRISMA_CLI, 'migrate', 'diff',
'--from-migrations', MIGRATIONS_DIR,   // ← 迁移历史
'--to-schema-datamodel', SCHEMA_PATH,  // ← 当前 schema
'--shadow-database-url', shadowUrl,
'--exit-code',
```

**同文件自比已彻底消除** ✅。且缺 `SHADOW_DATABASE_URL` 时 `:47-54` **明确 exit 2 报错**而非静默通过（`:17-18` 注释「绝不能因为参数没传上就『看起来通过了』——那是把恒真命题换了个马甲」）。这份脚本的失败语义设计是本次复核中看到的最严谨防恒真实践。

#### ⑧-5 ⚠️ 复核期间的活跃变更 + 文档与磁盘相互矛盾

**这是本项的实质问题**，见 🔴-1。

时间线（文件 mtime 实测，均落在复核窗口 04:32–04:47 内）：

| 时间 | 事件 |
|---|---|
| 04:37 | `schema.prisma` 加入 `user_coupons.value_snapshot Int?` |
| 04:39 | **迁移 `20261022100000_user_coupons_value_snapshot` 目录落盘** |
| 04:44 | `funnel-attribution.test.ts` 正则改为 `toContain`（修复了我早期观察到的失败） |
| 04:45 | `API-CONTRACT.md` 把 `value_snapshot` 从「未批准/暂不实现」改为「已放行」，但加注「**本轮只改 schema 与契约，不落 migration**」 |
| 04:46 | `DATABASE.md:774` 新增变更记录 #15，同样声明「**migration 刻意未落**」 |

⇒ **最终状态**：migration 已落盘，而两份文档（04:45/ 04:46）均声明不落。**矛盾客观存在**，且现有两道漂移门禁都查不出（它们只比对「迁移链 vs schema」，不看「文档承诺 vs 磁盘」）。

**附带说明**：我在早期快照（04:36）读到的 `API-CONTRACT.md:412-414` 确为「⚠ 待放行的 schema 改动（主理人未批准，暂不实现）」，随后被改写为「✅ 已放行」。**原判定「文档滞后」已被后续修正动作消解，但新矛盾随之产生**——故 🔴-1 已按最终磁盘状态重写，不再主张「文档未批准」。

---

### ⑨ 契约端点 vs 实现覆盖 —— ⚠️ 不一致

#### ⑨-1 §5.7 登记数：实为 **48**，非 45

机械解析 `docs/API-CONTRACT.md:285-452`（`### 5.7` 至 `## 6.` 之间）的端点表行，**得 48 条**，而标题 `API-CONTRACT.md:285` 自称「共 45 项」。

拆解：`:293-452` 各小节实测 `5.7.1`(2) + `5.7.2`(2) + `5.7.3`(6) + `5.7.4`(9) + `5.7.5`(6) + `5.7.6`(12) + `5.7.6.1`(3) + `5.7.7`(7) + `5.7.8`(1) = **48**。

**哪边错**：**标题的 45 是旧的**。`§5.7.6.1`（券模板写操作补登记，`:391` 起，3 项）与 `§5.7.8`（后台认证补登记，`:452`，1 项）都是后续补登记的，45+3+1 = 49 ≠ 48；实际是 §5.7.6 原始 11 项 + `5.7.8` 1 项计入原始 45（45+3=48）。**总之标题数与表内实际行数不符，应改为 48。**

#### ⑨-2 实现覆盖：9/48

服务端注册路由共 134 处（`routes/index.ts` 挂载 24 个 router + `modules/index.ts` 导出 18 个路由文件）。按「挂载前缀 + 方法 + 归一化路径变量」精确比对：

```
IMPLEMENTED: 9 / 48
NOT IMPLEMENTED: 39
```

已实现 9 项：

| 端点 | 实现位置 |
|---|---|
| `GET /admin/coupons` | `modules/marketing/marketing-admin.routes.ts:53` |
| `POST /admin/coupons` | `:70` |
| `PUT /admin/coupons/:id` | `:109` |
| `POST /admin/coupons/:id/publish` | `:143` |
| `POST /admin/coupons/:id/pause` | `:154` |
| `POST /admin/coupons/:id/resume` | `:165` |
| `POST /admin/coupons/:id/end` | `:176` |
| `GET /admin/configs/changelog` | `modules/admin/admin.routes.ts:106` |
| `POST /auth/admin-login` | `modules/auth/auth.routes.ts:317` |

即 **§5.7.6 营销券模板域 7/7 全落**（含 `.6.1` 三个写操作）+ changelog + admin-login。

#### ⑨-3 重点 5 端点逐个核验

| # | 契约端点 | 契约位置 | 实现 | 判定 |
|---|---|---|---|---|
| 1 | `GET /admin/risk/events` | `§5.7` 未列；`§5.4` 登记为 **`GET /admin/events`**（`:263`） | ✅ `risk.routes.ts:275` `riskAdminRouter.get('/events')` | ⚠️ **已落，但契约 `§5.7` 的 `/admin/risk/events` 路径与实现/§5.4 的 `/admin/events` 不一致** |
| 2 | `POST /admin/risk/events/:eventNo/handle` | 同上（`§5.4:264` 为 `/admin/events/:eventNo/handle`） | ✅ `risk.routes.ts:317` `riskAdminRouter.post('/events/:eventNo/handle')` | ⚠️同上 |
| 3 | `POST /admin/risk/reports/:reportNo/handle` | `§5.4:265` 登记为 `/admin/reports/:reportNo/handle` | ✅ `risk.routes.ts:337` | ✅ **路径一致，已落** |
| 4 | `GET /admin/activity/funnel` | `§13.6:667` 登记 | ✅ `activity.routes.ts:367` `activityAdminRouter.get('/activity/funnel')` | ✅ **已落**（且权限 `risk:read` 与契约一致；`:369-371` 引流漏斗实现完整，含 `byCommunity` 三维归因） |
| 5 | `GET /admin/activity/revenue` | `§13.6:668` 登记 | ❌ **未落** | ❌ |

**结论修正说明**：我的初次机械比对按 `§5.7` 清单查 `/admin/risk/events` 报「未实现」，但复查 `§5.4` 发现**契约自身两处路径登记不一致**（`§5.7` 若按 `/admin/risk/*` 列，则 `§5.4:263-264` 的 `/admin/events` 才是异类；实现侧统一为 `/admin/events`）。**端点 1、2 功能已落**，问题在**契约内部路径口径分叉**，而非未实现。端点 5 `revenue` 是真缺失——`activity.routes.ts:21` 注释明示：

```
//   GET  /admin/activity/revenue（需 revenue:read 权限点进三处双写面，W-MVP 暂缓）
```

（`revenue:read` 权限点已在三处双写面就位——`seed.ts:64`、`auth.ts:170`、`permissions.ts:67`✅，**只差端点实现**，属已知分阶段推迟。）

#### ⑨-4 `§5.7.6.1`（苏映棠券模板写操作）：✅ 存在且格式完整

`docs/API-CONTRACT.md:391-436`，**格式完整、远超「存在」标准**，含：前言与背景（`:392-400`）、`POST /admin/coupons` 状态语义修订（`DRAFT` 而非 `ACTIVE`）、端点表 3 行（`:401-405`）、入参 JSON 示例（`:407-419`，含 `value` 单位/`minSpendFen` 字符串化分等）、幂等与错误码表 7 行（`:423-431`）、硬约束说明（`:433-440`）、待放行 schema 变更提示（`:442-447`）、`value` 单位随type 变表（`:449-453`）、`/end` 不可逆语义与二次确认（`:455-460`）、审计建议（`:462-463`）。**且 3 个端点均已实现**（见 ⑨-2）。

---

## 2. 不一致清单（按严重程度排序）

### 🔴 上线阻塞

#### 🔴-1 `user_coupons.value_snapshot`：文档说「本轮不落 migration」，但 migration 已存在 —— 文档与磁盘直接矛盾

> ⚠️ **本条在复核窗口内经历了两次状态变化**，此处记录最终核实状态（04:47 复核）。

**磁盘事实**
- 已落 schema：`apps/server/prisma/schema.prisma:1491` `value_snapshot Int?`（带 5 行设计注释，说明资金护栏语义与 null 回退期）
- **migration 已存在**：`apps/server/prisma/migrations/20261022100000_user_coupons_value_snapshot/migration.sql`（mtime **04:39**）
  ```sql
  -- AlterTable
  ALTER TABLE `user_coupons` ADD COLUMN `value_snapshot` INTEGER NULL;
  ```
- 无代码消费：`grep -rn "value_snapshot" apps/server/src/ packages/shared/src/` **零命中**（仅 `apps/admin-web/src/api/mock/server.ts:863` 一句注释）。**发放时无人写、核销时无人读。**
- 漂移校验仍 PASS（迁移链 54 表 ≡ schema 54 表）—— 因为 migration 与 schema 是一致落盘的，**门禁抓不到「文档说不落却落了」这种不一致**。

**文档侧的矛盾（关键）**
- `docs/API-CONTRACT.md:413-422`（04:45 更新）已把「未批准」改为**已放行**，但明确写：
  > `> ✅ schema 改动已放行（主理人 2026-10）…（schema:1486）`
  > `> **本轮只改 schema 与契约，不落 migration** ——实际 DDL 等霍承钧 A 组做完一起走增量，避免又撞迁移时间窗。`
- `docs/DATABASE.md:774`（04:46 更新）同样写：
  > `**migration 刻意未落**：实际 DDL 等霍承钧 A 组做完一起走增量（避免又撞迁移时间窗）`

**⇒ 矛盾点**：两份文档均声明「刻意不落 migration」，而 `20261022100000_user_coupons_value_snapshot` **实际已落盘**（04:39）。二者必有一错：或迁移不该落（须删），或文档该更新（迁移已提前落）。

**风险**
1. **治理风险**：`DATABASE.md:774` 把「只改 schema 不落 migration」定为**纪律**（理由是避免撞迁移时间窗）。现在纪律被自己违反而无任何门禁报警——`check-migration-drift.mjs` 只比对「迁移链 vs schema」，**看不见「文档承诺 vs 磁盘实际」**。
2. **代码空转**：`schema.prisma:1489` 注释称「null = 历史数据未快照，核销时回退读模板」，`API-CONTRACT.md:418-419` 要求「核销逻辑**必须**走『快照优先、`value_snapshot IS NULL` 时回退读模板』双分支，回退分支需打日志」——**该双分支代码不存在**。当前 `10001` 拒绝改面额的纪律仍在生效（这本身是安全的兜底），但**字段已建、逻辑未接**，处于中间态。
3. 若生产库执行 `migrate deploy`，该列会以**全 null** 落库，且无任何写入方——即「加了字段但没启用」，与文档承诺的「落库后『改面额只影响新领取』即可支持」有差距。

**哪边错**：**文档与磁盘必有一方错**；从 `DATABASE.md:774` 「等霍承钧 A 组做完一起走增量」的表述看，**migration 提前落盘更可能是偏离**。需承钧确认。

**怎么改**
1. **先定性**（承钧/主理人二选一）：
   - 若迁移**不应此时落** → 删 `prisma/migrations/20261022100000_user_coupons_value_snapshot/`，重跑 `npm run prisma:migrate:check` 应仍 PASS（schema 的可空列未在迁移链中会报「列缺失」，**故此路需同步回退 schema**，或改为保留列并补迁移）。
   - 若迁移**已提前落** → 更新 `API-CONTRACT.md:417` 与 `DATABASE.md:774`，删去「不落 migration / 刻意未落」表述，并补「核销双分支逻辑尚未实现」的显式 TODO 与里程碑。
2. 代码侧二选一，**不得留「有列无逻辑」中间态过上线**：要么本轮补「发放写快照 + 核销读快照（null 回退模板 + 回退分支打日志）」，要么在两份契约里把 `value_snapshot` 标注为「已建列未启用」，并明确启用里程碑。
3. 落库时需**回填存量快照**（`DATABASE.md:774` 已列此要求）。

---

### 🟡 上线前修

####🟡-1 `ARCHITECTURE.md` 附录 C 缺 3 个配置键 + 把 `split_mode` 写成 `SPLIT_MODE`

**证据**（详见 ①-3）
- `:1248` `| \`SPLIT_MODE\` | wechat_profit_sharing |` —— 应为 `split_mode`（**配置键**，非常量名）
- 缺 `credit_limit_threshold`（60/INT）
- 缺 `credit_freeze_threshold`（40/INT）
- 缺 `cancel_penalty_rate_bp`（1000/INT）

**哪边错**：**`ARCHITECTURE.md` 错**（shared 与 DATABASE.md §8 两处一致且正确）。

**风险**：`cancel_penalty_rate_bp` 是**财务审计口径**（改动须留 `audit_logs`）。附录 C 是「关键配置项」清单，缺它 = 架构文档不承认这个配置项存在；`SPLIT_MODE` 键名错会让运营在后台按文档找不到 `split_mode`。

**怎么改**：编辑 `docs/ARCHITECTURE.md` 附录 C 表格（`:1238-1263`）
- `:1248` 键名 `SPLIT_MODE` → `split_mode`
- 在 `report_reward`（`:1247`）后补两行 `credit_limit_threshold | 60`、`credit_freeze_threshold | 40`
- 在 `split_mode` 行后补一行 `cancel_penalty_rate_bp | 1000 | 接单后取消的违约金比例（基点，1000=10%），改动须留审计`
- 补完后**顺序须与 shared `constants.ts` 声明顺序一致**（shared 顺序：`… report_reward` → `credit_limit_threshold` → `credit_freeze_threshold` → `service_overtime_suspend_min` → `im_silence_suspend_min` → `night_confirm_timeout_min` → `split_mode` → `cancel_penalty_rate_bp` → activity…）。注意附录 C 当前把 `SPLIT_MODE` 排在 `report_reward` 后、`night_confirm_timeout_min` 前，**顺序与 shared 不符**，需一并对齐。

**顺带修门禁**：建议扩展 `apps/server/scripts/verify-doc-configs.ts` 覆盖第三处（解析 `ARCHITECTURE.md` 附录 C），否则该漂移会复发（脚本 `:24-25` 全文只读 `DATABASE.md`）。

#### 🟡-2 `API-CONTRACT.md §2` 速查表 11 处代表码语义错配 + `9002` 是不存在的码

**证据**：详见 ②-3表格（`:64-80`）。最危险的两处：`10010` 被标「触发限流」实为「依赖服务不可用」；`21001` 被标「缺少权限」实为「后台账号不存在」。

**哪边错**：**文档错**（`error-codes.ts` 为单一事实源，§2 自身标题即如此声明 `:60`）。

**怎么改**：按 ②-3 表格逐行订正 `docs/API-CONTRACT.md:64-80` 的「代表码」列。例如：
- `:65` → `10001` 参数不合法、`10006` 幂等冲突、`10005` 触发限流
- `:66` → `10002` 未登录、`10003` token 过期、`11005` 账号已注销（注意 `10002/10003` 在 **10xxx** 段，非 11xxx）
- `:68` → `13001` 陪聊员不存在、`13004` 四审流转非法
- `:71` → `16002` 动态码错误、`16005` 人脸分不足、`16010` 需双方确认
- `:72` → `17001` 会话不存在、`17007` 内容审核未通过
- `:75` → `10004` 缺少权限（**在 10xxx 段**）
- `:80` → `10009` 内部错误、`90004` 第三方超时（并**删除 `9002` 这个 4 位笔误码**）

#### 🟡-3 `API-CONTRACT.md` §5.7 标题「共 45 项」与表内实际 48 项不符

**证据**：标题 `:285`「共 45 项」；表内机械解析实测 48 行（`5.7.1`2+`5.7.2`2+`5.7.3`6+`5.7.4`9+`5.7.5`6+`5.7.6`12+`5.7.6.1`3+`5.7.7`7+`5.7.8`1=48）。

**哪边错**：**标题错**（表内容对）。

**怎么改**：`docs/API-CONTRACT.md:285` 「共 45 项」→「共 48 项」。

#### 🟡-4 契约内部风控端点路径口径分叉：`/admin/risk/events` vs `/admin/events`

**证据**：任务清单与 `§5.7` 语境用 `/admin/risk/events`；而 `§5.4:263-264` 登记为 `GET /admin/events` / `POST /admin/events/:eventNo/handle`；实现 `risk.routes.ts:275,317` 为 `/events`、`/events/:eventNo/handle`（挂载前缀 `/admin`）。三处两种写法。

**哪边错**：**文档 `§5.7` 语境错**（实现与 `§5.4` 一致，应以 `/admin/events` 为准）。

**风险**：前端若照 `/admin/risk/events` 拼 URL，**静默 404**（adminRouter 无该前缀路由）。

**怎么改**：以实现为准统一为 `/admin/events`、`/admin/events/:eventNo/handle`；核对 `§5.7` 内所有 `/admin/risk/*` 表述并订正（`§5.7` 清单本身未列这两个端点，故主要修正任务口径对应的文档段落与任何前端调用点）。

#### 🟡-5 `GET /admin/activity/revenue` 契约已登记但未实现

**证据**：契约 `§13.6:668` 完整登记（含权限 `revenue:read`、域函数 `—`、Q8 账务隔离说明）；实现侧 `activity.routes.ts:21` 注释「W-MVP 暂缓」，全文件无 `revenue` 路由。

**哪边错**：**不是错，是已知分阶段推迟**。但需在契约标注状态。

**怎么改**：`docs/API-CONTRACT.md:668` 行末补「**状态：契约已登记，端点未实现（W-MVP 暂缓；`revenue:read` 权限点已在三处双写面就位）**」，避免下任开发误以为已可用。

---

### 🟢 可延后

#### 🟢-1 错误码总数 155 与任务口径 153 不符（无文档背书）

`error-codes.ts:40-231` 实测 **155 码**；任务描述为 153。`grep "153\|155 "` 在 `docs/*.md` **零命中**——即**没有任何文档写「153」**，任务口径本身可能来自早期快照或口算。

**判定**：码表本身健康（16 段 / 零重复 / 段内连续，见 ②-1）。**155 是准确的**，无须改动。建议后续在 `§2` 或 `error-codes.ts` 顶部注释补一句「共 155 码 / 16 段」作为可核验基线（当前 `error-codes.ts:23-24` 只有分段纪律说明，无总数）。

#### 🟢-2 admin-web `PERMISSION_GROUPS` 少登记 6 个权限点

详见 ④-5：`seed.ts` 20 点vs admin-web 14 点，差 `order:read`、`verification:*`、`review:*`、`commission:*`、`support:*`、`user:read`。

**影响**：不影响 `ROLE_DEFAULT_PERMISSIONS` 三处一致性（④-1 已验✅），但前端无法对这 6 点做按钮级渲染。

**怎么改**：`apps/admin-web/src/shared/permissions.ts:13-99` 补 6 个 `PermDef` 分组；或显式注释「此 6 点仅后端使用，无按钮级管控需求」以免下任误判为漏配。

#### 🟢-3 `admin.service.ts` 的 `community` 出参结构待主理人裁定

`DATABASE.md:1025` 已记录：当前 `community: string | null`，若将来需按 `lng/lat` 聚合或按 `distributor_id` 反查，建议改`{ id, code, name }` 或 `{ code, name }`。**这是 API 契约变更，须主理人拍板**，实现侧按`string | null` 不返工是正确的克制。**保持现状，仅记账。**

---

## 3. 给 Tom 的上线前必查项（需人工 / 外部环境确认）

以下事项**代码与文档复核无法覆盖**，必须由人工在真实环境确认：

### A. 生产 MySQL 迁移重跑（最高优先级）

1. **必须在生产目标库实跑三条**（`DATABASE.md:773` §13.5 第③条纪律明确「开发机跑通 ≠ 生产跑通」）：
   ```bash
   npx prisma migrate deploy        # 迁移链落库（现为 3 个迁移）
   npx prisma migrate status        # 确认全部 applied
   npx prisma migrate diff --from-url <生产DATABASE_URL> --to-schema-datamodel prisma/schema.prisma --exit-code
   ```
   第三条应输出 `No difference detected`。
2. **关注点**：`sql_mode` / `innodb_default_row_format` / 字符集（迁移用 `utf8mb4_unicode_ci`）/ 时区（`DATETIME(3)` 语义）均可能影响 DDL 与时间列。
3. **基线事实**：本项目 **53+ 个 model 从未在任何真实 MySQL 上落过库**（`DATABASE.md:771` 记录：无 `.env`、无 MySQL 服务、无 Docker、无 CI、**连 git 仓库都没有**）。若生产已建库，那必然是 `db push` 或手写 SQL 推的——**两者都无迁移历史可回滚，必须按 baseline 重建**。
4. **本轮新增迁移需重点验**：`20261022100000_user_coupons_value_snapshot`（见 🔴-1）。**先定性**：两份文档均声明「刻意不落 migration」而它已落盘——部署前须确认是「删迁移」还是「改文档」，并确认核销双分支逻辑是否已实现。**不要让「有列无逻辑」的状态进生产**。

### B. 影子库漂移校验（本地跑不了，需 CI 或临时 MySQL）

`npm run prisma:migrate:diff` 需 `SHADOW_DATABASE_URL`（`prisma-migrate-diff.mjs:46-54`，缺则 exit 2）。请在 CI 或临时 MySQL 上跑一次官方通道，确认与离线脚本 `npm run prisma:migrate:check` **结论一致**（本次仅验证了离线脚本，且已证伪其非恒真）。

### C. 微信侧（进件/ 配置/ 回调）

5. **`split_mode` 兜底值必须切回主路径** —— 这是**代码与文档都拦不住的运行期风险**。`constants.ts:108-109` 明示 `manual_settlement_fallback=兜底人工结算（仅灰度联调，**上线前必须切回**）」。若 seed 落库时误取兜底值，**分账将不走服务商自动分账而进人工结算**。请在后台 `system_configs` 确认 `split_mode=wechat_profit_sharing`。
6. **微信支付进件**：商户号、APIv3 密钥、证书、`notify_url` 域名白名单、回调验签（错误码 `15004 WX_NOTIFY_INVALID`）。
7. **服务商分账 / 分账回退**：`15006 SHARING_GATE_BLOCKED`、`15010 WX_UNFREEZE_FAILED` 依赖真实微信侧能力，无法用 mock 验证。
8. **隐私号**（`17xxx`）：需确认类目资质与隐私号申请条件。
9. **订阅消息模板 ID**：通知下发依赖模板审核通过。

### D. 域名与备案

10. **域名备案**：`DATABASE.md`/契约多处要求生产 HTTPS 域名（回调 `notify_url`、后台访问）。**备案未过则微信回调不可用**，这是硬前置。
11. 小程序 `request` 合法域名白名单（三个端：用户端/ 陪聊员端 + 后台 API）。

### E. 环境变量（fail-fast 项，缺则启动即报错）

12. `CRYPTO_MASTER_KEY`（base64 32B，**支持逗号分隔多把做轮换**）、`CRYPTO_HMAC_KEY`（base64 32B）—— 未配置时 `crypto.ts:41-46` 直接抛 `AppError90005`，**杜绝「默认密钥」后门**（设计正确，需确认生产已配且**未使用开发期`PLAIN_DEV:` 回落**：`crypto.ts:192-197` 认得该前缀，生产库若出现`PLAIN_DEV:` 开头的 `address_cipher` 说明走了开发回落，须查因）。
13. 微信 `APPID/SECRET`、`JWT` 签名密钥、`REDIS_URL`、`DATABASE_URL`、`SHADOW_DATABASE_URL`（CI）。

### F. 数据与合规

14. **`activity_watch_enabled` 默认 `false`**（`constants.ts:123-127`，opt-in）。健康活动感知涉8 条隐私红线，上线须确认：授权流程完整、双通道交叉验证强制开启（`activity_cross_verify_required=true` 且**代码锁死不可关**）、原始特征留存 ≤14 天（`activity_signal_retention_days=14`，PRD 红线⑥硬上限）。
15. **`CRYPTO_MASTER_KEY` 轮换期确认**：解密按密文首字节版本号选密钥（`crypto.ts:104-117`），确认历史密钥仍在列表中，**否则旧数据永久不可解**（订单地址、手机号等L3/L4 数据）。
16. **`ADMIN_SEED_PASSWORD`**：`seed.ts:12` 注明「生产环境必须显式传」——确认超管密码非默认值。

### G. 需人工拍板的治理项

17. 🔴-1 的 `value_snapshot` 归属与状态（migration 已落 vs 文档称不落；核销双分支是否已实现）—— **建议本次上线前明确收口，不要留中间态**。
18. 🟢-3 `community` 出参结构是否改`{ code, name }`（`DATABASE.md:1025` 已候审）——不阻塞上线，但 W+1 前需定。

---

## 4. 复核方法学附记

**关于「脚本绿 ≠ 文档对」**：本次三项中，①③⑤⑥ 的既有脚本/测试**全部 PASS**，但仍发现 4 处不一致。原因是脚本覆盖面窄于声称的一致性范围：

| 脚本 | 声称校验 | 实际覆盖面 | 漏检 |
|---|---|---|---|
| `verify-doc-configs.ts` | 「三处一致性」（注释 `:2-4`） | **仅 2 处**（`DATABASE.md §8` ↔ shared），全文无 `ARCHITECTURE.md` | 附录 C 缺 3 键 + 键名错 |
| `enum-mirror.test.ts` |枚举零失配 | schema↔shared **全覆盖 + 白名单** |无（本项确实干净） |
| `check-migration-drift.mjs` | 迁移链无漂移 | 表/列/索引/外键/NOT NULL **五维** | 无（已证伪测试确认非恒真） |

**我做的反向证伪**（不只看PASS）：
- 对迁移漂移脚本：在 `/tmp` 副本注入 `drift_probe_col` → `EXIT=1` 且精确指出该列 → **证明门禁非恒真**。
- 对枚举镜像：不复用测试，独立写解析器（注意 schema 为 **CRLF**，`:26` 注释亦提及「schema 是 CRLF；先归一化」为已知坑）→ 66/66 全等。
- 对端点覆盖：**第一次机械比对得出「0/48 实现」是错的**——原因有二：路由注册形如 `adminRouter.get(...)` 而非 `router.get(...)`；且挂载前缀在 `routes/index.ts` 而非 `modules/index.ts`。修正后得 9/48。**记此一笔是为了说明：不验证工具本身就会得出完全错误的结论。**
- 全量单测：复核早期实跑 `npx vitest run` 曾出现 `funnel-attribution.test.ts` 1 例失败（正则要求 `count: number;` 而源码无分号），**04:44 该文件被改为 `toContain` 字面量比对，现 27 文件 523 例全绿**。
- 复核窗口内`API-CONTRACT.md`（04:45）与 `DATABASE.md`（04:46）被改写，`value_snapshot` 的文档状态从「未批准」变为「已放行但称不落 migration」。**我按最终磁盘状态出具结论**，并已在 🔴-1 记录「迁移已落 vs 文档称不落」这一新矛盾。**这也说明：本报告是04:47 的磁盘快照，若此后仍有变更，请以最新磁盘为准。**

**未做的事**：未修改任何源文件；未执行 git 操作（该目录非 git 仓库）；未放宽任何判定标准以迁就现状——附录 C 缺 3 键、`§2` 错 11 处、`§5.7` 数错、路径分叉，均按实际磁盘如实报告。

---

**报告完** ｜ 顾图南（Silas Frame）｜ rnd-linban ｜ 2026-10-22 ｜ 复核窗口 04:32–04:45（磁盘快照）