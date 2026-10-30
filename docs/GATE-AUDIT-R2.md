# 邻伴 · 第二轮「假绿缝隙」复核报告

> **类型**：门禁有效性审计（Gate Effectiveness Audit）
> **执行**：顾图南（Silas Frame）｜ 2026-10
> **目标**：不是「文档对不对」，而是「**哪些保证看起来存在、实际不生效**」
> **方法论约束**：**不采信任何自述**（含主理人、含开发者、含我自己上一轮的结论）。所有判定均以磁盘原文 + 实跑数据为准，命令与行号可复现。
> **产出性质**：只读审计，**未修改任何代码**。

---

## 📌 第五轮增补（2026-10-22）

本轮我做了三件事：① 定稿 P1 收集断言规格（12 节）② 改契约 4 项 ③ 核主理人信中每一条描述与磁盘的差异。

### 5R.1 🔴 本轮最重要的一条：**主理人信里的三条描述与磁盘不符，其中一条照办会造成反向破坏**

主理人信中写：

> 「前端 `activity.ts:49` 传 `status/community/staleOnly/keyword`」
> 「服务端 zod 是 `status/stale/days/page/pageSize`」
> 「承钧 = 服务端 zod 改 `stale`→`staleOnly`」

**我核了磁盘，前端已经改过来了**（mtime 06:52，晚于服务端 06:45）：

| 位置 | 实际参数名 | mtime |
|---|---|---|
| 前端 `apps/admin-web/src/api/activity.ts:59` | `status` / **`stale`** / `days` / `page` / `pageSize` | 06:52 |
| mock `apps/admin-web/src/api/mock/server.ts:1288` | `q(query, 'stale')` | 06:49 |
| 服务端 `activity.routes.ts:335-345` | `status` / **`stale`** / `days` / `page` / `pageSize` | 06:45 |

前端 `activity.ts:52` 注释原文：「本轮就踩过：`staleOnly` 是前端自造名，服务端收的是 `stale`，恒不命中。」
`HealthBoardPage.tsx:70` 同样写明「（2026-10 修）」。

**更硬的佐证**：`npm run smoke --workspace @linban/admin-web` 实测 **211 passed / 0 failed**，
其中一条守卫就是「**前端不再传 `staleOnly`**（服务端收的是 `stale`，同一概念两个名字 = 永不命中）」。

> **⚠️ 若照主理人的派单把服务端改成 `staleOnly`：前端传的 `stale` 会被 zod `.strip()` 静默丢弃 →
> `q.stale === undefined` → 「信号过期」筛选重新失效，且请求 200、无任何报错。**
> **这正是主理人信里要修的那个 bug——照办会把它装回去。**
> 已拦（致承钧），并把 `stale` 与废弃名 `staleOnly` **双双向契约登记**。

**另两处差异（不构成破坏，但前提不成立）**：

| 主理人信中的表述 | 磁盘实际 | 处置 |
|---|---|---|
| 「契约里要删掉 `/admin/activity/communities`」 | **契约里本来就没有这个端点行**（grep `docs/API-CONTRACT.md` 命中 0）。但**任务 #32 在承钧名下 pending**（新增该端点），与「服务端不提供独立社区字典端点」的裁定**直接冲突** | 已报主理人请撤 #32；契约 §13.6.2.1.1 已写明裁定与理由 |
| 「§5.7.7.1 指向了一个不存在的章节」 | 该章节**存在**（`:559`），只是五级标题。测试 `config-changelog-fields.test.ts:80` 的断言只是 `expect(CONTRACT).toContain('beforeValue')`——**不解析章节号**，所以那个测试现在是通过的 | 已按主理人第一修法提为 `#### 5.7.7.1` 独立章节（已核无脚本按章节号解析契约，改层级安全） |

### 5R.2 契约改动 4 项（本轮落地，契约是全局事实源，只我改）

| # | 改什么 | 落点 | 状态 |
|---|---|---|---|
| ① | `/admin/activity/communities` 端点 | §13.6.2.1.1 + A7 行 | ✅ 契约里本无此端点行；已补「社区下拉由前端从 elders 返回结果去重」+「服务端不提供独立社区字典端点」+ 理由（第二份需同步的数据源） |
| ② | §13.6 elders 逐字参数名 | §13.6.2.1 | ✅ 5 个参数逐字成表 + **废弃名表**（`staleOnly`/`community`/`keyword`，各带「若真发生去哪查」）+ §13.6.2.3 字段级出参表（15 字段） |
| ③ | §5.7.7.1 提独立章节 | `:559` | ✅ 五级 → 四级 |
| ④ | 营收端点出参表 | §13.6.3 | ✅ 参数表 + 字段级出参表 + 6 个 `RevenueExcludeReason` 取值域 + `avgPriceFen` 空值是 `null` 不是 `"0"` + `details` 上限 500 |

**顺带修掉的一处真缺口**：`details` 硬上限 500 条**但出参不带 `truncated` 标记**——
财务看到恰好 500 条**无法区分「正好 500」与「被截断」**。
契约已显式登记「上限 500」并写明该缺口与处置方向（与 §5.7.7 的 `truncated` 同源，revenue 端尚未补）。
**留白比「不写上限」更危险**——不写上限，前端会以为看到的是全量。

### 5R.3 P10 第 2 步（前端类型从契约导入）—— **本轮不做，但要写明将来怎么做**

主理人裁定：「契约不是 TS，codegen 工具链在 MVP 是过度工程——但要在报告写明『这一层现在没有，以及将来怎么做』，不能留空白」。

**这一层现在没有。** 具体缺三样：

| 缺什么 | 现在的替代做法 | 代价 |
|---|---|---|
| ① 契约 → TS 类型的自动生成 | 前端手写 `ActivityElderRow` 等类型 | 17 处字段名不对齐（P10），全靠人工发现 |
| ② 契约 → 前端类型的**单向门禁** | 靠映棠的 `enum-guard.ts` 抓枚举域；**字段名**尚无门禁 | 字段名错位在 TS 里**完全合法**（admin.routes.ts 自己拼对象，没 DTO 类型），编译通过、运行不报错、页面**永久空白** |
| ③ 契约 → 服务端 DTO 类型的自动生成 | 服务端手写 `ElderActivityRow` | 同上——`admin.service.ts:97-119` 手工拼对象，改字段名无编译错误 |

**将来怎么做（三步，按投入递增，MVP 只做第 1 步）**：

1. **W-MVP（现在就能做，零工具链）**：把契约的逐字出参表**变成断言**。
   承钧已在 `config-changelog-fields.test.ts` 对 changelog 做过这个模式（`expect(BLOCK).toContain('beforeValue:')`）。
   **同一模式套用到 elders / revenue**：服务端 `admin.service.ts` 的返回对象里每个字段名逐字断言。
   ——这不需要 codegen，**只需要有人写 30 行断言**，且能立刻拦住「字段名写错」这类静默失效。
2. **W+1（轻量 codegen）**：契约的出参表用**结构化 YAML/JSON front-matter** 承载（而非 Markdown 表格），
   一个 30 行的脚本生成 `packages/shared/src/types/activity.ts`。
   ——不引入完整 OpenAPI/codegen 工具链（那才是过度工程），只做**我们自己那一张表的生成**。
3. **W+2（完整契约驱动）**：上 OpenAPI 3.1 + `openapi-typescript`，
   前端 `import type` 直接吃生成物，服务端用 zod schema 反推。
   ——**前提是契约本身要能机器解析**。而**本轮做的逐字表就是往这个方向走的第一步**：
   Markdown 散文无法被机器核对，逐字表可以。**没有本轮的逐字表，W+2 无从谈起。**

> **一句话**：**这一层现在没有，但它不是「将来才会有」——是「本轮的逐字表让它将来会有」。**
> 散文的契约无法被机器核对，逐字表可以；逐字表不自动生成类型，但它是 codegen 的**唯一前置条件**。

### 5R.4 机制③「磁盘在变」—— 已写进 P1 规格 §2.4.1 + §3.5

主理人本轮新发现的第四种丢弃形态，细节见 §3.3。

---

## 📌 本轮增补（第三轮 · 2026-10）

主理人核验了本报告并给出两处纠正 + 一处撤销，本轮已全部落实：

| 主理人意见 | 处置 | 落点 |
|---|---|---|
| **P1 退出码不可靠** —— 采纳并推广 | 本轮产出**实现规格** | [`GATE-COLLECTION-SPEC.md`](./GATE-COLLECTION-SPEC.md) |
| **P4 文档表数过期** —— **撤销**（文档是对的） | 本轮自曝该假阳性，并写入**踩坑记录** | §5 新增「踩坑记录」 |
| **「未发现问题」要改说法** —— 逐条核而非声明 | 本轮逐条复核 §8 的 14 项 | [`GATE-AUDIT-L10-SELFCHECK.md`](./GATE-AUDIT-L10-SELFCHECK.md) |
| **新增线索 10** | 逐条复核 → 发现 2 处方向性错误 | 见 §3 新增 P11 / P12 |
| **方法论模板** | 独立成文，可直接套用 | [`GATE-AUDIT-METHODOLOGY-TEMPLATE.md`](./GATE-AUDIT-METHODOLOGY-TEMPLATE.md) |

**本轮新发现（4 条，均已复核）**：
- **P10（🔴）**：`/admin/activity/elders` 三方字段 **17 处不对齐**（服务端 ↔ 前端 ↔ mock），含 1 处单位不同（`freshnessMinutes` vs `freshnessSec`）→ 真后端一接即大面积白板 + 契约 §13.6 硬约束（UNKNOWN 单独视觉分区）从服务端退化为前端推断。**原 P6 判定「契约侧需修」方向反了** —— 契约是**从未有字段级定义**，根因是三方各写各的。
- **P11（🟡）**：生产代码有 **60+ 处 `.catch()`**，其中 `risk.routes.ts` 5 处 `catch(() => undefined)` **无注释**（同类 `review.routes.ts:75` 有注释）→ 风控动作失败被静默吞掉；`payment.service.ts:487` 对账查询失败被兜底成 `[{cnt:0n, amt:0n}]` = **「完美对平」**。
- **P12（🟡）**：`numTotalTestSuites` **不是文件数**（实测 195 vs 35）→ 主理人三数比对里的 B 若按字面取该字段会**直接假红**。正确口径是 `testResults.length`。
- **P13（🟢，第四轮已撤销）**：第三轮我判「server 测试存在随机失败」→ 第四轮实测证明那是 **threads 池的 native 崩溃**（机制 3），配置层四件套下 **14/14 全绿零崩溃**。→ 「测试不稳定」是误判，根因在池不在测试。

**本轮实测新数据（⚠️ 第四轮已修正口径，见 §3.2 —— 下面这张表的「默认池」标签是错的）**：
| 配置 | 收集文件数 | Tests | 失败数 | 退出码 |
|---|---|---|---|---|
| 默认池 | 35 / 35 / 35 | 737 | **2 / 1 / 0** | 1 / 1 / 0 |
| `--pool=forks` 单独 | 35 / 35 / 35 | 737 | 1 / 0 / 0 | 1 / 0 / 0 |
| `--pool=forks --no-file-parallelism` | 35 / 35 / 35 | 737 | 0 / 0 / 0 | 0 / 0 / 0 |
| `--no-file-parallelism` 单独 | 35 / 35 / 35 | 737 | 0 / 0 / 0 | 0 / 0 / 0 |
| **清缓存后 `--pool=forks`** | 35 / 35 / 35 | 737 | 0 / 0 / 0 | 0 / 0 / 0 |

→ **机制 1 / 机制 2 在 server 包上均未复现**（清缓存后仍全收集）→ 当前由**配置层** `pool: 'forks' + singleFork: true` 稳定。**但我未复现主理人观测到的 31/32/33 波动，故不能断言「已根治」**（见 §9 诚实边界）。

---

## 3.2 第四轮实测修正：「默认池」这个说法本身就是错的（🔴 推翻前一轮的口径）

> **本节是第三轮发回后，我自己继续实测发现的。前一轮报告与主理人对照表里的「默认池」一列，全部需要重读。**

### 3.2.1 事实一：仓库的 `vitest.config.ts` 已显式写 `pool: 'forks'`，所以「不传参数」根本不是 threads 池

```bash
# apps/server/vitest.config.ts 剥注释后的 test 段（第四轮实测时的磁盘状态）
test: {
    environment: 'node',
    include: ['src*.test.ts', 'src*.spec.ts'],
    reporters: ['default'],
    pool: 'forks',
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    cacheDir: fileURLToPath(new URL('./node_modules/.vitest', import.meta.url)),
  },
```
vitest 2.1 的 CLI 默认确实是 `threads`（`node_modules/vitest/dist/chunks/cac.*.js:965`：「default: `threads`」），**但配置文件里的 `pool: 'forks'` 会覆盖它**。

> **所以「不传 pool 参数」= 配置层的 forks + singleFork + fileParallelism:false，不是 threads。**
> 前一轮报告里「默认池」那一列，**测的其实是配置层四件套**，标签是错的。

### 3.2.2 事实二：真正的 threads 池会**整进程崩溃**（段错误），这不是「丢文件」

第四轮用 `--pool=threads` 显式强制，连跑 **8 次**：

| 次数 | 退出码 | 收集 | 报告 | 现象 |
|---|---|---|---|---|
| run1 | 1 | 38/38 齐 | 有 | 2 个测试失败 |
| run2 | 0 | 38/38 齐 | 有 | — |
| run3 | 0 | 38/38 齐 | 有 | — |
| **run4** | **139** | 38/38 齐 | 有 | **Segmentation fault** |
| run5 | 0 | 38/38 齐 | 有 | — |
| **run6** | **139** | 38/38 齐 | 有 | **Segmentation fault** |
| run7 | 0 | 38/38 齐 | 有 | — |
| run8 | 0 | 38/38 齐 | 有 | — |

bash 层的 stderr 明确写着：
```
bash.exe: line 10: 3487 Segmentation fault  timeout 120 npx.cmd vitest run --pool=threads ...
```

**关键观察**：
- **EXIT=139 = 128 + 11 = SIGSEGV**
- **收集数始终 38/38 齐** —— 崩溃发生在**测试执行阶段**，不是收集阶段
- 另一次观测到 **EXIT=3221225477 = 0xC0000005 = STATUS_ACCESS_VIOLATION**（Windows 访问冲突），且那次**JSON 报告根本没产出**（`exec=0`、35 个文件全"漏"）

### 3.2.3 这解释了主理人观测到的「31/32/33 波动」

> **主理人原信**：「`--pool=forks` 单独用会波动（31/32/33）」

**新的解释**：threads 池下 vitest **会崩**。崩在执行阶段 → 报告里只留下崩之前跑完的文件 → **Test Files 数就是 31/32/33 这种随机值**。

> **所以那不是「丢了文件」，是「进程崩了，剩下没跑完」。**
> 这个区别很重要：**「丢文件」的根因是 EPERM 写盘（机制 1/2），「31/32/33」的根因是 native 崩溃（机制 3）。**

### 3.2.4 对照组：配置层四件套 **8/8 完美**

同一时刻、同一磁盘（38 个测试文件）、同一命令只去掉 `--pool=threads`：

| 次数 | 退出码 | 收集 | 失败 | 崩溃 |
|---|---|---|---|---|
| run1–run8 | **0 / 0 / 0 / 0 / 0 / 0 / 0 / 0** | **38/38 齐** ×8 | 0 ×8 | **0** |

> **配置层四件套 8/8 零异常，四项同时生效时没有观察到任何收集缺失或崩溃。**

### 3.2.5 修正主理人对照表的读法

| 主理人对照表原文 | 修正后 |
|---|---|
| 「默认池 → 28」 | **在当前仓库不成立** —— 配置文件已写 `pool: 'forks'`，不传参数走的是四件套。**要测 threads 必须显式 `--pool=threads`** |
| 「`--pool=forks` 单独用会波动（31/32/33）」 | **`--pool=forks` 不会让配置里的 `singleFork` / `fileParallelism` 失效**（命令行只覆盖 `pool` 字段）。**31/32/33 的真因是 threads 池的 native 崩溃** |
| 「`fileParallelism: false` 才是稳定项」 | ⚠️ **不准确**。实测 `pool: 'forks' + singleFork: true`（即配置层）**8/8 全绿零崩溃**。`fileParallelism: false` 是**第四件**，不是唯一稳定项 |
| 「两个开关必须一起上」 | ⚠️ 实测配置是**四件套**：`pool: 'forks'` + `fileParallelism: false` + `poolOptions.forks.singleFork: true` + `cacheDir`（指向项目内）。**四件一起才 8/8 完美** |

### 3.2.6 承钧已把四件套 + 断言落盘（第四轮实测时的磁盘状态）

`apps/server/vitest.config.ts`（mtime 06:05）、`apps/miniapp-companion/vitest.config.ts`（mtime 06:10）都已是四件套。
`apps/server/scripts/check-test-collection.ts`（mtime 06:12）的 `checkVitestConfig` 已断言：
- `pool: 'forks'` 必须配（剥注释 + 定位 `test:` 段，防注释恒真）
- `fileParallelism` 必须显式写 `true`/`false` 之一（只写 key 不给值视为未配）
- **`fileParallelism` 不得重复出现** —— 注释记录了这个真实踩坑：曾在同一份 config 里出现两次（上方 true、下方 false），**JS 语义是后者覆盖前者（运行时确实生效 false），但读文件的人只看得到第一个 true** → 下一个改代码的人以为可以并行，把 false 删掉，丢文件问题原地复活

> **这条断言的设计质量很高**，符合规格 §3 维度④「禁列/白名单带理由」的思路。

### 3.2.7 新的机制分类（第三种丢文件形态确认）

| 形态 | 现象 | 判据 | 根因 |
|---|---|---|---|
| **机制 1** EPERM 写盘 | 文件数少，报告说 passed | 清缓存后仍不收集 | 沙箱 broker IPC 裁决 |
| **机制 2** 并发写同名缓存 | 同上 | 清缓存后恢复 | 并发写缓存目录 |
| **机制 3（新增）** native 崩溃 | 文件数少，**退出码 139 / 0xC0000005**，可能**无报告** | 退出码是信号值而非 0/1 | threads 池 native 段错误 |

> **机制 3 的判据最简单也最可靠：退出码 ≥ 128（信号）或 Windows 异常码（如 3221225477）。**
> 这也再次印证「退出码不能当判据」——但**反过来说，退出码 ≥ 128 是一个极强的「出了大事」信号**，必须单独判。

### 3.2.8 `include` 模式核对（承钧的改动没有改坏它）

承钧把 `include` 从 `['src/**/*.test.ts', ...]` 改成了 `['src*.test.ts', ...]`（少了两层斜杠）。核对：
```
磁盘实际测试文件数 = 35
'src*.test.ts'      命中 35 个   ← tinyglobby 的 * 跨目录分隔符，等价
'src/**/*.test.ts'  命中 35 个
```
> **等价，未改坏。** 但这是一个**易被误读的写法** —— `src*.test.ts` 看上去像"只匹配 src 根目录"，实际是"src 下任意层级"。**建议在 config 里加一行注释说明这一点**，否则下一个人会以为它只匹配一层。

---

## 0. 执行摘要

| 项 | 结论 |
|---|---|
| 审计对象 | 4 个包（server / admin-web / miniapp-companion / miniapp-user）+ shared + 4 份文档 |
| 门禁脚本 | 8 个（server scripts 5 + admin-web scripts 5，含.mjs） |
| 测试文件 | 磁盘 36 个（server 34 + companion 2 + 其他 0） |
| 发现问题 | **13 条**（严重 4 / 中等 7 / 轻微 2），本轮新增 4 条 |
| 最严重发现 | **companion 默认池随机丢测试文件且 errors=0 —— 退出码 0、无任何告警、每次都可能"全绿"** |
| 主理人线索复核 | 8 条：**存在 3 / 不存在 3 / 部分存在 2**（第三轮逐条复核后，3 条的**表述**已修正） |
| 第三轮增补 | **P1 实现规格** + **线索 10 自审** + **方法论模板**（3 份新文档） |
| 结论 | 门禁体系**主体有效**，但**存在一类系统性缝隙：机制正确却挂在会静默失效的路径上** |

**一句话结论**：这不是「门禁写错了」，而是「**门禁跑没跑、跑全没跑全，没人能确定**」——在 CI 存在之前，所有"passed"都是不可采信的。

---

## 1. 八条线索判定表

| # | 线索 | 判定 | 证据（实测） |
|---|---|---|---|
| 1 | 门禁覆盖 vs 门禁自身在检查范围外 | **部分存在** | admin-web **已修**（`tsconfig.json` include 含 `scripts/**/*.ts`，且带 6 行设计说明注释）；**server 未修**（`tsconfig.json:29` include=`["src","prisma","vitest.config.ts"]`，**`scripts/` 不在内**）→ `verify-doc-configs.ts`(31KB) 与 `check-migration-drift.mjs` 的类型错误不会被 tsc 抓到 |
| 2 | 断言检查点 ≠ 破坏落点 | **不存在** | 逐例核 `coupon-deduct-wiring.test.ts`：破坏注入点直读 `order.service.ts` 源码块（`SVC_PATH` 定位），断言查同一块；`companion-income-contract.test.ts:119` 明确覆盖「**路由文件**出参也不得带 cipher（第一版漏扫了这里）」——落点与断言同源 |
| 3 | 恒真命题 | **不存在** | `prisma:migrate:diff` 同文件自比仅存于 `scripts/*.mjs:5` 的**注释**（说明已修），脚本已改为真迁移链比对；`migrations/` 目录实存 4 个迁移 + lock |
| 4 | 吞异常型假通过 | **不存在**（⚠️ 表述已修正） | **在测试代码中**搜 `.catch(e=>e)` / `.catch(()=>{})` / catch 后 `expect(true)`：**0 命中**。⚠️ **上轮写「全量搜」是错的**——全仓实有 **60+ 处** `.catch()`（上轮只搜了测试文件后缀）。本轮逐条核生产代码 8 处关键路径，发现 2 处建议改进（见 P11） |
| 5 | 守门测试被静默丢弃 | **存在（本轮核心）** | 见 §2 详细证据。companion 默认池 `1→2→1` 随机波动，**每次 errors=0、退出码 0** |
| 6 | mock 侧永远不报错 | **部分存在** | 号段/枚举已由 `enum-guard.ts` + `doc:check:configs` 段6.1–6.4 守住（28 键双向差集为空）；**但 mock 字段名仍靠人工对齐**——`mock/db.ts` 中 `createdAt` 大量使用，未见"mock 字段名 ↔ 契约字段名"的自动交叉断言 |
| 7 | 文档承诺 vs 磁盘 | **不存在**（❌ 上轮判「部分存在」是**假阳性**，已撤销） | schema 实为 **54 模型/66 枚举**，`DATABASE.md` **三处均为 54/66**（`:6` / `:27` / `:42`）。上轮 grep 命中的「53」在 `:784` 的**历史变更记录**里（描述「45→53」这个当时的动作），**不是当前口径声明**。→ 见 §5 踩坑记录 |
| 8 | 不可逆操作的「可逆性幻觉」 | **部分存在** | 券 `resume`/`publish` 同目标态 **已正确防御**：`validateResume` 不复用 `canTransition`（`coupon.ts:343-345` 注释明确记录曾踩坑），`coupon.test.ts:259` 有 `validateResume(DRAFT).ok === false` 断言守住；但**缺"所有状态机枚举"的同目标态路径全量扫描门禁**，靠人记 |

---

## 2. 线索 5 详证：本轮最严重发现

### 2.1 现象

`apps/miniapp-companion` 磁盘有 **2 个** `.test.ts`，但默认池随机只收集 1 个：

```
$ cd apps/miniapp-companion && npx vitest run     # 连跑 3 次
  run: files=1 errors=0
  run: files=2 errors=0        ← 同一命令，结果不同
  run: files=1 errors=0
```

**最危险的一点：`errors=0`、退出码 `0`。** 与 server 早前观测到的 `Errors 1 error` 不同，companion 的失败**连告警都没有**——日志里两个文件都打 `✓`，汇总数字却是 1。

### 2.2 根因（已定位到栈）

```
Error: EPERM: operation not permitted, open
  '...node_modules\.vitest-tmp\...\ssr\40b9f1f37d5bd759c353e90078138580f67eb091'
 ❯ wrappedPromisesWriteFile  node-brokered-fs-shim.cjs:701:20
```

WorkBuddy 桌面端沙箱的 fs broker 对 `fs/promises.writeFile` 做权限裁决，vitest 写 SSR 转换产物失败。**失败被吞，只表现为"少收集了文件"而非"报错"**——vitest 2.1.9 把 unhandled error 单列到 `Errors` 段，而 companion 这次连 `Errors` 都是 0。

### 2.3 `--pool=forks` 的效果（实测，非推测）

| 包 | 默认池（threads） | `--pool=forks` | 磁盘 |
|---|---|---|---|
| server | 34/34 稳定（4 次连跑 721 tests 全过） | 33–34 波动 | 34 |
| miniapp-companion | **1–2 随机波动** | **2/2 稳定**（3 次） | 2 |
| miniapp-user |无测试文件 | — | **0** |

**结论**：`pool=forks` 在 companion 上**确实有效**（消除波动）；server 当前默认池已稳定，但**无任何机制保障**——它只是"这次没踩到"。

### 2.4 为什么退出码不能当判据（实测反例）

```
cd apps/miniapp-companion && npx vitest run --pool=forks   → 退出码 1（有 EPERM）
cd apps/miniapp-companion && npx vitest run                 → 退出码 0（丢了文件）
cd apps/server                && npx vitest run            → 退出码 1（有 EPERM）
```

同一份代码、同一台机器，退出码 **1 和 0 都出现过**，且**退出码 1 的那次反而收集更全**。结论：
> **退出码与收集完整性是两个正交维度。任何只依赖 `exit code == 0` 的 CI 门禁，在本环境下都是不可靠的。**

---

## 3. 问题清单（按严重级别）

### 🔴 严重

| ID | 问题 | 位置 | 现象 | 复现命令 | 建议修法 |
|---|---|---|---|---|---|
| **P1** | 测试文件随机丢弃且完全静默 | `apps/miniapp-companion`（机制层，全包受影响） | 默认池随机 1/2 收集，`errors=0`、退出码 0。server 默认池亦观测到 33/34波动 | `cd apps/miniapp-companion && for i in 1 2 3; do npx vitest run \| grep -E "Test Files\|Errors"; done` | ① 全部 vitest 配置固化 `pool: 'forks'`（写入 `test` 块，不靠命令行传）；② 落地**收集完整性断言**（见 §4）；③ CI 用「收集数 + 点名清单」双判据，**不看退出码** |
| **P2** | 门禁脚本自身不在类型检查范围 | `apps/server/tsconfig.json:29` | `include` 为 `["src","prisma","vitest.config.ts"]`，`scripts/` 缺失→ `verify-doc-configs.ts`(31KB)、`check-migration-drift.mjs` 的类型错误不会被 tsc 抓到 | `cd apps/server && npx tsc -p tsconfig.json --noEmit --listFiles \| grep -c scripts`（预期 0） | 把 `scripts/**/*.ts` 加入 include（照抄 admin-web 的做法 + 同样的设计注释）；`.mjs` 可另起 `tsconfig.scripts.json` 或 `allowJs` |
| **P3** | 门禁无任何统一入口，靠人记得跑 | 全仓 | server 8 个门禁散落：`test` / `typecheck` / `prisma:migrate:check` / `doc:check:configs` / `prisma:validate`… **无聚合 script**；admin-web 亦无。CI 未建 | 见 §5 门禁清单表 | 建根 `package.json` 的 `verify:all`（串起全部门禁），CI 只调它——让"忘记跑某个门禁"物理上不可能 |

### 🟡 中等

| ID | 问题 | 位置 | 现象 | 复现命令 | 建议修法 |
|---|---|---|---|---|---|
| ~~**P4**~~ | ~~文档库表/枚举数已过期~~ | — | ❌ **撤销（本轮自曝假阳性）**。`DATABASE.md:6/:27/:42` **三处均为 54 张/66 枚举**，文档是对的。我上轮 grep 命中的「53」在 `:784` 的**历史变更记录**（描述「45→53」这个当时的动作），**不是当前口径声明** | `grep -n "张表" docs/DATABASE.md` → `:6/:27/:42` 全是 54/66 | **无需修改**。教训见 §5 踩坑记录 |
| **P5** | mock 字段名无自动交叉断言 | `apps/admin-web/src/api/mock/db.ts` | `createdAt` 等字段与契约字段名的一致性靠人工；映棠已抓 9 处，但**无门禁防复发** | 人工比对 mock/db.ts 与 API-CONTRACT §5.7.7.1 | 在 `enum-guard.ts` 增设「mock 出参字段名 ⊆ 契约字段名」断言（字段级镜像，号段级之外） |
| **P6** | 无"同目标态路径"全量扫描门禁 | `apps/server/src/domain/*.ts` | `resume`/`publish` 同目标态已正确防御，但**其余状态机（order/companion/application/safety-suspend）无同目标态全量核查** | 人工遍历各 `canTransition` | 加一条单测：枚举每个状态机的 `(from,to)` 对，断言「同目标态的两条路径其准入谓词不同或已显式文档化」 |
| **P7** | 恒真断言防护未成制度 | 全仓 | 本轮逐例推演未发现恒真，但**无通用防护**；`prisma migrate diff` 同文件自比曾真实发生 | — | 门禁脚本内禁用「同一输入自比」写法；review checklist 增一条 |

### 🟢 轻微

| ID | 问题 | 位置 | 现象 | 建议 |
|---|---|---|---|---|
| **P8** | 恒真注释残留在脚本头| `scripts/prisma-migrate-diff.mjs:5`、`check-migration-drift.mjs:5` | 注释里保留旧脚本写法，grep 时易误判为未修 | 注释加 `-- 已废弃，见 xxx` 前缀 |
| **P9** | miniapp-user 零测试 | `apps/miniapp-user` | 磁盘 0 个 `.test.ts`、无 `vitest.config.ts`、`package.json` 无 `test` script | 老人端是双入口之一，建议至少为关键 service 加冒烟测试；否则纳入门禁清单时显式标注"无测试"而非留空 |

---

## 3.1 第三轮新增问题（P10–P13）

### 🔴 P10 · `/admin/activity/elders` 三方字段 17 处不对齐 —— 接真后端即大面积白板

> **上轮 P6 判定「契约健康感知端点 4 处过期 → 契约侧需修」，方向反了。**
> 主理人要求核「前端实际消费」，本轮三方实测后：契约是**从未有字段级定义**（只有散文描述），真正的病灶是**服务端 / 前端 / mock 三方各写各的**。

| 侧 | 文件 | 字段数 |
|---|---|---|
| 服务端 | `apps/server/src/modules/activity/admin.service.ts` → `ElderActivityRow` | 15 |
| 前端 | `apps/admin-web/src/shared/types.ts` → `ActivityElderRow` | 16 |

**逐字段差集**（本轮用脚本实算，非目测）：

| 方向 | 字段 | 数 |
|---|---|---|
| 服务端有、前端没有 → 前端读到 `undefined` | `elderUserId` / `nickname` / `freshnessMinutes` / `explainLabel` / `partition` / `needsAttention` / `summaryDate` / `disclaimer` | **8** |
| 前端有、服务端没有 → 真后端接上后读到 `undefined` | `id` / `elderNameMasked` / `age` / `freshnessSec` / `unknownReason` / `deviceStatus` / `consentStatus` / `consentScopeLevel` / `orderCount30d` | **9** |

**最危险的一处：单位都不同**
```
服务端 ElderActivityRow.freshnessMinutes   ← 分钟
前端   ActivityElderRow.freshnessSec        ← 秒，且前端自己 /60 当分钟用
        HealthBoardPage.tsx:449  Math.floor(r.freshnessSec / 60)
→ 真后端一接：显示实际值的 1/60；undefined 时显示 "NaN前"。全程零报错。
```

**第二危险的一处：契约硬约束的执行位置从服务端退到客户端**
契约 §13.6 elders 明写：「**数据不足（UNKNOWN）与信号过期必须单独视觉分区**，禁止与正常状态混排」。
服务端出参**有** `partition: 'NORMAL' | 'UNKNOWN_OR_STALE'` 专门承载；前端**没有**这个字段，改为自己在 mock 层推断。
→ 接真后端后，**这条契约硬约束的保证消失**（连带违反 §13.1 红线①「运营看到的就是老人端可见的」）。

**复现命令**（三方字段实算脚本见 `GATE-AUDIT-L10-SELFCHECK.md` §3）
```bash
# 服务端出参字段
sed -n '/export interface ElderActivityRow/,/^}/p' apps/server/src/modules/activity/admin.service.ts
# 前端消费字段
sed -n '/export interface ActivityElderRow/,/^}/p' apps/admin-web/src/shared/types.ts
# 契约端点（散文，无字段级表）
grep -n "admin/activity/elders" docs/API-CONTRACT.md
```

**建议修法**（按优先级）
1. **契约补字段级出参表**（字段名 + 类型 + **单位** + 必填性）—— 这是根因修复
2. 以服务端 `ElderActivityRow` 为准，前端类型改为**从契约/shared 导入**（单一事实源）
3. `freshnessSec` / `freshnessMinutes` **统一命名与单位**（建议全链路用 `freshnessSec`，因为 `computeConfidence` 的入参就是 `freshnessSec`）
4. `partition` **必须由服务端给**，前端不得自行推断
5. **加门禁**：契约字段表 ⊆ 服务端出参 ⊆ 前端消费类型（**三方集合对账**，不是数量对账）—— 这正是 `enum-guard.ts` 第 6 节「集合对账，不是数量对账」范式在**出参字段**上的应用

> **这条门禁是通用的**：本项目所有「mock 层 ↔ 真实后端」接口都该有。
> 现有 `enum-guard.ts` 只管**枚举码值**，管不到**出参字段名** → 这就是 P5 的具体可复现实例。

---

### 🟡 P11 · 生产代码 60+ 处 `.catch()`，其中 2 处建议改进

**上轮说「5 处 catch 全为正确范式」是错的**——那 5 处是**测试文件内**的 catch。全仓实有 **60+ 处** `.catch()`，绝大多数在前端页面（`.catch(() => null)` 属合理 UI 降级）。

本轮逐条核了**服务端 8 处关键路径**：

| 位置 | 行为 | 判定 |
|---|---|---|
| `prisma/seed.ts:297` | `log.error` + `process.exitCode = 1` | ✅ 失败可见 |
| `scripts/check-coupon-backfill.ts:113` | `console.error` + `process.exitCode = 1` | ✅ 失败可见 |
| `app.ts:86` | 健康检查失败 → `false` → HTTP 503 | ✅ 降级为不健康 |
| `app.ts:130` | cron 注册失败 → `log.warn` | ✅ 有日志 |
| `activity/alert.service.ts:394` | SOS 出口失败 → `log.error` + 转人工 + 工单不回滚 | ✅ 有意设计且注释解释了原因 |
| `review.routes.ts:75` | 信用分越界不阻塞评价 → `catch(() => undefined)` | ✅ **有注释**说明是有意为之 |
| **`risk.routes.ts:111,217,232,243,395`** | 风控动作失败 → `catch(() => undefined)` | ⚠️ **无注释** |
| **`payment.service.ts:487`** | 对账查询失败 → `[{cnt:0n, amt:0n}]` | ⚠️ **失败被当成"零"** |

**建议**
1. `risk.routes.ts` 5 处：至少补注释说明「为什么可吞」；**更好**：写 `audit_logs` —— 风控动作失败必须留痕，否则事后无法追责
2. `payment.service.ts:487`：改为抛错或返回显式 `null` 标记，**调用方必须区分「真的零」和「查不到」**。当前实现让 DB 抖动 → 对账变成「完美对平」→ **对账门禁静默失效**（与 P1 同型的问题：失败被伪装成成功）

**复现命令**
```bash
grep -rn "\.catch(" apps packages --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.test\.ts" | wc -l
```

---

### 🟡 P12 · `numTotalTestSuites` 不是文件数 —— 主理人三数比对里的 B 若按字面取会**直接假红**

**本轮实测**（server，磁盘 35 个 `.test.ts`）：
```
numTotalTestSuites = 195   ← describe 块数 ❌
testResults.length  = 35    ← 文件数 ✅
numTotalTests      = 737   ← 用例数
numPassedTests     = 737
```
**验证方式**（脚本实算）：737 个 `assertionResults` **全部**带 `ancestorTitles`（即全部位于 describe 内）→ describe 块数 195。

**影响**：主理人给承钧的原派单是「三数比对 `A === B === C`，B 取 `numTotalTestSuites`」——**按字面实现会 35 ≠ 195 直接假红**。
→ **正确口径：`testResults.length`**。已写进 `GATE-COLLECTION-SPEC.md` §2.1②。

**复现命令**
```bash
cd apps/server && npx vitest run --reporter=json --outputFile=.tmp/_f.json
python -c "
import json; d=json.load(open('.tmp/_f.json',encoding='utf-8'))
print('numTotalTestSuites =', d['numTotalTestSuites'])
print('testResults.length =', len(d['testResults']))
print('numTotalTests      =', d['numTotalTests'])"
```

---

### 🟢 P13 · server 包「测试稳定」结论需降级 —— ⚠️ **第四轮已撤销（见 §3.2）**

**第三轮判定**：「收集维度稳定 35/35，但**测试维度默认池下 3 跑有 2 次失败**」→ 判为 🟡 中等，交承钧定位。

**第四轮实测推翻**（根因找到了，**不是测试本身不稳定**）：

| 配置 | 连跑 | 收集 | 失败 | 崩溃 |
|---|---|---|---|---|
| **`--pool=threads`（真 threads 池）** | 8 次 | 38/38 齐 | **2（run1）** | **2/8 段错误（EXIT=139）** |
| **配置层四件套（不传 pool）** | 8 次 | 38/38 齐 | **0** | **0** |
| **配置层四件套（复核）** | 6 次 | 38/38 齐 | **0** | **0** |

> **「随机失败」和「随机崩溃」都只出现在 threads 池下。**
> 配置层四件套 **14 次连跑（8+6）零失败零崩溃**。

**结论**：
> **P13 撤销**。server 包的测试在**配置层四件套下是稳定的**（14/14 全绿）。
> 第三轮观测到的「随机失败」是 **threads 池的 native 不稳定**（同一根因：机制 3 崩溃）的**另一种表现**——崩之前已跑完的部分会报告失败。
> **教训**：我把「池不稳定」误判成了「测试不稳定」——**因为两者都表现为「有失败」**。
> **判据**：**要区分「测试失败」与「环境失败」，必须看失败发生在哪个阶段**（收集前 / 收集后执行中 / 进程崩溃）。
> **建议保留的一条**：聚合入口应同时输出 `numFailedTests` **与退出码**（退出码 ≥ 128 = 崩溃，是独立信号）。

---

## 3.3 第五轮新增 · 机制③「磁盘在变」：第四种丢弃形态

**主理人本轮实测发现的新形态**，与前三种（EPERM 写盘 / 并发写同名缓存 / native 崩溃）**机制不同、判据不同**。

### 3.3.1 现象

门禁报「缺 `coupon-state-machine.test.ts`」，但该文件**确实在磁盘上**，
且**集合级比对差集唯一、无顶替者**（不是「A 丢了 B 补上」）。

### 3.3.2 证据链（主理人 2026-10-22 实测）

```
06:20:20  落盘 coupon-state-machine.test.ts
06:20:38  再落盘另一个测试文件
   ↓ 同期跑门禁 → 报缺 coupon-state-machine.test.ts
   ↓ 集合级比对 → 差集唯一，无顶替者
   ↓ 磁盘稳定后 → 连跑 6 次门禁 + 6 次 vitest → 全 38/38，零波动
```

### 3.3.3 为什么 `singleFork` 治不了也不需要治

`singleFork` 解决的是「**多个进程**并发写同名缓存」（机制 ②），
而机制 ③ 是「**测试文件在收集窗口内被创建/修改**」——
收集进程扫到了某一刻的目录快照，之后文件才落盘。
**这是时序问题，不是并发写冲突问题**，加串行化一点用都没有。

**这不是「丢了文件」，是「快照与现实不同」**：
门禁报「收集快照里没有它」，真相是「收集那一刻它还没落盘」。

### 3.3.4 🔴 判别法（**必须先做这一步，再谈并发/状态污染**）

```
① 跑前记磁盘文件集合 S_before，跑后记 S_after
② S_before ≠ S_after（双向差集都为空才算相等）→ 机制③ → 报 WARN
③ S_before = S_after → 才往并发写 / 状态污染 / 池配置方向查
```

**为什么必须双向比差集**：`size` 相同不代表集合相同——删一个加一个，总数不变但集合变了。

### 3.3.5 ⚠️ 最阴的地方：「多跑几次」在机制③存在时恰好会**掩盖**问题

磁盘稳定后连跑 6 次全绿，看起来「问题消失了」，
实际是**环境不再变化**了，不是门禁修好了。

> **「多跑几次就绿了」不能作为「原因已查明」的证据**——
> 它只说明「现在这一刻磁盘是稳定的」。

**这条直接改写了「连续跑 ≥3 次」这条判据的适用边界**：
连跑 3 次是**为了暴露概率性丢文件**（机制 ①②）；
而机制 ③ 存在时，连跑 3 次恰好是最容易**误判为「已根治」**的动作。

### 3.3.6 与 P13 撤销的关系

**P13 撤销的根因是「threads 池 native 崩溃」（机制 ③的旧名，与本节的「磁盘在变」不是同一件事——名字撞了，机制不同）**。
主理人第五轮信里说「真正触发条件是机制③，判别法：先看磁盘文件数跑前跑后是否变了」——
**本节的判别法正是主理人指的那一条**，我把它固化进了 P1 规格 §3.5。

### 3.3.7 处置

- 门禁侧：缺文件若 **mtime 在最近 N 分钟内** → 报 **WARN**（不是 ERROR）+ 提示「磁盘在变，请稳定后重跑」
- 流程侧：**不要**在有人落盘的窗口跑门禁

> **⚠️ mtime 只作线索，不作判据**——它**绝不能**成为「把 ERROR 降级成 WARN」的万能借口，
> 否则任何人只要 `touch` 一下文件就能让真事故降级。
> 严重级别由「**磁盘是否变化**」决定，mtime 只进消息文本与建议。
> 完整判读矩阵见 P1 规格 §3.5.2。

---

## 4. 收集完整性断言设计（评估主理人方案 + 补充）

主理人初步方案：
- 磁盘 `find` 出的 `.test.ts` 数 === JSON reporter 的 `numTotalTestSuites`
- 点名关键守门测试必须在清单里

**评估：方向正确，但两个维度都不够。**

| 主理人的维度 | 能抓什么 | 抓不到什么 | 判定 |
|---|---|---|---|
| 数量相等断言 | 「少了一个文件」 | 「少的正好是某个守门测试」——若数量恰好守恒（如丢 1 个同时新增 1 个），数量断言仍绿 | ⚠️ 必要但不充分 |
| 点名守门测试 | 「守门测试丢了」 | 「**新增的**守门测试忘了点名」——清单是手写的，新测试默认不在清单里 |⚠️ 有效但会腐烂 |

**我补上的四个维度**：

1. **集合相等而非数量相等**（防"丢一个换新增一个"）
```ts
expect(new Set(jsonFiles)).toEqual(new Set(diskFiles))   // 双向差集为空，而非仅比长度
```
2. **清单从代码派生，而非手写**（防清单腐烂）
   用命名约定（如 `*.guard.test.ts`）或读取目录 glob 生成"必须执行集合"，让人工清单只做**加法断言**（`expect(mustRun ⊆ collected)`），而不是维护等值全名单单。
3. **反例自证**（仿 `outbound-cipher-guard.test.ts:74`「整行直出必被检出（反例：证明守卫不是空断言）」）
   这条设计**已经在这个仓库里被验证有效**——建议把该范式写进收集断言：故意注入一个假文件名，断言收集完整性检查会红。
4. **正交的第二判据：`Errors N error` 必须为 0**
   既然退出码不可信（§2.4），就把 `Errors` 计数作为独立断言。它能在EPERM 出现但未被计入 Tests 时兜住。

**我的方案与主理人的差异**：不是替代，是补齐——主理人的两条都保留，加集合相等 + 清单派生 + 反例自证 + Errors 断言。

---

## 5. 门禁清单（全量，含"是否在会被执行的路径上"）

| 文件 | 所在目录 | 在 tsc include | 被 npm script 调用 | CI 会跑 |
|---|---|---|---|---|
| `scripts/verify-doc-configs.ts` | `apps/server/scripts` | ❌ **不在** | `doc:check:configs` | 待接 |
| `scripts/check-migration-drift.mjs` | `apps/server/scripts` | ❌（.mjs 且不在 include） | `prisma:migrate:check` | 待接 |
| `scripts/prisma-migrate-diff.mjs` | `apps/server/scripts` | ❌ | `prisma:migrate:diff` | 待接 |
| `scripts/probe-enum-collect.ts` | `apps/server/scripts` | ❌ | **无**（探针，非门禁） | — |
| `scripts/probe-zod-group-p0.ts` | `apps/server/scripts` | ❌ | **无**（探针） | — |
| `scripts/enum-guard.ts` | `apps/admin-web/scripts` | ✅ 已修 | **无独立 script** | 待接 ⚠️ |
| `scripts/smoke-enums.ts` | `apps/admin-web/scripts` | ✅ 已修 | `smoke` | 待接 |
| `scripts/smoke.mjs` / `esbuild-smoke.mjs` / `check-collection.mjs` | `apps/admin-web/scripts` | ❌（.mjs） | `smoke` | 待接 |

**测试文件守门清单**（关键 12 个，实测全部真跑）：

| 守门测试 | 守护对象 | 实测 |
|---|---|---|
| `admin-perm-guard.test.ts` | RBAC 门禁 | ✅ RUN |
| `response-discipline.test.ts` | 出参纪律 | ✅ RUN |
| `revenue-endpoint-contract.test.ts` | 营收端点契约 | ✅ RUN |
| `no-cipher-in-response.test.ts` | 密文出参 | ✅ RUN |
| `outbound-cipher-guard.test.ts` | 地址密文三层守卫 | ✅ RUN |
| `companion-income-contract.test.ts` | 提现出参（含银行卡密文） | ✅ RUN（38 断言） |
| `coupon-deduct-wiring.test.ts` | 券快照 wiring | ✅ RUN |
| `config-changelog-group.test.ts` | 配置域上收 | ✅ RUN |
| `activity.gates.test.ts` / `enum-mirror.test.ts` | 活动模块门禁 | ✅ RUN |
| `funnel-attribution.test.ts` | 漏斗归因 | ✅ RUN |

**但这张表是手写的**——正是 P6/P5 说的"清单会腐烂"。建议改为命名约定派生。

### 5.1 踩坑记录：grep 命中 ≠ 事实所在处（本轮新增）

> 主理人原话：「你 grep 到的『53』在 `:784` 的**历史变更记录**里——那行描述的是『表总数 45→**53**』这个**当时的动作**，是正确的历史陈述，不是当前口径声明。」

**本项目已连踩三次同型坑**：

| # | 谁 | 怎么错的 | 真相 | 共性 |
|---|---|---|---|---|
| 1 | **我** | grep `张表` 命中 `DATABASE.md:784` 的「45→53」→ 判「文档库表数已过期」 | `:6/:27/:42` **三处都是 54/66**，文档是对的 | grep 命中 ≠ 当前口径声明 |
| 2 | **主理人** | grep `marketing:` 得 0 命中 → 判成员虚报 | **核验时点早于成员落盘时点**（mtime 问题） | grep 0 命中 ≠ 不存在 |
| 3 | **我** | grep `.catch` 只搜 `*.test.ts` 得 0 命中 → 写「**全量搜**…0 命中」 | 全仓 **60+ 处** `.catch()` | 搜索范围 ≠ 声称范围 |

**判别规则（以后 grep 数字/关键词前必做）**：

| 语境 | 是否当前口径 | 处理 |
|---|---|---|
| 表格首行 / 「当前为 X」/ 章节标题里的数字 | ✅ 是 | 采信 |
| 「变更记录 / v1.5 起 / 45→53」里的数字 | ❌ 历史动作 | **不采信**，去找首行 |
| 注释里引用的数字 | ❌ | 不采信 |

**六步法**：① grep 命中 → ② 读该行完整语境（前 3 后 3） → ③ 判断是「当前口径」还是「历史/注释/示例」 → ④ 若历史 → 去找真正的当前口径 → ⑤ 找不到 → 这才是真缺口 → ⑥ 结论写清「我核的是哪一处」

> **grep 是「存在性」工具，不是「语义定位」工具。搜索范围 + 语境判定，两者缺一不可。**

#### 5.1.1 「上下文性质」判别法（主理人第五轮给定，我第四轮踩过）

主理人第五轮给的一条判别法，我第四轮**没做到**，导致报了假阳性：

> **grep 命中 ≠ 事实所在处**。
> 判别法 = 读命中行**上下各 5 行**，看段落性质是「事实」还是「变更记录/历史沿革」。

**我第四轮的错**（P4 假阳性，已撤销）：
我用 `grep -n "张表" docs/DATABASE.md` 查库表数，命中 `DATABASE.md:784` 的「45→**53**」——
那行描述的是「表总数 45→53」这个**当时的动作**，是**正确的历史陈述**，不是当前口径声明。
而 `:6` / `:27` / `:42` **三处都是 54 张 / 66 枚举**——**文档是对的，是我的判读方法错了。**

**为什么「5 行」这个数字是主理人给的、不是我想出来的**：
5 行不够就往上翻到最近的**标题**——
**标题是性质的判据**：在「变更记录」「历史」「附录」「修订历史」标题下的数字，
一律不是当前口径。这条比「前 3 后 3」更可操作，因为它给了**终止条件**（翻到标题为止）。

**报告层的写法（与「未发现问题」三段式同源）**：
> 「我核的是 `docs/DATABASE.md:6` 的**概览声明**（当前口径），
> 不是 `:784` 的**变更记录**（历史）」

#### 5.1.2 「`node --check` 通过」≠「代码被执行了」（主理人第五轮亲历，第四轮补）

**事故原委**：主理人写 `scripts/verify-all.cjs` 时文件头 `/**` 忘闭合 `*/`，
一路吞到 72 行，把三行 `const` 声明全吞进注释 → 顶层变量全 `undefined` →
**`node --check` 通过**（被吞代码语法上完全合法）→ **但代码根本没执行**。

| 手段 | 能查到什么 | 查不到什么 |
|---|---|---|
| `node --check` | 语法错误 | **注释未闭合吞代码**、变量未声明、逻辑错 |
| `tsc --noEmit` | 类型错误 + 未使用变量 | 运行时才暴露的路径 |
| **跑一次并看输出** | **「这段代码到底执行了没有」** | — |

> **可靠判据是「跑一次并看输出」，不是「静态检查通过」。**

**🔴 对本报告的直接约束（这条最要紧，也是本轮新增的自我约束）**：

> 写「已验证」「未发现问题」时，**验证手段本身可能失效而它看起来有效**。
> 所以每条「已验证」都必须能回答：**① 我跑的是什么命令？② 输出是什么？**
> （具体到参数与工作目录，不是「通过了」三个字）

**为什么这对门禁审计特别致命**：门禁审计的全部价值建立在「门禁真的会红」这个假设上。
若门禁脚本因一个未闭合注释而**从未真正执行过断言**，那么它一直报「全绿」、
退出码是 0、CI 一直是绿的——**而它一个断言都没跑过**。
这是「**门禁在检查范围外**」（线索 1）**最隐蔽的一种形态**：
**门禁文件存在、可运行、退出码正确**。

**最便宜的存活判据**：要求门禁脚本**至少打印一行自己的结论**
（如「检查了 N 个包，ERROR 0，WARN 2」），聚合入口据此判断「它真的跑过了」。
**「没有输出」=「没跑」**。

**同源三故障**（主理人已写入 `D:/wiki/Learning/insight-assert-right-display-wrong-2026-10-22.md`）：

| # | 故障 | 对应本报告的哪一节 |
|---|---|---|
| 1 | **断言对、显示错** | P1 规格 §3 维度⑤（显示层与断言层同源） |
| 2 | **注释未闭合吞代码** | 本节 §5.1.2 |
| 3 | **两态当三态** | P1 规格 §6.2.1（三态守门） |

**三条的共同结构**：
> **「看起来对」与「实际上对」之间没有可见的差别**——
> 所以必须有一层**主动去制造可见差别**的机制（自证 / 显示层同源 / 三态区分），
> 而不能靠「读起来没问题」。

**我本轮的自查**：本报告所有「已核」条目均附了具体命令与行号；
凡未实跑而只读码得出的结论，一律写成「读码结论」并注明未实测
（如 §3.3.3 关于 `singleFork` 为何治不了机制③，属**推理**而非实测）。

---

---

## 5.2 线索 9 · 守门测试「单跑红、全跑绿」专项

> 主理人原话：「我怀疑有些成员报的『已核过』其实是在一个没真正运行的测试上做的。」

### 5.2.1 守门测试是否真在收集清单里

**方法**：取 `check-test-collection.ts` 的 `GUARD_TESTS`（12 条）× JSON reporter 的 `testResults[].name`，双向差集。

**实测（server，磁盘 35）**：**12/12 全部被执行，无一遗漏** ✅

### 5.2.2 「单跑红、全跑绿」检测

**方法**：12 个守门测试逐个**单跑**（`vitest run <file>`），与全量跑结果对比。

**实测结果**：

| 守门测试 | 单跑 files | 单跑 tests | 单跑 failed | success |
|---|---|---|---|---|
| `response-discipline.test.ts` | 1 | 5 | 0 | ✅ |
| `admin-perm-guard.test.ts` | 1 | 18 | 0 | ✅ |
| `outbound-cipher-guard.test.ts` | 1 | 24 | 0 | ✅ |
| `revenue-endpoint-contract.test.ts` | 1 | 28 | 0 | ✅ |
| `companion-income-contract.test.ts` | 1 | 38 | 0 | ✅ |
| `coupon-deduct-wiring.test.ts` | 1 | 20 | 0 | ✅ |
| `config-changelog-group.test.ts` | 1 | 18 | 0 | ✅ |
| `config-changelog-fields.test.ts` | 1 | 13 | 0 | ✅ |
| `coupon-deduct.test.ts` | 1 | 22 | 0 | ✅ |
| `revenue.test.ts` | 1 | 40 | 0 | ✅ |
| `companion-income.test.ts` | 1 | 32 | 0 | ✅ |
| `rating-precision.test.ts` | 1 | 11 | 0 | ✅ |

**12/12 单跑全绿，与全量跑一致 → 本轮未发现「单跑红、全跑绿」的实例。**

### 5.2.3 「复核过但没问题的 14 项」是否都在收集清单里

| # | §8 的项 | 对应测试/脚本 | 在收集清单？ |
|---|---|---|---|
| 1 | prisma:migrate:diff | `scripts/prisma-migrate-diff.mjs`（**非 vitest 测试**） | N/A（另一条门禁路径） |
| 2 | catch 型假通过 | **无对应测试文件** | ❌ **无门禁** |
| 3 | 券 resume 防御 | `domain/coupon.test.ts` | ✅ |
| 4 | 券状态不回退 DRAFT | `domain/coupon.test.ts:65` | ✅ |
| 5 | 提现密文 | `middlewares/companion-income-contract.test.ts` | ✅ |
| 6 | changelog 字段名 | `middlewares/config-changelog-fields.test.ts` | ✅ |
| 7 | 配置域 6 组 28 键 | `middlewares/config-changelog-group.test.ts` + `scripts/verify-doc-configs.ts` | ✅ |
| 8 | 活动模块 8 张表 | `modules/activity/enum-mirror.test.ts` | ✅ |
| 9 | 密文守卫三层 | `middlewares/outbound-cipher-guard.test.ts` | ✅ |
| 10 | admin-web 门禁在 tsc | `admin-web/scripts/check-collection.mjs:197` | ✅ |
| 11 | 券快照回填幂等 | `scripts/check-coupon-backfill.ts`（**非 vitest 测试**） | N/A（另一条门禁路径） |
| 12 | 置信度口径 | `domain/activity.test.ts` | ✅ |
| 13 | forks 在 companion 有效 | `miniapp-companion/vitest.config.ts`（**非测试**） | N/A |
| 14 | server 测试稳定性 | — | ❌ **无门禁**（且本轮已降级，见 P13） |

**结论**：
> **10 项有测试守住**（本轮实测这 10 个文件**确实在执行清单里**）；
> **4 项是脚本/配置/迁移 SQL**，不在 vitest 收集范围 —— 它们由 npm script 驱动，**属于另一条门禁路径**（而 P3 聚合入口缺失 → 这条路径当前无自动执行保障）；
> **2 项无任何门禁**：catch 型假通过（§2 / P11）、server 测试稳定性（P13 —— 第四轮已撤销该降级，根因是池不是测试）。

### 5.2.4 「不覆盖」

- 依赖**跨文件 `beforeAll`** 的顺序依赖（我的单跑会跳过 `beforeAll`，反而"更干净"，可能掩盖问题）
- 依赖**全局 mock 状态 / 模块单例污染**的污染
- **这个检测必须进 CI**：它的价值恰恰在于把"人工单跑"和"CI 全跑"的环境差异统一掉 —— 人工单跑不能替代自动化单跑

---

## 5.3 线索 10 · 「报告不覆盖什么」要逐条核，而不是声明

> 完整版见独立文档 **[`GATE-AUDIT-L10-SELFCHECK.md`](./GATE-AUDIT-L10-SELFCHECK.md)**。此处给结论摘要。

### 5.3.1 逐条复核结果

| # | 上一轮的结论 | 本轮复核 | 判定 |
|---|---|---|---|
| 1 | `prisma:migrate:diff` 同文件自比已修 | 重核 | ✅ 成立（证据更强） |
| 2 | `.catch(e=>e)` 型假通过 0 命中 | 重核 + 扩查 | ⚠️ **措辞不准** → **P11** |
| 3 | 券 `resume` 绕过 `validatePublish` 已防御 | 重核 | ⚠️ **路径引用错**（`domain/` 非 `modules/marketing/`）；结论成立 |
| 4 | 券状态回退到 DRAFT 不存在 | 重核 | ✅ 成立（+ 补「未知状态也拒」） |
| 5 | 提现出参密文已修 + 守门覆盖 routes 文件 | 重核 | ✅ 成立（注释记录了初版漏扫点） |
| 6 | changelog 前后端字段名逐字对齐 | 重核三处 | ✅ 成立 |
| 7 | 配置域 6 组 28 键双向差集为空 | **实跑**（非 grep） | ✅ 成立 |
| 8 | 活动模块 8 张表全在 schema | 重核 | ✅ 成立 |
| 9 | 密文守卫三层 + 反例自证 | 重核 | ✅ 成立 |
| 10 | admin-web 门禁在 tsc 范围 | 重核 | ✅ 成立 |
| 11 | 券快照回填迁移幂等 | 重核 | ✅ 成立 |
| 12 | 置信度口径 | 重核 | ✅ 成立（+ 补「单一口径源」） |
| 13 | `--pool=forks` 在 companion 有效 | 重核 + 扩查 | ⚠️ **根因归错**（是配置层 `singleFork`，非 env 重定向） |
| 14 | server 测试稳定性 | 重核 | ❌ **第三轮降级 → 第四轮撤销**（根因是 threads 池崩溃，非测试）→ **P13** |
| 15 | 契约健康感知端点 4 处过期 | 方向核 | ❌ **方向反了 + 严重性低估** → **P10** |
| 16 | 券 8 个错误码已入表 | 核「前端能否处理」 | ⚠️ **入表成立；「前端能处理」有条件成立**（见下） |
| 17 | P4 文档表数 53/64 | 主理人已核为误报 | ❌ **撤销**（→ §5.1 踩坑记录） |

**净结果**：14 项中 **10 项成立**、**3 项措辞/引用需修正**、**1 项需降级**；2 项方向被点出后升级为新发现（P10/P11），1 项撤销。

### 5.3.2 主理人点名的第 1 项：健康感知契约 —— **方向反了，且严重性被严重低估**

> 主理人：「如果前端已经在用新字段而契约没跟上，那问题方向可能反了」

**核到的事实**：
- **前端确实在消费**：`HealthBoardPage.tsx` 用 `dataIndex: 'elderNameMasked' / 'explainCode' / 'sparkline' / 'deviceStatus'`，`r.freshnessSec`（:449 / :621）
- **契约 §13.6 elders 端点没有字段级出参表**（`grep "elderNameMasked|freshnessSec|explainLabel|partition|needsAttention|nickname" docs/API-CONTRACT.md` → 0 命中，只有散文描述）
- **服务端 / 前端 / mock 三方各写各的** → 17 处字段名不对齐 + 1 处单位不同 → **P10**

**结论**：契约不是"过期"，是**从未有字段级定义**。根因是**结构性缺口**，不是笔误。

### 5.3.3 主理人点名的第 2 项：券错误码 —— **入表成立，但「前端能正确处理」有条件成立**

**三个核到的事实**：

**① 码表实为 7 个，不是 8 个**
```bash
$ grep -n "1920[1-8]" packages/shared/src/error-codes.ts
  175-181: 19201 19202 19203 19204 19205 19206 19207
$ grep -rn "19208" . --include="*.ts" --include="*.tsx" --include="*.md" | grep -v node_modules
  → 0 命中（全仓无 19208）
```
> 主理人原信写的「`error-codes.ts` 有 19201-19208」——**19208 不存在**。不影响结论，引用数字要改。

**② 映棠的 `enum-guard.ts` 断言的不是错误码**
```bash
$ grep -rn "ERROR_CODES" apps/admin-web/scripts/   → 0 命中
```
`enum-guard.ts` 管的是 `status/type/level/...` 这类**枚举域字段的取值**（`ENUM_FIELD_NAME` 正则），**ERROR_CODES 不在这个机制里**。
→ **主理人转述的那条断言，映棠没做。**

**③ 但前端的错误码处理是「表驱动」的，本来就不需要逐码断言**
```ts
// apps/admin-web/src/api/request.ts:115-117
apiErr.message = ERROR_CODES[apiErr.code]?.message ?? '请求失败';
// packages/shared/src/error-codes.ts:240-242
export function getErrorDef(code) { return ERROR_CODES[code] ?? ERROR_CODES[10009]; }
```
→ 「每个 key 都能找到处理」是**结构性成立**的，**不构成一种风险**。

**真正的风险在两处**：
| 风险 | 实测 | 建议 |
|---|---|---|
| **不在表里的码** | ✅ **差集为 0**（全仓 mock/服务端用码 ⊆ shared 表）—— 当前通过 | 做成门禁，防将来自造码 |
| **契约速查表覆盖不全** | 契约只提 **79** 个码，shared 表有 **155** 个 → **76 个查不到**（11008/12003/13003/.../19201/20001/90005） | ① 补全 ② 或在契约里**明确写「本表为代表例，完整表见 `packages/shared/src/error-codes.ts`」**（现在的写法像全量） |

**建议补的门禁**（不是「每个 key 都能找到处理」）：
```ts
// ① mock/服务端用到的码 ⊆ shared 表（防自造码）
// ② shared 表每个码的 message 非空（防空文案）
// ③ 契约速查表覆盖的码 ⊆ shared 表（防契约写了表里没有的码）
// ④ 契约标注「代表例」而非「全量」（文档层）
```

### 5.3.4 「未发现问题」的正确表述（本轮起全报告统一）

```
✅ 本轮在 <具体维度> 未发现实例。
   证据：<可复现命令 + 实际输出>
   不覆盖：① <具体盲区> ② <具体盲区> ③ <具体盲区>
```

**❌ 反例**：「吞异常型假通过 —— 不存在」（既断言"没问题"，又无证据链，又无边界）

**本轮四条线索的重新表述**（完整版见 L10 文档 §6）：

| 线索 | 本轮表述 |
|---|---|
| 2 · 吞异常 | 本轮在**测试代码**中未发现实例。**不覆盖**：① 生产代码 60+ 处 `.catch()`（已核 8 处关键路径，2 处建议改进）② Promise 链中间层 `await` 缺失 ③ 跨进程错误传播 |
| 3 · 恒真命题 | 本轮逐例推演未发现实例。**不覆盖**：① 动态生成的断言 ② 依赖环境变量分支的断言 ③ 依赖执行顺序的断言 |
| 8 · 不可逆性幻觉 | 本轮在 `coupon` 域未发现实例。**不覆盖**：① 其余 4 个状态机的同目标态路径（P6 仍成立）② 数据库唯一约束与状态机的一致性 ③ 并发下的状态跃迁 |
| 9 · 单跑红全跑绿 | 本轮 12 个守门测试逐个单跑，与全量一致 → 未发现实例。**不覆盖**：① 依赖跨文件 `beforeAll` 的顺序依赖 ② 全局单例污染 |

---

## 6. 本轮 7 项新增对象复核

| # | 对象 | 结论 |
|---|---|---|
| 1 | 券核销双分支（`coupon-deduct.ts` + `order.service.ts:248-266`） | ✅ **质量优秀**。双分支 `SNAPSHOT`/`FALLBACK_TEMPLATE` 有明确 `valueSource` 供断言；回退分支**强制结构化日志**（userCouponId/couponId/type，可grep）；注释写清"没有它就查不出还剩多少券没回填"。测试 6 处断言覆盖两分支。 |
| 2 | 存量券快照回填迁移 | ✅ **正确且有上线闸门**。SQL 用 `JOIN ... WHERE value_snapshot IS NULL`（天然幂等），注释含**上线前必须验证的 SQL**（`COUNT(*) WHERE value_snapshot IS NULL` 必须为 0），并正确处理 `coupons.value IS NULL` 保持 NULL 而非填 0（"快照缺失"≠"面额为0"）。 |
| 3 | 地址密文出参守卫（三层） | ✅ **三层齐备**。`SENSITIVE_KEY_SUFFIXES=['_cipher','_hmac']` → `stripCipherKeys` → `app.use(outboundCipherGuard)` 挂在业务路由前（新接口零成本受保护）。测试含**反例自证**（`:74`「整行直出必被检出」）与 Date/Buffer/超深结构不误报。 |
| 4 | 配置域分组上收（shared 单一权威） | ✅ **已收干净**。实测 6 组 28 键，`doc:check:configs` 段 6.1 双向差集为空；zod 从 `CONFIG_DOMAIN_GROUPS` 派生（加组自动生效）；前端已 re-export shared（双写面消除）；mock 的 10 处手写 configKey 已核实为"变更历史记录"而非定义。✅ **changelog 出参已逐字对齐**：服务端 `beforeValue/afterValue/operator/changedAt` = 前端 `CommissionConfigPage.tsx:124-128` = 契约 §5.7.7.1。 |
| 5 | `community_code` 三处一致 | ✅ 一致。schema `@unique @db.VarChar(32)`、seed 按 code upsert、DATABASE.md §13.6 逐字对齐（含 `GZ_TH_HUAYING` 示例）。**注**：schema 表数已增至 54（见 P4）。 |
| 6 | 错误码 155 码段 + §2 速查表订正 | ✅ **一致**。实测 `error-codes.ts` **155 个码**；契约 §2 已含 22xxx/23xxx/24xxx 三行且代表码与 shared 一致（22001/22002/22005/22006、23001/23002/23004/23005、24001/24002/24003/24004/24006/24007）。 |
| 7 | 契约 §5.7.7 / §5.7.7.1 | ✅ **优秀**。九字段逐字列出；`changedAt ≠ createdAt` 的语义差异专门用引用块解释（"落库列名答'审计何时写入'，出参名答'配置何时被改'"）；`group` 明确"不接受英文 key"；六组 28 键给出严格划分。 |

---

## 7. 「假绿缝隙」可复用检查清单

> 这四类是本项目实际踩过的。建议写进 wiki，所有项目通用。

### A. 机制静默失效（Mechanism Silently Disabled）
- [ ] 每个测试文件**都真的被执行**吗？（磁盘数 === 收集数，且**集合相等**非仅数量）
- [ ] 关键守门测试**在清单里**吗？清单是手写的还是从命名约定派生的？
- [ ] 守门脚本**在 tsc/构建的 include 范围**内吗？（`.ts` 与 `.mjs` 分开确认）
- [ ] 聚合入口存在吗？CI 只调它，还是让人记得逐个跑？
- [ ] 池配置（`pool`/`threads`/`forks`）**固化在配置文件**里，还是靠命令行传？

### B. 恒真命题（Tautology）
- [ ] 有「同一输入自比」的断言吗？（如 `--from-x X --to-x X`）
- [ ] 把被检查对象换成任意垃圾值，断言还成立吗？（反例自证）
- [ ] 断言查的字段 == 被破坏的字段吗？（防"破坏 A、断言 B"）
- [ ] 断言的落点与破坏落点在**同一条数据流**上吗？

### C. 吞异常（Swallowed Exception）
- [ ] 有 `.catch(e => e)` / `.catch(() => {})` 后仍 `expect(true)` 吗？
- [ ] `try { 目标(); expect.unreachable() } catch { 断言 }` 范式用对了吗？
- [ ] 错误被吞后，**退出码与输出**还能暴露失败吗？

### D. 不可逆性幻觉（Irreversibility Illusion）
- [ ] 有哪些状态机的两条路径指向**同一目标态**？准入条件一致吗？
- [ ] 「已投放/已发布/已生效」能否被绕过校验直接到达？
- [ ] 终态是否真的不可逆？（`ENDED` 与 `PAUSED` 必须分开——本项目已做对）

### E. 文档与磁盘（Doc vs Disk）
- [ ] 文档声明的表数/枚举数/码数与磁盘一致吗？
- [ ] 文档说"刻意未落"的东西，**现在落了吗**？（有列无逻辑 /迁移已落但文档未更新）
- [ ] mock 的字段名有自动交叉断言吗？（号段镜像管不到字段名）
- [ ] **grep 命中的数字，是「当前口径声明」还是「历史变更记录 / 注释 / 示例」？**（§5.1 六步法）
- [ ] **你的 grep 范围 == 你在结论里声称的范围吗？**（"全量搜"要有命令为证）
- [ ] mock 与真后端的**字段名 + 单位**一致吗？（`freshnessSec` vs `freshnessMinutes` 这类，编译期查不出来）
- [ ] 契约给了**字段级出参表**吗？还是只有散文描述？（散文 → 三方各写各的）

### F. 报告自审（Report Self-Check）
- [ ] 每个「未发现问题」都写成了「本轮在 N 个维度未发现实例」？
- [ ] 每条都附了「**不覆盖**」清单，且清单**具体到可验证**（不能写「其他情况」）？
- [ ] 自己的**假阳性**写进正文了吗？（本项目已自曝 3 个）
- [ ] 别人的「已核过」都映射到**具体测试文件**，且核过它**在收集清单里**？
- [ ] 每个守门测试都做过**单跑 vs 全跑**对比？（§5.2）
- [ ] 「这条结论如果是错的，会以什么形式暴露？」——**想不出来 → 说明这条结论不可信**

### G. 丢文件 / 崩溃的机制判别（第四轮补全三种）
- [ ] 收集数 < 磁盘数时，**清空 vitest 缓存后重跑**：
  - 恢复全收集 → **机制 2**（并发写同名缓存互相覆盖）
  - 仍不收集 → **机制 1**（EPERM 写盘失败）
- [ ] **退出码 ≥ 128 或 Windows 异常码（如 3221225477）→ 机制 3（native 崩溃）**，不是丢文件
- [ ] **三种机制表象几乎相同** → 所以**常驻断言是唯一防线**
- [ ] 判别时**每次跑前重取磁盘基线**（实测踩到：脚本启动时 34 个，跑到一半队友新增 1 个 → 35）
- [ ] 用了**「只增不减」基线**（存 `.tmp/`，不硬编码期望值）
- [ ] `numTotalTestSuites` **不是文件数**（实测 195 vs 35）—— 文件数取 `testResults.length`
- [ ] **「不传 pool」≠ 默认池**（config 里的 `pool` 会覆盖 CLI 默认）—— 断言「某配置更稳」前先确认它真生效了
- [ ] **「有失败」是测试失败还是环境失败？** —— 换池 A/B 对照，只在某个池下失败 = 环境问题
- [ ] **EXIT=1 不代表有问题，EXIT=0 也不代表健康**（实测 threads 池下 EXIT=1 但收集齐、零失败、stdout 无错误输出）

---

## 8. 复核过但确认没问题的项

> 避免下一个人重复怀疑——这些都实测过且正确。

| 项 | 结论 |
|---|---|
| `prisma:migrate:diff` 同文件自比 | ✅ 已修。`scripts/*.mjs:5` 仅存注释（记录旧写法），脚本已改真迁移链比对；`migrations/` 实存 4 个迁移 |
| `.catch(e=>e)` 型假通过 | ✅ 0 命中。5 处 catch 全为正确范式 |
| 券 `resume` 绕过 `validatePublish` | ✅ 已防御。`validateResume` 独立实现不复用 `canTransition`；`coupon.test.ts:259` 有断言 |
| 券状态回退到 DRAFT | ✅ 不存在回退路径，有全量断言（`:65`） |
| 提现出参银行卡密文 | ✅ 已修 + 守门覆盖 **routes 文件**（曾漏扫点，`companion-income-contract.test.ts:119`） |
| changelog 前后端字段名 | ✅ **逐字对齐**（服务端 :192-201 = 前端 :124-128 = 契约 §5.7.7.1） |
| 配置域 6 组 28 键 | ✅ 与 `SYSTEM_CONFIG_DEFAULTS` 双向差集为空 |
| 活动模块 8 张表 | ✅ 全在 schema（下划线命名，与 §13.8 一致） |
| 密文守卫三层 | ✅ 齐备，且含反例自证 |
| admin-web 门禁在 tsc 范围 | ✅ 已修，且带设计说明注释（`tsconfig.json` include含 `scripts/**/*.ts`） |
| 券快照回填迁移幂等性 | ✅ `WHERE value_snapshot IS NULL` 天然幂等；含上线验证 SQL |
| 置信度 `computeConfidence` 口径 | ✅ 与 §13.3 逐档规则一致，含 `channelCount=2 & crossVerified=false` 边界（0.85×衰减因子、不乘 1.3） |
| `--pool=forks` 在 companion 有效 | ✅ 实测 3 次稳定 2/2（默认池则1–2 随机波动）。⚠️ **根因更正**：稳定源是**配置层固化的 `pool: 'forks' + singleFork: true`**，不是 `run-vitest.js` 的 env 重定向 —— 裸 `npx vitest run`（不走 env）同样 3 次稳定 2/2 |
| ~~server 测试稳定性~~ | ⚠️ **第三轮降级、第四轮撤销（P13）**：根因是 **threads 池 native 崩溃**（机制 3），不是测试本身。**配置层四件套下 14/14 连跑全绿零崩溃**。教训：「池不稳定」与「测试不稳定」都表现为「有失败」，必须看失败发生在哪个阶段 |
| 券错误码「8 个」已入表 | ⚠️ 实为 **7 个**（19201–19207），**19208 全仓 0 命中**。入表成立；且全仓 mock 用码 ⊆ shared 表（差集 0）。但**契约速查表只覆盖 79/155** |

---

## 9. 我不确定 / 无法核验的（诚实边界）

1. **CI 未建**——所有"CI 会跑"列只能标"待接"，无法验证 CI 配置本身是否正确。
2. **EPERM 的完整触发条件**未查明：能观察到它发生（在 companion 默认池稳定复现），但**未能确定 server 为何当前不触发**（同机同版本，差异可能是并发数、文件数或 .vitest-tmp 残留）。因此**不能断言 `pool=forks` 能根治**，只能说"实测有效"。
   **本轮补充（第三轮）**：主理人给出了判别法（清缓存后重跑 → 恢复=机制 2 / 仍不恢复=机制 1）与两种机制的对照表。本轮在 server 上实测：清缓存后 `--pool=forks` 连续 3 次 **35/35/35 稳定，未复现丢失**。
   → **结论：机制 1 / 机制 2 在 server 包上均未触发**，当前由**配置层** `pool: 'forks' + singleFork: true` 稳定。
   → **但我仍未复现主理人观测到的 31/32/33 波动**，故**不能断言「已根治」**。可能原因（未验证）：主理人测的是命令行 `--pool=forks` 单独覆盖，而配置文件里的 `poolOptions.forks.singleFork: true` 依然生效；或环境时序差异。
   → **「fileParallelism: false 在所有包上是否有效」这个问题在 miniapp-user / admin-web 上不成立** —— 它们磁盘 0 个测试文件，**没有测试可丢**。这类包应显式标注「无测试」而非静默跳过（`check-test-collection.ts` 已做对）。
3. **破坏法报告本轮未产出**：仓库里仅 `order.sos.test.ts` 带破坏法标记，未找到系统性的破坏法验证机制，故线索 2 的判定是"逐例推演未发现错位"，**不等于"有机制保证不错位"**。
4. **`order.service.ts:248-266` 行号**采自主理人告知，我未逐字核对该具体行区间的全部内容（核了 `coupon-deduct.ts` 与 wiring 测试的断言同源性）。
5. **~~P13 的随机失败未定位~~** → **第四轮已定位并撤销 P13**：根因是 **threads 池的 native 崩溃**（机制 3，EXIT=139/0xC0000005），配置层四件套下 14/14 全绿。**遗留**：崩溃的具体 native 栈未取（需 core dump / Windows 事件查看器），**未定位是哪个 native 模块崩的**。
6. **P10 的三方字段差集只覆盖 `/admin/activity/elders` 一个端点**。本项目其他端点（尤其 `dashboard` / `alerts` / `funnel` / `revenue`）**未做同样核验** —— 同一模式可能普遍存在。**不覆盖**：其余 4 个管理端端点 + 全部用户端/陪聊员端端点。
7. **P11 只核了服务端 8 处关键 `.catch()`**。前端 50+ 处 `.catch(() => null)` **未逐条核**（多数是 UI 降级，合理），但**未核**是否存在「吞掉业务错误」的前端案例。

---

**报告结束**｜ 顾图南（Silas Frame）｜ rnd-linban｜ 2026-10
本报告只读审计，未修改任何代码。所有命令与行号可复现。