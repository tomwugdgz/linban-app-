# 邻伴 · API 契约（API-CONTRACT.md）

| 项 | 值 |
|---|---|
| 版本 | v1.2（新增 §13 健康活动感知 `/activity`，与 ARCHITECTURE.md v1.6 §13 / DATABASE.md v1.2 §8 对齐） |
|  Base URL | `https://<域名>/api/v1`（开发 `http://127.0.0.1:3000/api/v1`） |
| 协议 | HTTPS + JSON（小程序要求已备案域名，见架构 §1.3） |
| 实现 | `apps/server/src/modules/**`（Express 4 + TypeScript，模块化单体） |
| 状态 | 骨架 + 核心链路已实现；标注 `骨架` 的端点已可联调、业务规则待补 |

## 0. 阅读约定

- **数据三态**（DATABASE.md §11 附带决议，与架构师预对齐）：
  - `R` 只读投影：接口出参即业务视图，无敏感字段；
  - `A` 受限：仅授权角色/本人可见（如子女看老人订单需 family_bindings 授权等级）；
  - `X` 不出接口：objectKey、密文列（`*_cipher`/`*_hmac`）、内部规则明细一律不出参，文件访问走 `POST /files/:id/access-url` 换临时 URL。
- **消费端**：`用户端`（老人/子女小程序）、`陪聊员端`（陪聊员小程序）、`后台`（admin-web）、`客服`（admin-web cs 角色）、`系统`（worker/cron/回调）。
- 所有金额字段为**字符串化的分**（BigInt 序列化，如 `"50000"` = ¥500）；所有时间为 ISO-8601 UTC（`2026-09-01T13:00:00.000Z`），展示层转 Asia/Shanghai。
- 所有 ID 为字符串化 BigInt。

---

## 1. 通用约定

### 1.1 统一响应信封

```jsonc
// 成功
{ "code": 0, "data": { }, "requestId": "req_xxx" }
// 失败（HTTP 状态码仍为 200，业务码见 code；4xx/5xx 仅用于框架级错误）
{ "code": 14002, "message": "订单状态不允许该流转", "requestId": "req_xxx" }
```

- `requestId` 全链路透传（中间件生成，日志/响应头 `X-Request-Id` 一致），排查必带。
- 分页出参统一 `{ list, total, page, pageSize }`。

### 1.2 鉴权

| 头 | 值 | 说明 |
|---|---|---|
| `Authorization` | `Bearer <accessToken>` | 用户端/陪聊员端（`POST /auth/wx-login` 等签发） |
| `Authorization` | `Bearer <adminToken>` | 后台/客服（`POST /auth/admin-login` 签发，RBAC 见 §5） |

- accessToken TTL 2h，refreshToken 30d（`POST /auth/refresh` 轮换）。
- 后台账号另受登录失败锁定（30min，`system_configs` 化）与 TOTP（敏感角色，otplib）。

### 1.3 幂等

- 所有**写操作**（POST/PUT）接受 `Idempotency-Key` 头（8–128 位字母数字，如 `order:create:<uuid>`）。
- 服务端 Redis 占位 `idem:<key>`（24h）：命中已完成结果直接回放；冲突进行中返回 `10009`。
- 支付回调、领券、下单、发起支付等资金/资产敏感端点**必须**携带。

### 1.4 限流

- 登录 5 次/分/IP+账号（`LOGIN_RATE_LIMIT_PER_MIN`）；下单 10 次/分/用户。
- 超限 `429` 框架级错误，信封 `code: 10010`。

---

## 2. 错误码速查（`packages/shared/src/error-codes.ts` 为单一事实源）

| 段 | 域 | 代表码（码义以 `error-codes.ts` 的 `message` 为准） |
|---|---|---|
| 0 | 成功 | `0` |
| 10xxx | 通用（参数/认证/权限/限流/幂等/资源/系统） | `10001` 请求参数校验失败、`10002` 未登录或登录已过期、`10003` 访问令牌已过期、`10004` 无权限访问、`10005` 操作过于频繁、`10006` 重复提交内容不一致（幂等冲突）、`10007` 资源不存在、`10008` 资源状态冲突、`10009` 内部错误、`10010` 依赖服务暂不可用 |
| 11xxx | 认证（微信/后台账密/TOTP） | `11001` 微信 code 无效或已过期、`11002` 微信登录失败、`11003` 手机号已绑定、`11004` 账号已冻结、`11005` 账号已注销、`11006` 账号或密码错误、`11007` 需二次验证 |
| 12xxx | 用户/家庭绑定 | `12001` 老人档案不存在、`12002` 绑定关系已存在 |
| 13xxx | 陪聊员（入驻/信用/保证金） | `13001` 陪聊员不存在、`13002` 入驻申请不存在、`13004` 四审流程不允许的流转 |
| 14xxx | 订单（状态机/时段） | `14001` 订单不存在、`14002` 订单状态不允许该操作、`14003` 该时段已被占用、`14007` 夜间订单需子女端确认、`14015` 订单金额不一致 |
| 15xxx | 支付/分账/退款/提现 | `15006` 分账校验未通过（已暂停并告警）、`15013` 微信退款失败、`15015` 提现金额超出限额、`15016` 提现需完成人脸/短信二次验证、`15017` 提现单状态不允许该操作 |
| 16xxx | 核销（动态码/人脸/GPS/完成确认） | `16002` 动态码不正确、`16003` 动态码已过期、`16004` 动态码错误次数过多、`16005` 人脸比对未通过、`16007` 签到位置偏离服务地址过远、`16009` 核销已过期、`16010` 需双方确认后才能完成订单 |
| 17xxx | IM（会话/消息/隐私号） | `17001` 会话不存在、`17003` 消息包含违规内容已被拦截、`17005` 隐私号绑定已过期 |
| 18xxx | AI（会话/Provider 降级） | `18001` AI 会话不存在、`18004` 陪聊助手暂不可用 |
| 19xxx | 营销（券/时长卡/评价/保险） | `19001` 本单该方向已评价、`19003` 评价窗口已关闭、`19203` 时长卡已过期、`19204` 券模板不存在、`19205` 优惠券不可用 |
| 20xxx | 风控（举报/投诉/SOS） | `20003` 风控事件不存在、`20005` 举报已处理 |
| 21xxx | 后台（RBAC/配置） | `21001` 后台账号不存在、`21003` 配置项不存在或不允许修改 |
| 22xxx | 健康活动感知·采集与授权 | `22001` 未开启授权无法采集、`22002` 感知设备未绑定、`22005` 设备令牌校验失败、`22006` 采集已停止（本人已关闭） |
| 23xxx | 健康活动感知·查询与看板 | `23001` 感知数据尚未就绪（需 3–7 天积累）、`23002` 数据置信度不足、`23004` 无权查看该老人的健康活动数据、`23005` 暂无活动日报 |
| 24xxx | 健康活动感知·告警处置 | `24001` 健康告警不存在、`24002` 该告警已处置、`24003` 同类告警处于抑制窗口内、`24004` 交叉验证不足需人工确认、`24006` 告警级别与触发条件不匹配、`24007` 告警状态不允许该流转 |
| 90xxx | 系统（依赖故障） | `90001` 数据库服务异常、`90002` 缓存服务异常、`90003` 任务队列异常、`90004` 第三方服务异常 |

> **本次订正（2026-10，苏映棠据`error-codes.ts` 逐条核对）**：原表 26 处代表码与实际 `message` 语义错配，
> 其中**4 处指错了码**（不是措辞不准，是指向了另一个功能的码）：
> 「`10009` 幂等冲突」实为 `10006`；「`10010` 触发限流」实为 `10005`；
> 「`11001` 未登录」实为 `10002`；「`11002` token 过期」实为 `10003`；
> 「`21001` 缺少权限」实为 `10004`。**原表还有一个四位形态的码**（写作「第三方超时」的四位数），
> 而 90xxx 段实际是 `90001` 数据库 / `90002` 缓存 / `90003` 队列 / `90004` 第三方 四位**五段码**——
> 即90xxx 段的码是五位数，原表把它写成了四位数，且第三方异常的正确码是 `90004`。
>
> **教训（与本轮其他漂移同源）**：代表码表靠人写就会漂。**速查表只登记「段 → 域」，
> 具体码义一律以 `error-codes.ts` 的 `message` 为单一事实源**，本表只作导航用。
> admin-web冒烟已加断言：`packages/shared` 的 `ERROR_CODES` 每个 key 都能在前端错误提示中
> 找到对应处理，且 `10008`（券状态冲突）等本轮新增场景的码**必须已进 `error-codes.ts`**
> ——「文档有码、代码没有」是今天已抓到三处的漂移，不能成为第四处。

> `GET /api/v1/error-codes` 返回全量表（三端共用，勿在前端硬编码枚举）。
> 25xxx 起留空给 W+1/W+2（网关硬件接入、订阅付费闭环），见 §13.11。

---

## 3. 用户小程序端（老人 / 子女）

挂载前缀见各表。`A` 态说明见 §0。所有端点默认 `authMiddleware`。

### 3.1 认证与账号 `/auth`、`/users`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/auth/wx-login` | R | 微信登录（code→openid）；新用户默认 `ELDER` 角色 |
| POST | `/auth/phone-login` | R | 手机号+验证码登录（验证码走 `/auth/sms-code`） |
| POST | `/auth/sms-code` | R | 发送短信验证码（限流 1/分/手机号） |
| POST | `/auth/refresh` | R | refreshToken 轮换 accessToken |
| POST | `/auth/logout` | R | 登出（Redis 会话失效） |
| GET | `/auth/profile` | R | 我的令牌载荷视图 |
| POST | `/auth/phone` | R | 绑定/换绑手机号（密文+盲索引，X 态不出） |
| GET | `/users/me/profile` | R | 我的完整资料（含老人档案脱敏视图） |
| PUT | `/users/me/elder-profile` | R | 创建/更新老人档案（子女需 PROGRESS+ 授权，A） |
| POST | `/users/family-bindings` | R | 子女发起绑定（老人确认后生效；active_key 守卫） |
| GET | `/users/family-bindings` | R | 我的绑定列表（双向视角） |
| POST | `/users/family-bindings/:id/confirm` | R | 老人确认绑定（置 active_key='A'） |
| POST | `/users/family-bindings/:id/revoke` | R | 解除绑定（双向可发起，释放唯一位） |
| GET | `/users/:id/brief` | R | 他人简卡（脱敏：无手机号/证件/地址） |
| POST | `/users/me/cancel-request` | R | 注销申请（15 天冷静期；有进行中订单拒绝，`10008`） |

### 3.2 下单与服务流 `/orders`

状态机：12 态（`domain/order-state-machine.ts`），非法流转 `14002`。时段防重双防线：Redis `lock:slot:*` + DB 唯一索引 `(companion_id, service_date, slot_start, slot_guard)`。

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/orders` | R | 创建订单（金额=时长×时薪+平台费，BigInt 分；夜间单 22:00–06:00 需子女确认） |
| GET | `/orders` | R | 我的订单列表（角色视角：本人/被授权老人） |
| GET | `/orders/:id` | A | 订单详情（买卖双方+授权子女） |
| POST | `/orders/:id/cancel` | R | 取消（ACCEPTED 后收 10% 违约金补偿陪聊员，`CANCELLATION_FEE_RATE_BP`；已支付走退款） |
| POST | `/orders/:id/night-confirm` | A | 夜间单子女确认（确认人须为该老人生效绑定中的子女，`12004`；时限 30min 自下单起算，超时 sweep 自动取消+全额退款；老人本人成年自确认豁免见 §8） || POST | `/orders/:id/confirm` | R | 完成确认（老人侧；支持语音「满意」ASR 文本透传） |

派单/抢单/到岗/开始/完成见 §4.2（陪聊员侧动作）。`GET /orders/dispatch/pool` 为派单池（系统/后台调试用，A）。

### 3.3 支付 `/payments`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/payments/prepay` | R | 发起支付（返回 `wx.requestPayment` 参数；幂等必填） |
| GET | `/payments/order/:orderId` | A | 订单支付单/退款单/分账记录查询（只读流水） |

回调（系统）：`POST /payments/wx/notify`（支付）、`POST /payments/refund/wx/notify`（退款）——验签+幂等，不出现在客户端契约。

### 3.4 核验配合 `/verifications`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| GET | `/verifications/order/:orderId` | A | 订单核验记录（三关：动态码/人脸/GPS；分数阈值走 `system_configs`） |

到岗码下发（陪聊员展示、老人核对）见 §4.3。

### 3.5 营销 `/marketing`、评价 `/reviews`、保险 `/insurance`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| GET | `/marketing/coupons` | R | 可领券模板列表 |
| POST | `/marketing/coupons/:couponNo/claim` | R | 领券（同模板一张 UNUSED，`19206`） |
| GET | `/marketing/coupons/mine` | R | 我的券 |
| POST | `/marketing/gift-cards` | R | 购买孝心时长卡（金额+时长双余额；支付联动 TODO） |
| GET | `/marketing/gift-cards/mine` | R | 我的时长卡（购买/受赠/绑定三视角） |
| POST | `/marketing/gift-cards/bind` | R | 受赠人凭手机号盲索引绑定 |
| POST | `/reviews` | R | 提交评价（COMPLETED 后 7 天；每单每方向一条 UK；好评 +1/差评 −3 信用分） |
| GET | `/reviews/mine` | R | 我发出的评价 |
| GET | `/reviews/companion/:companionId` | R | 陪聊员收到的评价（匿名隐藏内容） |
| POST | `/reviews/:id/reply` | R | 被评价方回复（一次） |
| POST | `/insurance/orders/:orderId/bind` | R | 订单投保绑定（保单号回填） |
| GET | `/insurance/orders/:orderId` | A | 订单保单查询 |
| POST | `/insurance/policies/:policyNo/claim` | R | 出险报案（半自动：登记+经纪API TODO） |
| GET | `/insurance/policies` | R | 我的保单列表 |

### 3.6 陪聊员发现 `/companions`（用户态）

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| GET | `/companions/nearby` | R | 附近陪聊员（距离衰减+标签+信用+等级+评分加权，`domain/dispatch.ts`） |
| GET | `/companions/:id` | R | 陪聊员公开卡（`CompanionPublicDTO` 脱敏：无证件/真名/手机号） |

---

## 4. 陪聊员小程序端

### 4.1 入驻四审（10 态，`domain/application-state-machine.ts`）

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/companion/applications` | R | 提交入驻申请（四审流起点） |
| GET | `/companion/applications/me` | R | 我的申请与当前阶段 |
| POST | `/companion/applications/me/realname` | R | ①实名（OCR+二要素，adapter mock） |
| POST | `/companion/applications/me/face` | R | ②人脸底照（慧眼，adapter mock） |
| POST | `/companion/applications/me/criminal` | R | ③无犯罪材料上传（人工审核，无开放 API） |
| POST | `/companion/applications/me/training-complete` | R | ④培训认证完成 |
| POST | `/companion/applications/me/exam` | R | ④考试（≥80 通过，`isExamPassed`） |
| POST | `/companion/applications/me/deposit` | R | 保证金缴纳（默认 ¥500=50000 分，`deposit_amount`） |

### 4.2 接单与服务流 `/orders`（陪聊员动作）

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/orders/:id/grab` | R | 抢单（Redis 锁+DB guard 双防重；失败 `14003`） |
| POST | `/orders/:id/arrive` | R | 到岗（触发核验三关：动态码+人脸+GPS） |
| POST | `/orders/:id/start` | R | 开始服务（→ IN_SERVICE） |
| POST | `/orders/:id/finish` | R | 完成服务（→ PENDING_CONFIRM，等待双方确认） |

派单推送（系统）：`rankDispatchCandidates` Top N → 订阅消息；30min 无人接单转人工（`dispatch_timeout_min`，cron `sweepDispatchTimeout`）。

### 4.3 核验生产 `/verifications`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/verifications/arrival-code` | R | 下发到岗动态码（老人端展示 6 位；TTL `dynamic_code_ttl`） |
| POST | `/verifications/cs-completion` | R | 客服代录完成确认（留痕 operator_id） |
| POST | `/verifications/suspend` | R | 挂起订单（→ SUSPENDED，进客服裁决） |

### 4.4 我的工作台 `/companion`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| GET | `/companion/me` | R | 我的陪聊员主档（信用分/等级/保证金/评分） |
| GET | `/companion/me/credit-logs` | R | 信用分明细（只增不改） |
| GET | `/companion/me/deposit-txs` | R | 保证金流水（缴纳/罚扣/退还） |
| GET | `/companion/schedules` | R | 我的可约日程 |
| PUT | `/companion/schedules` | R | 更新日程（时段防重：与存量单冲突拒绝） |

---

## 5. 管理后台 / 客服（admin-web）

统一 `Authorization: Bearer <adminToken>`；RBAC 四角色 `admin/ops/finance/cs`（`middlewares/auth.ts` 静态映射，`prisma/seed.ts` 落库双写）。缺权限 `21001`。

**权限粒度口径（主理人裁定，2026-10）**：**W-MVP 统一用模块级**（`order:*` / `payment:*` / `risk:*` / `companion:*` / `recon:*` / `withdrawal:*` / `marketing:*` / `verification:*` / `report:*` / `complaint:*` / `review:*` / `support:*` / `commission:*` / `config:read` / `user:read` / `risk:read` / `marketing:read` / `*`）。像 `order:refund:approve` 那样的**按钮级权限点只在 W+1 引入**，且引入时须同步三处双写面（`prisma/seed.ts` ROLE_PERMISSIONS + `middlewares/auth.ts` ROLE_PERMISSIONS + admin-web 按钮级权限），不能只改一处。

**权限匹配规则（主理人裁定，2026-10 修正）**：`adminPermGuard` 按三条匹配——① 精确命中；② **模块级通配**（持 `risk:*` 者对 `risk:read` 亦通过）；③ 超管 `*` 通过全部。修正原因：原实现只做精确匹配，会导致超管被拒、`risk:*` 匹配不上 `risk:read`，后台功能实际不可用。

**营销域权限点（主理人裁定，2026-10）**：营销后台端点此前**权限面完全空白**（只有用户端 `/marketing/*`），补 `marketing:read`（只读）与 `marketing:*`（券创建发放暂停恢复/时长卡发放/团长佣金结算/老带新规则）。

### 5.1 系统与看板 `/admin`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/me` | 登录即可 | 我的账号与权限点 |
| GET | `/admin/dashboard` | 登录即可 | 经营看板（GMV/单量/分账冻结额） |
| GET | `/admin/configs` | `config:read` | 系统配置列表 |
| PUT | `/admin/configs/:key` | `config:read` | 热更新配置（Redis `cache:config` 失效+audit_logs；仅限种子表已声明键；`split_mode` 有枚举白名单校验，R1 资质风险时一键切 `manual_settlement_fallback`） |
| GET | `/admin/audit-logs` | `config:read` | 后台操作审计（before/after JSON） |

### 5.2 陪聊员审核 `/admin`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/companion-applications` | `companion:*` | 四审工作台（按阶段筛选） |
| POST | `/admin/companion-applications/:no/criminal` | `companion:*` | ③无犯罪审核裁定 |
| POST | `/admin/companion-applications/:no/deposit-confirm` | `companion:*` | 保证金到账确认（进账即激活接单资格） |
| POST | `/admin/companions/:id/credit` | `companion:*` | 手动调整信用分（留痕 credit_logs） |
| POST | `/admin/companions/:id/status` | `companion:*` | 陪聊员状态（限流/冻结/清退，联动阈值配置） |

### 5.3 分账与财务 `/admin`（铁律：资金动作可审计）

分账门闩（`domain/sharing-gate.ts`，缺一不可）：订单 `COMPLETED` + 核销 `PASSED` + 人脸分≥阈值 + GPS 偏差≤阈值 + 无未决风控 + 分账单 `FROZEN` + retry<3。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/sharings/frozen` | `payment:*` | 冻结分账单列表（待分账/重试中） |
| POST | `/admin/sharings/:sharingNo/manual-settle` | `payment:*` | 手动结算（兜底模式 `manual_settlement_fallback`） |
| POST | `/admin/sharings/sweep-stale` | `payment:*` | 清理僵死分账（>7 天告警，`SHARING_STALE_ALERT_DAYS`） |
| POST | `/admin/withdrawals/:no/review` | `withdrawal:*` | 提现审核（W7+ 启用，表已预留） |
| POST | `/admin/recon/run` | `recon:*` | 触发每日对账（支付/退款/分账三方流水比对） |
| GET | `/admin/recon/batches` | `recon:*` | 对账批次与差异明细 |
| GET | `/payments/split-mode` | 登录即可 | 当前分账模式（`wechat_profit_sharing` \| `manual_settlement_fallback`，由 `system_configs.split_mode` 驱动，DB 优先+环境回落；后台与陪聊员端共用） |

### 5.4 风控与举报 `/admin`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/risk/events` | `risk:*` | 风控事件队列（CRITICAL 优先） |
| POST | `/admin/risk/events/:eventNo/handle` | `risk:*` | 处置风控事件（WARN/INTERCEPT/LIMIT/PENALTY/BAN） |
| POST | `/admin/reports/:reportNo/handle` | `report:*` | 举报核查（属实→奖励券 2000 分+飞单 −20 分清退） |

> **🔴 实现缺口（2026-10 苏映棠核出，待霍承钧修）**：`riskAdminRouter` 的两条 `/events`
> 路由**只注册了相对路径 `/events`**，而它被挂在 `apiRouter.use('/admin', riskAdminRouter)`
> （`apps/server/src/routes/index.ts:59`）下 —— **实际路径是 `/admin/events`，
> 不是本表登记的 `/admin/risk/events`**。
>
> **为什么难发现**：契约、本文件、服务端源码注释（`risk.routes.ts:274`
> 写的就是 `GET /admin/risk/events`）三处**都写对了**，唯独运行时的挂载少了一层。
> 注释与契约是「人类可读的意图」，路由挂载是「运行时的事实」，两者不一致时
> 只看注释/契约永远发现不了。且服务端**无任何集成测试调过这两个端点**，
> 缺口从未被测出来（mock router 自认旧路径，mock 模式下页面也完全正常）。
>
> **修法**：`risk.routes.ts` 的两条注册改为 `'/risk/events'` / `'/risk/events/:eventNo/handle'`。
> ⚠️ **第 337 行的 `/reports/:reportNo/handle` 不用动**——它实际路径 `/admin/reports/...`
> 与本表登记一致，给它加 `/risk` 反而会错。
>
> **防漂移**：`apps/admin-web` 的冒烟里有「风控路径门禁」，从 `routes/index.ts` 的
> `apiRouter.use()` 挂载语句**推导**真实前缀再与前端 API 层逐条对账，
> 承钧改完即自动转绿（已用破坏法双向验证：服务端改对→转绿，前端退回旧路径→转红）。

**`risk_events.type` 的两类语义（前端必须分开渲染，不可混为一谈）**：

| 类别 | 取值 | `subject_type` | 处置对象 |
|---|---|---|---|
| **用户风险** | `SENSITIVE_WORD` / `GPS_DEVIATION` / `CANCEL_RATE` / `OFFLINE_SUSPECT` / `SOS` / `ABNORMAL_ORDER` | `USER` / `COMPANION` / `ORDER` / `IM_MESSAGE` | **用户**（WARN/INTERCEPT/LIMIT/PENALTY/BAN） |
| **系统级告警** | `OUTBOUND_CIPHER_LEAK` | `API` | **代码**（出参脱敏缺陷，不是任何用户的行为） |

> `OUTBOUND_CIPHER_LEAK` 由服务端 `middlewares/outbound-cipher-guard.ts` 在
> **production** 环境剥离 `_cipher` / `_hmac` 字段时自动落库，
> `level: CRITICAL` / `status: PENDING`。其 `hit_detail` **只含路径与被剥离的键名，
> 不含任何字段值**（告警记录本身不得成为新的泄漏源）。
>
> **前端若按「用户行为异常」渲染这条，运营会误判**（把服务端代码缺陷当成用户违规处理，
> 反而把真问题关单）。admin-web 侧已按此口径实现：类型文案「系统告警：出参密文泄漏」、
> 详情弹窗顶部红 Alert「系统级告警：不是用户风险」、处置动作候选收敛为仅 `WARN`。

### 5.5 客服 `/admin`（cs 角色）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/dispatch-timeout` | 登录即可 | 派单超时候补工单（>30min 无人接单） |
| POST | `/admin/orders/:id/decide` | `order:*` | 挂起订单裁决（COMPLETE/PARTIAL_REFUND 50%/FULL_REFUND） |
| GET | `/admin/revisits` | 登录即可 | 回访任务列表（完成后关怀） |

用户侧举报/投诉/SOS 入口：`POST /risk/reports`、`POST /risk/complaints`、`POST /risk/sos`（SOS：建 CRITICAL 风控事件 → 到岗态订单立即挂起 → URGENT 投诉工单 → 紧急联系人模板短信 + 绑定子女 IM 通知，P0）。

### 5.6 保险与文件 `/admin`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/policies` | 登录即可 | 保单台账（批量投保半自动对账） |
| GET | `/admin/files` | 登录即可 | 文件元数据台账（objectKey 为 X 态，不出参） |

### 5.7 后台既有页面已用但此前未登记的端点（2026-10 补登记，共 48 项）

> 背景：admin-web 27 个页面早已在跑（走本地 mock），这批端点**服务端此前未落、契约亦未登记**。
> 缺口由苏映棠用脚本机械比对（解析契约端点表 vs mock 路由表，路径变量归一后取差集）查出：
> 契约登记 120 / 前端已实现 77 / **缺口 45**。主理人独立复现差集，数字与清单逐条一致。
> 命名统一：`changelogs` → **`changelog`**（单数，与既有 `/admin/audit-logs` 风格一致）。
> 权限一律模块级；`/auth/admin-login` 属**表格遗漏**（§1.2 已述及），仅补登记不需新实现。

#### 5.7.1 经营看板
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/dashboard/trend` | 登录即可 | 经营趋势（订单/流水/活跃） |
| GET | `/admin/dashboard/todos` | 登录即可 | 待办事项；含健康告警类事项时仅 `risk:read` 可见全量 |

#### 5.7.2 订单管理
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/orders` | `order:*` | 订单列表（分页/筛选） |
| GET | `/admin/orders/:id` | `order:*` | 订单详情：状态机时间线/核销记录/分账记录；**双方信息一律脱敏**（手机号、地址按既有脱敏口径，后台亦非明文） |

#### 5.7.3 分账与财务
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/sharings` | `payment:*` | 分账流水列表 |
| GET | `/admin/sharings/export` | `payment:*` | 分账流水导出 |
| GET | `/admin/withdrawals` | `withdrawal:*` | 提现申请列表（审核动作见 §5.3） |
| GET | `/admin/commissions` | `commission:*` | 佣金结算单列表 |
| POST | `/admin/commissions/:id/settle` | `commission:*` | 佣金结算执行（资金动作，须可审计） |
| POST | `/admin/recon/batches/:batchNo/resolve` | `recon:*` | 对账差异处理 |

#### 5.7.4 陪聊员与黑名单
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/companions` | `companion:*` | 陪聊员列表（**须过滤 `users.is_system=true`**，系统账号不计入陪聊员口径） |
| GET | `/admin/companion-applications/:no` | `companion:*` | 入驻申请详情（四审进度） |
| POST | `/admin/companion-applications/:no/realname` | `companion:*` | 实名审核通过 |
| POST | `/admin/companion-applications/:no/face` | `companion:*` | 人脸审核通过 |
| POST | `/admin/companion-applications/:no/exam-pass` | `companion:*` | 培训考试通过 |
| POST | `/admin/companion-applications/:no/activate` | `companion:*` | 激活入驻（四审全过） |
| GET | `/admin/blacklists` | `companion:*` | 黑名单列表 |
| POST | `/admin/blacklists` | `companion:*` | 加入黑名单 |
| POST | `/admin/blacklists/:id/lift` | `companion:*` | 解封 |

#### 5.7.5 风控：投诉 / 举报 / 抽检
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/complaints` | `complaint:*` | 投诉工单列表 |
| POST | `/admin/complaints/:complaintNo/handle` | `complaint:*` | 投诉处理与补偿 |
| GET | `/admin/reports` | `report:*` | 飞单举报列表 |
| POST | `/admin/reports/:reportNo/reward` | `report:*` | 举报属实发放奖励（资金动作） |
| GET | `/admin/sampling-tasks` | `risk:*` | 抽检任务列表 |
| POST | `/admin/sampling-tasks/:taskNo/review` | `risk:*` | 抽检结论录入 |

#### 5.7.6 营销后台（权限点本轮新增，见 §5 前言）
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/gift-cards` | `marketing:read` | 孝心时长卡模板列表 |
| POST | `/admin/gift-cards/issue` | `marketing:*` | 时长卡发放 |
| GET | `/admin/distributors` | `marketing:read` | 社区团长列表 |
| POST | `/admin/distributors/:id/settle-all` | `marketing:*` | 团长佣金批量结算（资金动作） |
| GET | `/admin/coupons` | `marketing:read` | 券模板列表 |
| POST | `/admin/coupons` | `marketing:*` | 创建券模板 |
| POST | `/admin/coupons/:id/grant` | `marketing:*` | 发放券 |
| POST | `/admin/coupons/:id/pause` | `marketing:*` | 暂停券 |
| POST | `/admin/coupons/:id/resume` | `marketing:*` | 恢复券 |
| GET | `/admin/coupons/:id/user-coupons` | `marketing:read` | 券领取明细 |
| GET | `/admin/invite-rules` | `marketing:read` | 老带新规则列表 |
| PUT | `/admin/invite-rules/:id` | `marketing:*` | 修改老带新规则 |

##### 5.7.6.1 券模板写操作补登记（2026-10，苏映棠编写，霍承钧实现）

> 背景：`coupons` 表（schema:1421）字段齐备，但**只有 create/grant/pause/resume 四个动作**，
> 没有「编辑」「投放」「结束」——运营改个门槛只能新建模板，投放到期只能手工改 DB。
> 下面 3 个端点是补齐「schema 有字段但无对应写操作」的缺口。
>
> **`POST /admin/coupons` 状态语义修订**：创建后落 `DRAFT`（草稿），**不落 `ACTIVE`**。
> 原实现直接落 ACTIVE 有两个问题：① 券面额是资金口径，不该建完就直接对外发；
> ② 没有「先建后审」这一步，建错即发出去只能靠暂停止损。需投放请显式调 `publish`。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| PUT | `/admin/coupons/:id` | `marketing:*` | 编辑券模板。**禁止修改已发放券（`claimed_count > 0`）的 `value`**，见下方硬约束 |
| POST | `/admin/coupons/:id/publish` | `marketing:*` | 草稿 → 投放中。仅 `DRAFT` 可调，非草稿态回 `10008` |
| POST | `/admin/coupons/:id/end` | `marketing:*` | **结束投放（不可逆）**，落`ENDED`。与 `pause` 语义分离：`pause` 可恢复，`end` 不可 |

**入参**（`PUT`，全字段可选，只传要改的）：

```jsonc
{
  "name": "重阳节陪伴券",
  "type": "FULL_REDUCTION",       // FULL_REDUCTION | DURATION
  "value": 3000,                    // 见下方「value 单位」；字符串或整数均可，禁止小数
  "minSpendFen": "10000",           // 字符串化的分（BigInt），"0" = 无门槛
  "validDays": 30,
  "totalCount": 0,                  // 0 = 不限量
  "scopeRules": { "serviceTypes": ["CHAT"], "minOrderFen": 12000 },  // 可选，null = 全量可用
  "startAt": "2026-10-01T00:00:00.000Z",// 可选，null = 长期
  "endAt": "2026-11-01T00:00:00.000Z"   // 可选，必须晚于 startAt
}
```

**出参**：`Coupon`（同 `GET /admin/coupons` 的元素结构）。

**幂等与错误码**：

| 码 | 场景 | 说明 |
|---|---|---|
| `10001` | `claimed_count > 0` 时改 `value` | 通用参数错误 + 文案必须写清技术原因（见下方硬约束） |
| `10001` | `total_count` 非 0 且小于 `claimed_count` | 会导致超发（库存负数） |
| `10001` | `endAt <= startAt` | 投放期倒挂 |
| `10001` | `value <= 0` 或非整数 | 面额必须正整数 |
| `10001` | `type` 与既有 `value` 量纲不匹配（如 `DURATION` 券传 `value: 500` 分） | 单位随 type 变，跨类型值域须校验 |
| `10008` | `publish` 时非 `DRAFT` / `pause` 时非 `ACTIVE` / `resume` 时非 `PAUSED` | 状态机守卫，非法流转 |
| `10008` | `end` 时已是 `ENDED` | 幂等：重复调用直接返回当前态或该码，二选一但须在实现时定死 |
| `10008` | 编辑非 `DRAFT` 券的资金口径字段 | 须重审：状态回退 `DRAFT`（见下方「资金口径字段改动须重新审核」）。**并发编辑用同码**：`updateMany` 前置条件 `count===0` 时也回此码，文案须写「券已被他人修改，请刷新后重试」以区分 |
| `19204` | 券模板不存在 | |

> **本节所有码均已存在于 `error-codes.ts`，无需新增**（2026-10 核过）：
> `10001` PARAM_INVALID / `10008` CONFLICT（`10008` 是通用「资源状态冲突」段，
> 券状态流转与并发冲突共用它，**不要为券域另开码**）/ `19204` COUPON_NOT_FOUND /
> `19205` COUPON_NOT_AVAILABLE / `19207` COUPON_MIN_SPEND。
> 「文档有码、代码没有」是本轮已抓到三处的漂移，故此处显式声明「无需新增」，
> 避免下一个人以为漏登记而去 `error-codes.ts` 里重复造一个码。
>
> **特别注意`10008` vs `19205` 的分工**（霍承钧第一版曾用 19205，被纠正）：
> `10008` = **状态不对**（草稿不能pause）；`19205` = **券本身不可用**（已用/已过期/超门槛）。
> 前者运营要改操作顺序，后者券确实不能用了——用错会让运营以为「券坏了」。

**硬约束：`user_coupons` 无面值快照，已发放券禁止改面额**

`user_coupons`（schema:1446）**只有 `coupon_id`，没有面值快照字段**；核销时
（`order.routes.ts:141` / `order.service.ts:227`）走 `coupon_deduct_fen`，需**实时 JOIN
`coupons` 模板读 `value`**。因此改模板面额 = 用户已领取的券面额跟着一起变：

> 运营把 ¥50 券改成 ¥100 → 所有存量已领券**立即变¥100** → 直接资损，且用户无感知。

所以这是**技术性不可协商**，不是产品偏好。要降面值请新建模板。
已发放券**允许**改：`name` / `startAt` / `endAt` / `totalCount`（扩量）/ `scope_rules`。

> **✅ schema 改动已放行（主理人 2026-10）**：`user_coupons` 加 `value_snapshot Int?`
> （schema:1486）。注释口径：「领取时从模板快照面值；**null 表示历史数据未快照，
> 核销时回退读模板**」。
>
> **本轮只改 schema 与契约，不落 migration** ——实际 DDL 等霍承钧 A 组做完一起走增量，
> 避免又撞迁移时间窗。DDL 未落库前，核销逻辑**必须**走「快照优先、`value_snapshot IS NULL`
> 时回退读模板」的双分支，且回退分支需打日志便于统计待回填存量。
>
> 落库后，「改面额只影响新领取」即可支持：`PUT` 改 `coupons.value` 不再被拒，
> 存量券读 `value_snapshot` 不受影响。**在此之前 `10001` 拒绝逻辑保持不变。**

**资金口径字段改动须重新审核（防「编辑即生效」绕过审核链）**

`POST /admin/coupons` 落 `DRAFT` 的前提是「建完不直接发」，那么配套必须堵住另一条绕过路径：
运营编辑**已 `ACTIVE`** 的券的 `value` / `type` / `minSpendFen` 任一资金口径字段，
若直接生效，就等于「审核通过之后还能改金额」——与刚立的「已发放禁改面额」规则互相打架
（一条禁改，一条随便改，且后者更隐蔽，因为它落在 `claimed_count == 0` 的券上）。

| 场景 | 要求 |
|---|---|
| 编辑 `DRAFT` 券的 `value`/`type`/`minSpendFen` | 允许，保持 `DRAFT`（本就未投放，无需重审） |
| 编辑**非 `DRAFT`** 券的上述任一字段 | 状态回退到 `DRAFT`（推荐），或置 `needsReReview` 标记；**不得停留在 `ACTIVE` 直接生效** |
| 编辑非资金口径字段（`name`/`validDays`/`scopeRules`/`startAt`/`endAt`/`totalCount`） | 允许，不触发重审（这些不改变资金口径） |

`type` 变更等价于换量纲（`FULL_REDUCTION` 分 ↔ `DURATION` 分钟），故与 `value` 同列为资金口径字段。
实现侧须在 `PUT` 里比对 before/after，仅当三者任一实际发生变化时才触发回退，避免无谓打回。

**`value` 单位随 `type` 变（schema:1425）**

| type | `value` 语义 | 示例 |
|---|---|---|
| `FULL_REDUCTION` | **减免分**（字符串化的分） | `1000` = ¥10.00 |
| `DURATION` | **抵扣分钟** | `30` = 30 分钟 |

两者量纲差 200 倍，**不可跨类型相加**。出参不做单位换算，由消费端按 `type` 分别渲染。

**🔴 前端硬约束：券抵扣额一律取后端返回的 `deductFen`，禁止前端自行推算**

| 层 | 字段名 | 说明 |
|---|---|---|
| DB 列 | `coupon_deduct_fen` | BigInt，**永远字符串化后出参** |
| 域函数 | `deductFen`（`domain/coupon-deduct.ts` 的 `calcCouponDeduct`） | bigint，**只在服务端** |
| **API 出参** | **`couponDeductFen`**（订单详情/列表） | **字符串化的分**，前端唯一可用的抵扣额 |

**前端禁止做的事**：
1. ❌ 用券模板的 `value` 当抵扣额——`value` 是**模板面额**，不是本次抵扣额。
   券 `scopeRules` 限定 `serviceTypes` / `minOrderFen` 时实际抵扣可能小于面额；
   而且模板面额可被运营改（见上方「已发放禁改面额」），**改了不等于已领券变价，但抵扣照模板算**。
2. ❌ 用 `value` 与 `type` 自行推算「抵扣多少钱」——**`DURATION` 型的 `value` 单位是分钟不是分**
   （30 = 30 分钟），前端一乘就是资损，且量纲差 200 倍时算出来的数看着「像对的」。
3. ❌ 用 `valueSnapshot` 自己算——快照是**核销依据**，但抵扣逻辑在服务端
   （含门槛校验、上限截断、订单总额封顶，见 `calcCouponDeduct`）。

> **为什么这条要写死**：前端算金额是所有对账问题的起点。这不是「不建议」，
> 是**契约级禁止**——因为一旦前端自己算，「后端按快照扣钱、前端按模板显示」
> 这类故障**无法被任何测试发现**，因为两边各自都自洽（这与「跨环境不一致无法被测试发现」同源）。

**订单出参里与券有关的三个字段，语义各不相同，不可混用**：

| 字段 | 语义 | 谁用|
|---|---|---|
| `couponDeductFen` | **本次实际抵扣额**（分，字符串） | 订单详情/列表展示、**前端唯一该用的** |
| `coupons.value` | 券**模板**面额（分 或 分钟，随 `type` 变） | 仅券管理页（运营视角） |
| `user_coupons.value_snapshot` | 领取时**快照**的模板面值（分 或 分钟） | **仅服务端核销用**；若要出参给前端看「这张券当时值多少」，必须用它，且 `null` 时回落展示模板并显式标注「未快照」 |

**`/end` 的不可逆语义与二次确认要求**

- 不可逆：`ENDED` 是终态，**不可恢复到 `ACTIVE`**（要再发只能新建模板）
- 存量已领券**仍可正常核销用完**（不因结束而作废），只是不再新增领取
- 后台**必须**二次确认，且确认文案须明写「不可恢复」四字——这是不可逆资金侧动作
- 已领未核销的券不自动退款；如需补偿走 `POST /admin/complaints/:no/handle` 的 `compensationAmountFen`

**建议（非强制）**：`PUT` / `publish` / `end` / `pause` / `resume` / `grant` 六个动作
建议全部落`audit_logs`（`module=marketing`），before/after 双快照，与配置变更同口径。

#### 5.7.7 系统与超管
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/configs/changelog` | `config:read` | **配置变更历史**：记 `configKey` / `beforeValue` / `afterValue` / `operator` / `changedAt` / `requestId`（before/after 双值必须有——财务要查「谁把佣金从 5% 改成 8%」需双值对照）。落 `audit_logs`，不新建表 |
| GET | `/admin/system/admins` | `*` | 管理员列表 |
| POST | `/admin/system/admins` | `*` | 新建管理员 |
| POST | `/admin/system/admins/:id/freeze` | `*` | 冻结管理员 |
| POST | `/admin/system/admins/:id/unfreeze` | `*` | 解冻管理员 |
| GET | `/admin/system/roles` | `*` | 角色列表 |
| PUT | `/admin/system/roles/:id/permissions` | `*` | 调整角色权限点 |

#### 5.7.7.1 `GET /admin/configs/changelog` 出参与筛选取值域（2026-10 补登记）

**出参**（前端 `ConfigChangeLog`；字段名**逐字**如下，错一个名字页面就整列空白且不报错）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | audit_logs 主键 |
| `configKey` | string | 配置键（落 `audit_logs.target_id`） |
| `beforeValue` | string | 变更前值（**字符串**；金额类单位为分，禁止浮点） |
| `afterValue` | string | 变更后值 |
| `operator` | string | 操作人姓名 |
| `changedAt` | string | 变更时间 ISO8601（**不是 `createdAt`**——落 `audit_logs.created_at`，但出参名是 `changedAt`） |
| `requestId` | string | 与服务端日志串联，合规审计要能按它回溯 |
| `ip` | string | 操作 IP |
| `configLabel` | string | **[前端补充字段，契约未要求]** 配置项中文名 |
| `truncated` | boolean | **[服务端补充]** 候选集被截断（见下方已知限制） |

> **`changedAt` 不是 `createdAt`**：落库列名是 `audit_logs.created_at`，但**出参名是 `changedAt`**。
> 两者语义也确不相同——`audit_logs` 是全后台审计表，`created_at` 是「这条审计记录何时写入」；
> 而运营看到的是「配置何时被改」。若承钧按落库列名直出 `createdAt`，前端四列全空白。
>
> **`configLabel` 建议直接取 `SYSTEM_CONFIG_DEFAULTS[key].description`**（种子已带中文描述），
> 不要另建映射表——那是第二份会漂移的口径。未知键（历史遗留/已下线）回落成键名本身。

**筛选参数**：

| 参数 | 取值域 |
|---|---|
| `configKey` | 精确匹配单个配置键 |
| `group` | **六个中文组名之一**，见下表。**不接受英文 key**（早期实现曾同时接受 `SHARING_FUND`/`ACTIVITY_SENSE`，已废——运营在页面上看到的是中文，两套值域并存等于两处映射） |
| `operator` | 按操作人姓名模糊匹配（**应用层筛**，SQL 侧做不了，需 join `admins`） |
| `keyword` | 在 `configKey` + 操作人 + `requestId` 上模糊匹配（**应用层筛**，需解析 `Json`） |

**`group` 六个取值域与键归属**（28 个 `SYSTEM_CONFIG_DEFAULTS` 键的**严格划分**，不多不少各归一组）：

| group | 键 |
|---|---|
| `分账与资金` | `commission_rate` / `deposit_amount` / `split_mode` / `cancel_penalty_rate_bp` |
| `核销与到岗` | `dynamic_code_ttl` / `face_match_threshold` / `gps_max_deviation` |
| `派单与隐私` | `dispatch_timeout_min` / `privacy_number_valid_hours_after_done` / `night_order_enabled` |
| `风控与信用` | `ai_sample_rate` / **`report_reward`** / `credit_limit_threshold` / `credit_freeze_threshold` |
| `自动挂起与夜间确认` | `service_overtime_suspend_min` / `im_silence_suspend_min` / `night_confirm_timeout_min` |
| `健康活动感知` | `activity_*` 全部 11 项 |

> **`report_reward`（举报飞单奖励额）属「风控与信用」，不属「分账与资金」。**
> 早期实现把它放进了分账组——但它是举报飞单的**奖励**，走风控机制，不进分账池。
> 归错的后果是运营筛「分账与资金」会看到一条与分账无关的奖励变更，且无从解释。
>
> **实现方式：必须是显式白名单，不能用前缀通配。**
> `activity_` 前缀若将来被别的模块占用（如 `activity_log` 模块的清理开关），
> 通配会把无关配置混进「健康活动感知」。**白名单是刻意的成本。**
>
> **取值域来源（2026-10 上收，主理人裁定）**：上表已**上收到
> `@linban/shared` 的 `CONFIG_DOMAIN_GROUPS`，为唯一权威** —— 服务端
> `admin.routes.ts` 的 zod `group` 取值域由 `Object.keys(CONFIG_DOMAIN_GROUPS)` 派生，
> 前端 `config-meta.ts` re-export 同一份，**两端都不再各自维护**。
> - **加新组自动生效**：只改 `CONFIG_DOMAIN_GROUPS` 一处，两端同时可用，不会出现「前端下拉有、服务端 zod 没有」的 400（2026-10 上修的 P0 即此类）。
> - 键集不变式（扁平并集 === `SYSTEM_CONFIG_DEFAULTS` 的 28 键、每键恰好归 1 组）由
>   `npm run doc:check:configs` **段 6.1 / 6.2** 断言，不等即红。
> - `doc:check:configs` **段 6.4** 另断言「服务端 zod 必须是从 `CONFIG_DOMAIN_GROUPS` 派生」——
>   若有人回退成硬编码枚举，该条会逐个列出**哪几个组会被判非法（→ 运营点得到但查询 400）**。
>
> 配套断言（`apps/server/src/middlewares/config-changelog-group.test.ts`，15 条）：
> ① 白名单每个键必须在 `SYSTEM_CONFIG_DEFAULTS` 真实存在；
> ② 每个键恰好归属 1 个组（无重复）；
> ③ 健康活动感知组键必须以 `activity_` 开头；
> ④ **六个组名每一个都能通过服务端 zod schema**（把 2026-10 那个 P0 钉成回归测试）。

**已知限制（不藏着）**：`operator` / `keyword` 只能应用层筛，故服务端须设**候选集上限 500**
并回 `truncated: boolean`。前端须在 `truncated === true` 时提示「请收紧筛选条件」，
**不得把候选集条数当成 `total` 展示**——否则运营会以为全库只有这么多条变更。

#### 5.7.8 后台认证（表格遗漏，仅补登记）
| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/auth/admin-login` | 登录即可 | 后台/客服登录（签发 adminToken），见 §1.2 |

---

## 6. 三端共用能力

### 6.1 IM（订单维度，禁止脱离订单私聊）`/im`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/im/conversations/order/:orderId` | R | 按订单取/建会话（1:1；隐私号 AXB 绑定随会话生命周期） |
| GET | `/im/conversations` | R | 我的会话列表 |
| GET | `/im/conversations/:id/messages` | A | 消息历史（风控审计留痕；敏感消息替换为警示） |
| POST | `/im/conversations/:id/messages` | A | 发消息（同步拦截：手机号/微信号/外部链接模式，§8.2） |
| POST | `/im/conversations/:id/read` | A | 已读回执 |
| GET | `/im/privacy-binding/order/:orderId` | A | 隐私号绑定状态（真实号码互不可见；完成+24h 解绑） |

### 6.2 AI 陪聊 `/ai`（仅老人端）

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/ai/sessions` | R | 创建 AI 会话（ELDER 角色） |
| POST | `/ai/sessions/:sessionNo/turn` | R | 文本对话（LLM 适配层可热切换 DeepSeek/通义/豆包；降级链） |
| POST | `/ai/sessions/:sessionNo/turn/voice` | R | 语音对话（ASR→LLM→TTS 全语音，适老音色） |
| POST | `/ai/sessions/:sessionNo/end` | R | 结束会话 |
| GET | `/ai/sessions` | R | 我的 AI 会话列表 |

AI 会话内容经微信内容安全 + 抽检（`ai_sample_rate` 5% 人工抽检）；数据沉淀画像反哺真人匹配（双线转化）。

### 6.3 文件 `/files`（COS STS 直传）

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| POST | `/files/sts` | R | 签发临时密钥（私有桶+STS，前缀白名单） |
| POST | `/files/commit` | R | 上传回执（落 file_meta；bucket/objectKey 为 X 态） |
| POST | `/files/:id/access-url` | R | 换临时访问 URL（带过期；访问审计） |

### 6.4 通知 `/notifications`

| 方法 | 路径 | 态 | 说明 |
|---|---|---|---|
| GET | `/notifications` | R | 消息中心（订阅消息/短信/IM 系统消息） |
| POST | `/notifications/read` | R | 标记已读 |

发送走 BullMQ `notification` 队列（worker 消费，失败重试；短信降级通道）。

---

## 7. 按端拆分红线清单

### 7.1 用户小程序端红线

1. **不碰资金字段写操作**：前端只发起支付/取消，退款/分账一律服务端驱动（退款走 `/payments` 系统回调或后台裁决）。
2. **隐私零透出**：陪聊员真实姓名/证件/手机号不出 `CompanionPublicDTO`；老人健康信息仅「提醒边界」级偏好，禁病历。
3. **老人数据授权链**：子女看老人订单/档案必须 `family_bindings` ACTIVE + auth_level≥PROGRESS（编辑档案例外需 FULL 的场景以后台配置为准）。
4. **核验公平性**：动态码仅老人端展示，陪聊员端只收码不显码；人脸/GPS 阈值服务端判定，前端不感知阈值。
5. **注销铁律**：进行中订单/未结算资金/在审入驻一律拒绝注销（`10008`）。

### 7.2 陪聊员小程序端红线

1. **看不到钱的时间窗**：服务核销完成前「待入账」可见但不可提现（防飞单财务基石，§7.1）。
2. **入驻四审不可跳态**：每阶段适配器结果（OCR/慧眼/人工）留痕，阶段推进只认 `application-state-machine.ts`。
3. **时段冲突即失败**：抢单/日程写入遇冲突返回 `14003`，不做静默覆盖。
4. **信用分只读**：陪聊员端只能看 `credit-logs`，调整仅后台（留痕 operator）。
5. **IM 禁私聊**：会话必须挂订单；脱离订单的联系方式交换走风控拦截（§8.2），不做客户端放行。

### 7.3 管理后台红线

1. **分账手动结算=兜底**：`manual-settle` 仅在 `SPLIT_MODE=manual_settlement_fallback` 或微信通道故障时使用，操作必须写 `audit_logs`（before/after）。
2. **配置热更新双落**：Redis 失效 + `audit_logs`；金额类配置一律「分」，前台展示层换算。
3. **RBAC 最小化**：财务不碰风控处置、客服不碰分账执行；`admin` 的 `*` 仅超管令牌可获得。
4. **举报奖励防刷**：同订单同举报人去重；奖励券模板金额取 `system_configs.report_reward`，不写死。
5. **文件 X 态**：后台文件列表不出 objectKey/临时 URL 直出，一律走 access-url 换链并审计。

---

## 8. 状态机与门闩的接口侧约束

- **订单 12 态**：`PENDING_PAYMENT → PAID → DISPATCHED → ACCEPTED → ARRIVED → IN_SERVICE → PENDING_CONFIRM → COMPLETED`，旁路 `CANCELLED`（未支付）/`REFUNDING → REFUNDED`/`SUSPENDED → (COMPLETED|REFUNDED)`/`CLOSED`。所有流转经 `assertTransition`，非法 `14002`；每次流转写 `order_timeline`（操作人/动作/原因）。
  - **安全挂起（裁定③）**：`ACCEPTED/ARRIVED/IN_SERVICE → SUSPENDED` 三边已开——SOS 立即挂起（`action='sos_suspend'`，记触发方）、服务超时 sweep 自动挂起（`action='auto_suspend'`，记 SYSTEM，reason 带阈值快照）、客服手动挂起（`action='suspend'`，记 ADMIN），三者共用 `suspendOrderForSafety` 裁决出口；`SUSPENDED → COMPLETED/REFUNDED` 由客服裁决（§5.5）。
- **分账门闩**：`POST /payments/sharings/:orderId/execute` 与 cron 重试均先过 `checkSharingGate`，任一失败 `15006` 并告警；重试 <3 次（`SHARING_RETRY_MAX`），超限进人工。
- **核销三关**：动态码（TTL 300s）+ 人脸分 ≥80 + GPS 偏差 ≤2000m（阈值均 `system_configs` 化），三关全过才 `ARRIVED`。
- **时段防重**：Redis `lock:slot:<companionId>:<serviceDate>#<HH:mm>`（10min）+ DB 唯一索引（guard='L'/NULL）双防线，接口层对 `14003` 的语义 = 「该时段已被占用」。
- **夜间单（裁定④）**：22:00–06:00 下单标记 `night_order`；豁免口径 A——「下单账号 == 被服务老人本人」且 `elder_profile.birthday` 满 18 岁 → 老人自确认（创建时落 `family_confirmer_id/family_confirmed_at`）；否则 30min（`night_confirm_timeout_min`，自 `created_at` 起算）内须由生效绑定的子女确认，未确认的单禁止派单/接单（`14007`），超时 sweep 自动取消——已支付的走「取消 → `refundOrder` 原路退款 → 分账 FROZEN 解冻回退（RETURNED）→ 订单终态 `REFUNDED`」整链。
- **服务超时挂起 sweep（裁定③）**：`IN_SERVICE` 且 `now − slot_end ≥ service_overtime_suspend_min(60)` 且 `now − lastImActivity ≥ im_silence_suspend_min(30)`（无 IM 消息时回退 `service_started_at ?? accepted_at ?? created_at`）→ 自动挂起待客服核实。
- **健康告警 6 态（§13.5）**：`health_alerts` 自闭环 `OPEN → ACKNOWLEDGED → PROCESSING → RESOLVED / DISMISSED / ESCALATED`，非法流转 `24002`；`escalate` 受交叉验证门闩约束（不通过 `24004`），W-MVP 不改 `complaints` schema（系统服务账号兜底 `complainant_id`，Q11）。
- **活动分级 UNKNOWN 优先**：探针离线 / 信号超 `activity_signal_ttl` / 窗口过短 → 一律 `UNKNOWN`，禁止用过期数据"假装确定"（红线，见 §13.1）。

## 9. 变更管理

- 契约变更必须同 PR 改：`packages/shared`（枚举/错误码/DTO）+ 本文档 + 实现；三端联调基点以 `requestId` 回溯。
- 破坏性变更（删字段/改语义）先加 `deprecated` 标注观察一个发布周期（对齐 DATABASE.md §9.2 expand→backfill→contract）。
- 新增端点先在本文档登记（方法/路径/消费端/数据态/权限/幂等要求），后落码。

---

## 13. 健康活动感知 `/activity`（架构 §13 / PRD MODULE-ACTIVITY-SENSE.md）

W-MVP 双通道模型：**通道A** = APP Wi-Fi 状态心跳（零硬件，本期唯一生产通道）、**通道B** = 网关特征（W+1，协议位预留）。
数据三层：`activity_signals`（原始特征，HMAC 化）→ `activity_daily_summary`（日聚合）→ `health_alerts`（告警）。

**域函数映射表**（唯一逻辑副本在 `apps/server/src/domain/activity.ts`，路由层只做取数与副作用）：

| 域函数 | 职责 | 主要消费端点 |
|---|---|---|
| `classifyActivityStatus` | 五级状态分级（ACTIVE/LOW/STILL/AWAY/UNKNOWN）+ `explainCode`，全阈值入参 | `GET /activity/report/daily`、`/report/trend`、`/board/elder`、`/admin/activity/dashboard` |
| `computeConfidence` | 置信度 0–1（陈旧线性衰减 + 通道缺失降级 + 交叉验证加权） | 同上（随分级一并返回） |
| `crossVerifySatisfied` | 双通道交叉验证判定；`required` 在 domain 层锁死 true，不读配置 | `POST /admin/activity/alerts/:id/escalate`、cron `activity:alert:sweep` |
| `shouldSuppressAlert` | 同类告警抑制窗口（闭区间，防告警风暴） | cron `activity:alert:sweep`、`POST /admin/activity/alerts/*` |
| `computeDispatchWeight` + `rankByActivity` | 派单活动加成（LOW+5/STILL+10、同档微调、封顶 100、半径硬约束） | `GET /orders/dispatch/pool`、派单推送（order 层内部调用） |
| `detectLeadTriggers` | 引流触发器（活跃下降 / 连续低活跃 / 新装体验） | `GET /activity/recommend`、`/admin/activity/funnel`、`activity_touchpoints` 埋点 |

> **domain 层不得越权输出诊断性结论**：只出五级状态 + `confidence` + `freshnessSec` + `explainCode`；任何「健康/不健康」表述必须由告警层在 `crossVerifySatisfied=true` 之后生成。

### 13.1 隐私红线（接口侧硬约束，实现落 `apps/server/src/domain/activity.ts` 与 `modules/activity/**`）

| # | 红线 | 接口侧机制 |
|---|---|---|
| 1 | 无摄像头 / 无麦克风 / 无实时轨迹 | **不存在**轨迹回放类端点；日报只出聚合，不出逐分钟序列 |
| 2 | SSID / BSSID / MAC 只落 HMAC | 采集入参原文仅在内存 HMAC-SHA256(pepper) 化后落 `*_hmac` 列，**原文不入库不入日志**（格式非法即拒 `22004`） |
| 3 | 原始特征不出户 | `activity_signals` 仅服务端可读，无任何对外读端点 |
| 4 | 双层知情同意 + 一键关 | 采集前须 `activity_consents` 双层均 GRANTED 且 `activity_consent_scopes` 覆盖当前采集范围，否则 `22001`；撤销后 `22006` |
| 5 | 仅参考不作诊断 | 所有出参强制携带 `disclaimer` 文案（"参考指标，非医疗诊断"），端上不得隐藏 |
| 6 | 原始特征留存 ≤14 天 | `activity_signal_retention_days=14`，cron sweep 清理并写 `audit_logs` |
| 7 | 无 L4 字段、不存原始波形 | 无健康诊断字段、无实时位置；**不引入 CSI 等原始波形的存储与处理**，只落派生特征向量 |
| 8 | 人工兜底不设付费墙 | 久静/离线告警的 `level=URGENT` 路径**不得**被任何订阅门闩拦截（Q9） |

**禁止单通道直接输出「健康/不健康」结论**：`computeConfidence` 单通道硬上限 `0.6`（`CONFIDENCE_RULES.singleChannelCap`）；紧急告警必须 `crossVerifySatisfied=true`（A、B 双通道有效 **且** 交叉源命中），否则一律降级为 WARN 待人工确认并回 `24004`；单通道直接请求 URGENT 回 `24006`。

### 13.2 错误码对照表（三段；`packages/shared/src/error-codes.ts` 为单一事实源，一码一句触发条件）

**22xxx · 感知采集与设备授权**

| 码 | key | 触发条件 |
|---|---|---|
| 22001 | `ACTIVITY_CONSENT_REQUIRED` | 双层知情同意未同时 GRANTED，或 `consent_scopes` 未覆盖当前采集范围 |
| 22002 | `ACTIVITY_DEVICE_NOT_BOUND` | 采集/查询时该老人无已绑定感知设备 |
| 22003 | `ACTIVITY_DEVICE_OFFLINE` | 设备 `wifi_devices.status=OFFLINE` 且未到宽限期 |
| 22004 | `ACTIVITY_FEATURE_INVALID` | 上报特征格式非法（越界数值/缺字段/含禁止的原始波形字段） |
| 22005 | `ACTIVITY_CHANNEL_AUTH_FAILED` | 设备令牌校验失败或过期，或通道签名不匹配 |
| 22006 | `ACTIVITY_COLLECTION_STOPPED` | 总开关关闭，或本人已撤销授权（撤销后即时停采） |

**23xxx · 活动查询与看板**

| 码 | key | 触发条件 |
|---|---|---|
| 23001 | `ACTIVITY_DATA_NOT_READY` | 累计有效信号不足（未达 3–7 天积累窗口），不出结论 |
| 23002 | `ACTIVITY_CONFIDENCE_TOO_LOW` | 置信度低于展示阈值（单通道上限 0.6 场景），仅回原始分级与依据码 |
| 23003 | `ACTIVITY_DATE_RANGE_INVALID` | `date`/`days` 越界（如 `days>90` 或非法日期格式） |
| 23004 | `ACTIVITY_ACCESS_DENIED` | 非本人；或子女 `family_bindings` 非 ACTIVE / `auth_level` 不足 / 授权范围档位为 `NONE` |
| 23005 | `ACTIVITY_SUMMARY_NOT_FOUND` | 指定日期无日聚合记录 |

**24xxx · 告警处置**

| 码 | key | 触发条件 |
|---|---|---|
| 24001 | `ACTIVITY_ALERT_NOT_FOUND` | 告警不存在或不属于该老人（防横向越权） |
| 24002 | `ACTIVITY_ALERT_ALREADY_HANDLED` | 告警已 `RESOLVED`/`DISMISSED`，或已 `ESCALATED` 不可重复处置 |
| 24003 | `ACTIVITY_ALERT_SUPPRESSED` | 同类告警处于 `activity_alert_suppress_min` 抑制窗口内，不重复推送 |
| 24004 | `ACTIVITY_CROSS_VERIFY_INSUFFICIENT` | 双通道交叉验证未通过，URGENT 降级为 WARN 待人工确认 |
| 24005 | `ACTIVITY_ALERT_ESCALATE_FAILED` | 升级链路执行失败（工单/外呼/通知任一环失败，可重试） |
| 24006 | `ACTIVITY_ALERT_LEVEL_INVALID` | 告警级别与触发条件不匹配（单通道不得直接产出 URGENT） |
| 24007 | `ACTIVITY_ALERT_TRANSITION_INVALID` | 告警状态机不允许该流转（非法流转拒绝） |

> 25xxx 段留空给 W+1/W+2（网关硬件接入、订阅付费闭环），见 §13.11。

### 13.3 用户端（老人）

**越权面硬要求**：`elderId` **不由端上传参**，一律从 token 解析；越权统一抛 `23004`（统一经 `assertActivityReadable` 助手）。

| 方法 | 路径 | 态 | 域函数 | 说明 |
|---|---|---|---|---|
| POST | `/activity/ingest` | R | — | **采集入口**（APP 心跳，头 `X-Device-Token`）。前置门闩按序：`activity_watch_enabled` 总开关 → 双层授权 GRANTED（含范围子表）→ 设备已绑定且在线 → 设备令牌校验通过。服务端 HMAC 化后落 `activity_signals`，出参 `{ accepted: true, signalId }`。**幂等必填**（同设备同窗口重复上报只留一条） |
| GET | `/activity/report/daily` | R | `classifyActivityStatus` + `computeConfidence` | 活动日报 `?date`（默认昨日）。出参含 `status` + `confidence` + `freshnessSec` + `explainCode` + `disclaimer`。数据未积累 `23001`；置信度不足 `23002`；无记录 `23005` |
| GET | `/activity/report/trend` | R | `classifyActivityStatus` | 近 N 日趋势 `?days`（默认 7，上限 90），出参为**日聚合序列**；非法范围 `23003` |
| GET | `/activity/devices` | R | — | 我的感知设备列表（`APP_PROBE`；`deviceToken` 等凭据为 X 态不出参） |
| POST | `/activity/devices/bind` | R | — | 绑定探针（幂等）。**必须先授权后绑设备**：双层同意门闩前置（`consents.status=GRANTED` 且 `consent_scopes` 覆盖当前采集范围），未授权回 `22001`，不得反向。未绑定即上报 `22002`、探针离线 `22003`、令牌无效 `22005`。**`device_no` 由服务端生成，不接受端上传参**（端上能指定 device_no 等于能指定「我用谁的设备身份上报」，越权面从token 挪到字符串）；入参仅 `deviceType`（MVP 仅 `APP_PROBE`，`GATEWAY` 为 W+1，**明确回 `22004` 不静默降级**）/ `mac` / `vendor` / `model` / `heartbeatIntervalSec`（区间 [15,3600]，越界回落 60）。出参含**明文 `deviceToken`，仅首次签发时返回、之后为 `null`**（库里只有 SHA-256 哈希，明文不可复现），端上须自行持久化。**幂等语义**：同老人 + 同类型已有 `active_key='A'` 的生效设备 → 回放（`replayed:true`），**不重签令牌**——重签会让客户端手里的旧令牌立即失效且无法找回，等于强制重新配对 |
| POST | `/activity/devices/:id/unbind` | R | — | 解绑单设备（幂等）：`active_key` 置 NULL + `status=UNBOUND` + `collect_enabled=false` + **令牌即时失效**（`device_token_hash` 置 NULL）。不区分「不存在」与「不属于你」，统一 `23004`（防存在性探测）。**与一键关闭的差别**：解绑置 `UNBOUND`（用户主动解除单设备），一键关闭置 `REVOKED`（`wifi_device_status` 注释明写「REVOKED = 老人撤销授权，红线⑦」） |
| GET | `/activity/privacy` | R | — | 隐私中心：双层授权状态 + 可见范围档位（`activity_consent_scope_level`）+「谁在看我」+ 留存截止日 |
| POST | `/activity/privacy/revoke` | R | — | **一键关闭**（幂等）：立即停采（此后采集回 `22006`）+ 撤销授权 + 删除未聚合原始数据；出参 `{ collecting:false, aggregateRetained:true, effectiveAt }`。**`collecting` 的口径 = 总开关开 且 本人授权有效 且 所有设备均未停采（三者合取）**——撤销时 consents 置 REVOKED 与设备置停采**同时执行**，两者必须一致，否则该字段取值会漂移。日聚合长期留存（红线条），与 `POST /users/me/cancel-request`（账号注销，15 天冷静期）**语义区分** |

### 13.4 用户端（子女代看）

需 `family_bindings` ACTIVE + `auth_level` 校验，统一经 `assertActivityReadable`，失败 `23004`。

| 方法 | 路径 | 态 | 域函数 | 说明 |
|---|---|---|---|---|
| GET | `/activity/board/elder` | A | `classifyActivityStatus` + `computeConfidence` | 子女看板 `?elderId&days`（日/周趋势聚合，**无实时轨迹**）；受老人授权范围档位约束（`NONE` → `23004`） |
| GET | `/activity/recommend` | A | `detectLeadTriggers` | 基于活动的陪聊推荐（含引流触发器软文案）。**待 schema 定稿（A6）** |

> **子女响应面（写动作）单列于 §13.6.1**：`GET /activity/alerts`（家人告警列表，只读）与 `POST /activity/alerts/:id/ack`（子女确认已知晓 → `ACKNOWLEDGED`，记 `ack_by`）属**响应动作**（有状态写、幂等要求、独立越权面），与本节只读看板不同风险等级，故不并入本节。

### 13.5 陪聊员端 / 派单

**无新增端点**。派单加成由 order 层内部读 `activity_daily_summary` 注入，活动状态**不由端上传入**，避免伪造。

排序口径（`domain/activity.ts` 的 `computeDispatchWeight` / `rankByActivity`，Q10 定稿）：

| 环节 | 规则 |
|---|---|
| base_score | 现有 `scoreDispatchCandidate` 五因子结果（`DISPATCH_WEIGHTS = { distance:40, tags:20, credit:20, level:10, rating:10 }`，与行为**完全不变**） |
| activity_bonus | LOW `+5`、STILL `+10`；ACTIVE/AWAY/UNKNOWN `0`。取值来自 `activity_dispatch_bonus_low` / `_still`（**运行期读配置，不硬编码**；单测亦从 `SYSTEM_CONFIG_DEFAULTS` 读取） |
| 排序 | 先按 `floor(base_score/10)` 分 11 档，**组内**按 `base_score + activity_bonus` 降序；**加成不得跨档**（档位归属始终按 base_score） |
| 展示与落库分 | `min(base_score + activity_bonus, 100)` |
| 落库三列 | `base_score` / `activity_bonus` / `activity_bonus_reason`（`ACTIVITY_LOW` / `ACTIVITY_STILL` / `NONE`），供陪聊员申诉与风控复核。**落库列名映射**：`base_score` → `orders.dispatch_base_score`、`activity_bonus` → `orders.dispatch_activity_bonus`、`activity_bonus_reason` → `orders.dispatch_reason_code`。**注意 `dispatch_reason_code` 存的是 `ACTIVITY_BONUS_REASON` 三值（ACTIVITY_LOW/ACTIVITY_STILL/NONE），不是 `ACTIVITY_EXPLAIN` 七值依据码**（PROBE_OFFLINE/SIGNAL_EXPIRED/INSUFFICIENT_DATA/AWAY_CONFIRMED/ACTIVE_HIGH/STILL_NO_MOTION/LOW_ACTIVITY），两码表语义不同 |
| 服务半径 | **硬约束**：半径外候选不参与同档比较（先半径过滤 → 再分档 → 组内排序，顺序不可颠倒） |

陪聊员端服务中提示复用订单详情的 `activitySummary` 只读字段（仅 `status`/`confidence`/`explainCode`，不含任何原始特征）。

> `DISPATCH_BONUS_DEFAULTS.bandSize` 是**排序契约，非运营配置，不入 `system_configs`**——档位一改全量派单语义漂移，比加成调 5 分严重得多；故它只导出、不做入参。`bonusLow` / `bonusStill` / `cap` 三者才是入参。

### 13.6 管理端 `/admin/activity`（与分账中心彻底分离，Q8）

| 方法 | 路径 | 权限 | 域函数 | 说明 |
|---|---|---|---|---|
| GET | `/admin/activity/dashboard` | `risk:read` | `classifyActivityStatus` | 健康活动看板：活跃时段分布 / 设备在线率 / 告警处理时效。出参含 `urgentUnhandledCount`（URGENT 未处置数，前端顶部 P0 提示用）、`todayAlertUnhandled` / `todayAlertHandled` / `todayAlertDismissed`（今日告警未处置/已处置/误报）、`avgHandleMinutes`（平均首次响应分钟）、`managedElderCount` / `probeOnlineCount` / `probeOfflineCount`、近 7 日 `trend` 序列与 24 时段 `activeSlots` 分布 |
| GET | `/admin/activity/elders` | `risk:read` | `classifyActivityStatus` + `computeConfidence` | **老人活动列表**（分页）。出参见 §13.6.2（字段级出参表）。**数据不足（UNKNOWN）与信号过期必须单独视觉分区**，禁止与正常状态混排——运营看到的就是老人端可见的（§13.1 红线①） |
| GET | `/admin/activity/funnel` | `risk:read` | `detectLeadTriggers` | 引流漏斗（INSTALL → ACTIVATION → CONSENT_GRANTED → DATA_AVAILABLE → ALERT_RAISED → FIRST_ORDER → REORDER） |
| GET | `/admin/activity/revenue` | `revenue:read`（占位，W+1 落地进 RBAC 双写面） | — | **订阅营收（营收中心）**：只读聚合报表。出参见 §13.6.3。**不进 `profit_sharing_records`、不参与抽成**，财务对账分开（Q8） |
| GET | `/admin/activity/alerts` | `risk:read` | `crossVerifySatisfied` | 告警工作台（按级别/状态筛选；含交叉验证结论） |
| POST | `/admin/activity/alerts/:id/ack` | `risk:*` | `crossVerifySatisfied` | 人工确认 → `ACKNOWLEDGED`（记 `ack_by`）；已处置 `24002` |
| POST | `/admin/activity/alerts/:id/resolve` | `risk:*` | — | 落处置结论（`RESOLVED` / `DISMISSED` 误报） |
| POST | `/admin/activity/alerts/:id/escalate` | `risk:*` | `crossVerifySatisfied` | 升级对外追责：**交叉验证不通过一律拒绝**（`24004`）；放行后落 `complaints` 工单并复用 SOS 出口（紧急联系人短信 + 绑定子女 IM + 到岗态订单走 `suspendOrderForSafety`）；执行失败 `24005`。**待 schema 定稿（A2）** |

> 告警状态流**自闭环**：`OPEN → ACKNOWLEDGED → PROCESSING → RESOLVED / DISMISSED / ESCALATED`（与 `health_alert_status` 逐字一致），非法流转 `24007`。仅 `escalate` 人工介入时才落 `complaints`，`complainant_id` 记系统服务账号并写 `audit_logs` 留痕（Q11）。
>
> **权限点说明**：W-MVP 告警处置复用既有 `risk:*` / `risk:read`（不新增 `activity:*` 权限点，避免 RBAC 双写面扩大：新增权限点须同步 `prisma/seed.ts` 的 ROLE_PERMISSIONS、`apps/server/src/middlewares/auth.ts` 的 ROLE_PERMISSIONS、admin-web 按钮级权限三处）。W+1 若拆分独立 `activity:read` / `activity:alert:handle`，同样须同步上述三处。营收页 `GET /admin/activity/revenue` 按 Q8 走**营收中心**独立权限 `revenue:read`，**既不复用分账中心的 `payment:*`，也不复用 `config:read` 或 `risk:*`**——否则营收与分账的隔离在 RBAC 层就是假的。

### 13.6.1 子女响应（写动作，独立于只读看板）

需 `family_bindings` ACTIVE + `auth_level` 校验，统一经 `assertActivityReadable`，失败 `23004`。与 §13.4 只读看板分开：写动作有状态变更、幂等要求与独立越权面。

| 方法 | 路径 | 态 | 权限 | 域函数 | 说明 |
|---|---|---|---|---|---|
| GET | `/activity/alerts` | A | `family_bindings` ACTIVE | — | 家人告警列表 `?elderId&status`；仅 `ALERT_ONLY` 及以上可见范围档位可见 |
| POST | `/activity/alerts/:id/ack` | A | `family_bindings` ACTIVE | — | 子女确认已知晓 → `ACKNOWLEDGED`（记 `ack_by` / `ack_at`）；非 `OPEN` 态 `24002`。**幂等**：重复 ack 返回首次结果，不重复写。**待 schema 定稿（A3）** |

> `elderId` 一律从 token 解析的绑定关系推导，**不由端上传参**（与 §13.3 同一纪律）；跨家人访问一律 `23004`。

### 13.6.2 `GET /admin/activity/elders` —— 逐字参数表 + 字段级出参表

> **为什么这一节是「逐字表」而不是散文**（2026-10 主理人裁定，第四轮缺口②复盘）：
> 契约原文写的是「支持按状态/社区/是否过期筛选」——**散文无法被机器核对**。
> 前端按这句散文实现了 `community` / `staleOnly`，服务端按自己的理解实现成 `community` 缺失 + `stale`。
> 三方都「觉得自己照契约做了」，而**过期筛选功能实际完全失效**（`staleOnly` 被服务端 zod `.strip()` 静默丢弃 →
> `q.stale === undefined` → 「信号过期」筛选恒不生效且**无任何报错**：请求 200，运营看到「没反应」）。
>
> **「不是没做，是假装做了」是最坏的一类**——因为真没做会有人去问，假装做了没人会去查。
> 所以本节把参数名与出参名**逐字**写出：一个字符的差异都能被 diff 出来。

#### 13.6.2.1 请求参数（逐字，键名大小写敏感）

| 参数 | 类型 | 必填 | 取值域 | 服务端行为 |
|---|---|---|---|---|
| `status` | string 或 string[] | 否 | `ACTIVE` / `LOW` / `STILL` / `AWAY` / `UNKNOWN`；可传数组实现多选 | 按状态过滤；不传 = 不过滤 |
| `stale` | string | 否 | **仅 `'true'` / `'false'` 两个字符串**（非布尔 `true`/`false`，非 `1`/`0`） | `stale === 'true'` 只看过期行；`'false'` 只看未过期行；不传 = 不过滤 |
| `days` | number | 否 | 1–30 整数，默认 7 | 同时控制**取数窗口**与 **sparkline 天数**（两者同一口径） |
| `page` | number | 否 | ≥1 整数，默认 1 | 页码 |
| `pageSize` | number | 否 | 1–100 整数，默认 20 | 每页条数 |

> ⚠️ **`stale` 收的是字符串不是布尔**：服务端是 `z.enum(['true','false'])`。
> 传 `stale=1` / `stale=yes` **一律 400**（不是静默忽略）。
> 前端类型声明是 `stale?: string`（非 `boolean`）——**这不是偷懒，是与服务端口径一致**。

#### 13.6.2.1.1 社区筛选项的来源（**服务端不提供独立社区字典端点**）

> **裁定（2026-10 主理人）**：`GET /admin/activity/communities` **不存在，且不提供**。
>
> **为什么不给独立端点**：社区字典若单独成端点，就成了**第二份需要同步的数据源**——
> `communities` 表改了，字典端点的缓存/去重逻辑要跟着改，两处漏一处，
> 运营就会看到「筛选下拉里没有新建的社区」而列表里明明有那个社区的老人。
> **一份数据源 + 端上派生**是唯一不会分叉的做法。
>
> **社区下拉选项怎么来**：前端从 `GET /admin/activity/elders` **返回结果的「所属社区」字段去重**得出。
> 代价是**只能选到当前页出现过的社区**（分页接口的固有局限）——
> 但这是**诚实的局限**：选项来自真实数据，不会出现「下拉里有但一个老人都不属于」的幽灵选项。
> 相比之下，页面直接 `import` mock 常量（`src/api/mock/db-activity` 的 `ACTIVITY_COMMUNITIES`）
> 会在生产环境**静默显示 7 条硬编码社区**——运营看不出来它是假的，且第 8 个社区永远出不来。
> **宁可选项少，不可选项假。**
>
> **若将来仍要独立端点**（例如社区数增长到去重不实用、或需要「按社区查活动趋势」的下钻）：
> 必须先解决「两处同步」问题（同一 `communities` 表 + 同一 `community_code` 口径 + 明确谁是权威），
> 并在本节同步登记端点、参数与出参——**不能只在代码里加一个路由而不改契约**。

#### 13.6.2.2 已废弃参数名（**服务端不识别，传入即被 `.strip()` 静默丢弃**）

| 废弃名 | ① 它从哪来（原文出处） | ② **它当前看起来对不对**（照抄会发生什么） | ③ 现在应该用什么 | ④ 若真发生（历史包袱未清干净）→ 去哪查 |
|---|---|---|---|---|
| `staleOnly` | **它曾被写进过契约散文的语义里**——契约原文只说「支持按状态/社区/是否过期筛选」，`staleOnly` 是前端**从这句散文里自造**的读法。2026-10 修复前的 `apps/admin-web/src/api/activity.ts` 确实传过它（注释原文：「`staleOnly` 是前端自造名，服务端收的是 `stale`，恒不命中」） | 🔴 **看起来完全对——这是它最危险的地方**。它比正确名 `stale` **更像契约原文**（「是否过期」→ `staleOnly` 读起来更贴）。**照抄的后果：静默失效**——zod `z.object()` 默认 `.strip()` → 传入后 `q.stale === undefined` → 「信号过期」筛选恒不生效，**请求 200、零报错、运营看到「没反应」**。**不是报错，是假装做了** | **`stale`**（字符串 `'true'`/`'false'`，非布尔） | 查 `apps/admin-web/src/api/activity.ts` 与 `apps/admin-web/src/api/mock/server.ts` 的参数构造；两处必须同名字面量，mock 与真服务端不得分叉。已有守卫：`smoke.mjs` 的「前端不再传 `staleOnly`」+「页面筛选状态不再用 `staleOnly` 字段」 |
| `community` | 契约散文承诺过「按社区筛选」，但**服务端从未实现 where 条件** | 🟡 **看起来对（契约确实承诺过）**。**照抄的后果：静默失效**——不在 zod schema 里 → 被 `.strip()` → 社区筛选恒不生效，**无报错**。**比 `staleOnly` 更隐蔽的变体**：若将来只把 zod 键加上而**不加 where 分支**，则连「被 strip」的证据都没有——schema 收得下但过滤不生效 | **W+1 起由服务端实现后开放**；在此之前前端控件**禁用**并挂 tooltip 说明 | 查 `apps/server/src/modules/activity/admin.service.ts` 的 `listElderActivities` 是否真有 `community` 过滤分支。**只加 zod 键不加 where = 最隐蔽的一种** |
| `keyword` | 契约**从未**承诺此筛选；但前端页面有输入框、mock 也实现了 → 两边各写各的 | 🟠 **看起来无害**（多传一个键不会报错）。**照抄的后果：行为不同**——被 strip 后筛选静默失效；若服务端将来**先**加了 `keyword` 而契约未登记，则**契约失去了它的合法性来源**（代码里有个功能，契约里查不到） | **待裁定**。本轮契约不承诺此筛选 | 查 `apps/admin-web/src/pages/health/HealthBoardPage.tsx` 的 `ElderFilters` 接口与 mock `server.ts` 的 elders 路由 |

> **为什么废弃名要写「①从哪来」**：废弃名的生命力来自它的**出处看起来权威**。
> `staleOnly` 之所以危险，是因为它诞生于**契约的一句散文**——
> 前端读「是否过期筛选」→ 造了个 `staleOnly` → 契约从不说「不许自己起名」→ 前端觉得自己照契约做了。
> **只写「禁止使用」不够**：看到废弃名的人**不会去查契约**，他只会凭记忆。
>
> **为什么废弃名要写「②照抄会发生什么」**：三种后果的**排查方向完全不同**——
> ① **静默失效**（`staleOnly`/`community`）→ 查 zod schema 与前端参数构造
> ② **报错**（如传 `stale=1` → 400）→ 查取值域，**这个反而最安全**
> ③ **行为不同**（`keyword`）→ 查两套实现
> **只列「禁止使用」的废弃名表，读者无法据此判断自己是不是正踩在第几种后果上。**
>
> **判据一句话**：**废弃名的价值不在于「别用」，在于「它长得像对的，且用错了不报错」。**
> 所以废弃名表必须能回答：**「它像不像对的？」+「用错了会怎样？」**

> **为什么废弃名也要写进契约**：只写「正确名」不够——写代码的人是从**旧代码/旧文档/记忆**里抄参数名的，
> 而废弃名的生命周期比新名字长得多。把废弃名连同「若真发生去哪查」一起登记，
> 才能让「我以为我传对了」这类静默失效**在契约层就被拦下**。
> 这也是本项目「禁列必须带理由 + 处置两栏」原则在契约层的同构应用。

#### 13.6.2.3 出参（字段级，`list` 元素逐字）

**分页外壳**（`PageResult`）：`list` / `total` / `page` / `pageSize` —— 四键逐字，缺一前端分页器就不对。

| 字段 | 类型 | 可空 | 服务端来源 | 说明 |
|---|---|---|---|---|
| `elderUserId` | string | 否 | `activity_daily_summary.elder_user_id` | 老人用户 ID（字符串化，**不是数字**——大整数会精度丢失） |
| `nickname` | string | 否 | `users.nickname` | 昵称（脱敏：仅昵称，不含手机号/证件） |
| `community` | string | **是** | `elder_profiles.community_id` → `communities.community_name` | 社区**全称**（如「天河区华颖社区」）。`null` = **档案未关联社区，是正常业务态**，前端须中性灰呈现「未关联社区」，**不可当数据错误**（A7） |
| `status` | string | 否 | `activity_daily_summary.status` | 五态：`ACTIVE`/`LOW`/`STILL`/`AWAY`/`UNKNOWN`。数据不足时**强制改写为 `UNKNOWN`**（不回落成 `LOW`） |
| `confidence` | number | 否 | `computeConfidence` | 0–1。单通道硬上限 0.6，双通道 0.85，交叉验证 ×1.3，封顶 0.95。`UNKNOWN` 时为 **0** |
| `freshnessMinutes` | number | 否 | `activity_daily_summary.data_freshness_minutes` | 数据新鲜度，**单位：分钟**。⚠️ 见下方单位口径说明 |
| `stale` | boolean | 否 | 计算得出 | 是否已过期（`freshnessMinutes × 60 > activity_signal_ttl`） |
| `explainCode` | string | 否 | `ACTIVITY_EXPLAIN` | 状态依据码（可审计） |
| `explainLabel` | string | 否 | `EXPLAIN_LABELS[explainCode]` | 依据码中文释义，**端上直接展示，禁止各自造词** |
| `partition` | string | 否 | 计算得出 | `NORMAL` / `UNKNOWN_OR_STALE`。**视觉分区硬约束的机器可读形式**——前端按此字段分区，不许自己再推一遍（推第二遍 = 两个口径） |
| `needsAttention` | boolean | 否 | 计算得出 | `UNKNOWN` / 过期 / `STILL` / `LOW` 任一成立即 true |
| `lastSignalAt` | string | **是** | `activity_daily_summary.computed_at` | ISO8601 UTC；无数据时 `null` |
| `summaryDate` | string | 否 | `activity_daily_summary.summary_date` | `YYYY-MM-DD` |
| `sparkline` | Array | 否 | 近 N 日聚合行 | 元素 `{ date: string; activityScore: number; status: string }`，**升序**，不足 N 日按实际天数 |
| `disclaimer` | string | 否 | `ACTIVITY_DISCLAIMER` | 固定免责文案，**端上必须原样展示，不得省略** |

> **🔴 `freshnessMinutes` vs `freshnessSec`：单位口径不统一（本节显式登记，不掩盖）**
>
> | 侧 | 字段 | 单位 |
> |---|---|---|
> | 服务端（本契约登记口径） | `freshnessMinutes` | **分钟** |
> | 前端 `ActivityElderRow` | `freshnessSec` | **秒** |
> | DB 列 | `data_freshness_minutes` | **分钟** |
>
> 同一个量三个名字两个单位。**这不是笔误，是三次独立实现各自选的**——
> 服务端直出 DB 列名、前端自己换算成秒、mock 另起一个名。
> 处置：**统一到 `freshnessSec`（秒）**（主理人裁定，承钧执行），
> 改法是服务端出参改名 + 值换算（`× 60`），DB 列名**不动**（`data_freshness_minutes` 是落库口径，与出参口径不是一件事）。
> **在承钧改完之前，本表登记服务端现状 `freshnessMinutes`（分钟）并在此标注**——
> 契约登记「现状 + 待改」比登记一个不存在的字段诚实。
>
> **为什么单位不统一比字段名不统一更危险**：字段名错了前端会拿到 `undefined` 并渲染空白，**能看出来**；
> 单位错了前端拿到一个**看起来合理的数字**（`freshnessMinutes: 360` 被当秒渲染成「6 分钟」，实际是 6 小时），
> **看不出来**——运营会以为老人刚有活动，而数据其实是 6 小时前的。

> **🔴 `partition` 是硬约束的机器可读形式**：§13.1 红线①要求「UNKNOWN 与信号过期必须单独视觉分区」。
> 服务端已算好 `partition` 字段，但前端 `ActivityElderRow` **没有这个字段**——
> 前端目前用 `r.status === UNKNOWN || r.stale` **自己推**了一遍。
> **推第二遍 = 两个口径**：服务端把 `UNKNOWN` 归到 `UNKNOWN_OR_STALE`，前端若改判定条件就会分叉。
> 处置：`partition` 进前端类型（承钧 + 映棠），前端**直接读**服务端给的，不自己推。

> **⚠️ 本表与前端 `ActivityElderRow` 的已知差集**（P10，承钧 + 映棠处理中）：
> 服务端有而前端无：`elderUserId` / `nickname` / `freshnessMinutes` / `explainLabel` / `partition` / `needsAttention` / `summaryDate` / `disclaimer`；
> 前端有而服务端无：`id` / `elderNameMasked` / `age` / `deviceStatus` / `consentStatus` / `consentScopeLevel` / `orderCount30d` / `unknownReason`。
> **两套字段名不是「差一点」，是「完全两套」**——真接后端时大面积白板。
> 本表以**服务端**为准（服务端是数据来源，且 `partition`/`explainLabel`/`disclaimer` 三项是契约硬约束的载体，
> 丢掉它们等于把红线降级成前端自觉）。前端补齐由承钧（改服务端统一 `freshnessSec`）+ 映棠（交叉门禁）分工推进。

---

### 13.6.3 `GET /admin/activity/revenue` —— 逐字参数表 + 字段级出参表

#### 13.6.3.1 请求参数（逐字）

| 参数 | 类型 | 必填 | 取值域 | 说明 |
|---|---|---|---|---|
| `start` | string | 否 | `YYYY-MM-DD` | 窗口起，**含当日**。不传 = 本自然月月初 |
| `end` | string | 否 | `YYYY-MM-DD` | 窗口止，**含当日**（服务端内部按 `[start, end+1天)` 闭开区间处理，多加一天否则漏掉当天订阅）。不传 = 本月末 |
| `months` | number | 否 | 1–24 整数，默认 6 | 月度趋势的月数（升序返回） |

> **窗口默认口径是「本自然月」不是「近 30 天」**：财务科目按月对账，
> 近 30 天窗口跨月会让月度数字与账期对不上。内部区间是**闭开** `[windowStart, windowEnd)`。
> `end` 早于或等于 `start` → 抛 `10001`「统计窗口无效：结束日期须晚于开始日期」。

#### 13.6.3.2 出参（字段级，逐字）

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `windowStart` | string | 否 | 统计窗口起，ISO8601（闭区间端点） |
| `windowEnd` | string | 否 | 统计窗口止，ISO8601（**开区间端点**——不含该时刻） |
| `windowDays` | number | 否 | 窗口天数（`(end - start)` 整天数） |
| `byTier` | Array | 否 | 分档汇总，**固定行序 `FREE` → `PRO` → `INSTITUTIONAL`**，不按金额排序（排序键变会导致行跳动，运营读不出趋势） |
| `byTier[].tier` | string | 否 | `FREE` / `PRO` / `INSTITUTIONAL` |
| `byTier[].amountFen` | string | 否 | 该档当期确认收入（**分，字符串**。禁浮点） |
| `byTier[].countedCount` | number | 否 | 该档**当期计入**的订阅笔数 |
| `byTier[].totalCount` | number | 否 | 该档**在册**订阅笔数（含未确认态与免费档；用于算付费转化） |
| `summary` | object | 否 | 汇总视图（见下） |
| `summary.totalAmountFen` | string | 否 | 当期确认收入合计（分，字符串） |
| `summary.paidCount` | number | 否 | 付费档位（`PRO` + `INSTITUTIONAL`）订阅笔数，**仅计确认态** |
| `summary.freeCount` | number | 否 | 免费档笔数 |
| `summary.avgPriceFen` | string | **是** | 客单价（分，字符串）。**无付费用户时为 `null` 而非 `"0"`** —— 这是两种不同的运营含义：「本期一个付费用户都没有」vs「客单价是 0 元」。前端**禁止把 `null` 渲染成 ¥0** |
| `summary.excludedCount` | number | 否 | 因非确认态被排除的笔数（= 在册 − 计入，差额必须可解释） |
| `trend` | Array | 否 | 月度趋势，**升序**，长度 = `months` |
| `trend[].month` | string | 否 | `YYYY-MM` |
| `trend[].amountFen` | string | 否 | 该月确认收入（分，字符串） |
| `excludedReasons` | Array | 否 | 排除原因分布（**报表数与在册数差额必须能解释**） |
| `excludedReasons[].reason` | string | 否 | 排除原因码，取值域见下表 |
| `excludedReasons[].count` | number | 否 | 该原因笔数 |
| `details` | Array | 否 | 明细（供财务逐笔复核）。**上限 500 条，超出截断** |
| `details[].subscriptionNo` | string | 否 | 订阅编号 |
| `details[].tier` | string | 否 | `FREE` / `PRO` / `INSTITUTIONAL` |
| `details[].status` | string | 否 | 订阅状态，取值域见下表 |
| `details[].priceFen` | string | 否 | 原价（分，字符串） |
| `details[].proratedFen` | string | 否 | 本期摊分确认收入（分，字符串）；未计入为 `"0"` |
| `details[].counted` | boolean | 否 | 是否计入当期收入 |
| `details[].reason` | string | 否 | 未计入原因码（`counted === true` 时为 `COUNTED`） |
| `details[].totalDays` | number | 否 | 本订阅自身跨度（天） |
| `details[].overlapDays` | number | 否 | 与统计窗口重叠天数 |
| `accountingNote` | string | 否 | 科目隔离声明（Q8）。**前端必须原样展示，不得改写、不得省略**。服务端原文即「订阅收入为独立科目，不进陪聊分账池（PRD §5 / Q8）；与分账报表分别对账。」 |

**`details[].status` 取值域**（`RevenueStatus`，逐字）：
`PENDING` / `ACTIVE` / `EXPIRED` / `CANCELLED` / `SUSPENDED`

**`details[].reason` / `excludedReasons[].reason` 取值域**（`RevenueExcludeReason`，逐字，6 个不多不少）：

| reason | 含义 |
|---|---|
| `COUNTED` | 已计入本期（`counted === true` 时的唯一取值） |
| `STATUS_NOT_CONFIRMABLE` | 订阅状态不在可确认集合内（`PENDING` / `EXPIRED` / `CANCELLED` / `SUSPENDED`） |
| `FREE_TIER_ZERO_PRICE` | 免费档（`FREE`），价格为 0，本期不产生收入 |
| `ZERO_PRICE` | 非免费档但价格为 0 |
| `NO_OVERLAP` | 订阅跨度与统计窗口无重叠天数 |
| `INVALID_SPAN` | 订阅自身跨度为 0 天（起止同日或数据异常） |

> **这个取值域是「严格划分」**：多一个原因就意味着报表与在册数差了一个**无法解释的口子**。
> 前端 `RevenueExcludeReason` 类型已逐字镜像这 6 个值，**不得新增或改名**（新增一个原因 = 多一个说不清的差额）。

> **🔴 三个「金额单位 / 可空」的硬约束**（前端渲染错了一处就是财务看错数）：
> 1. **所有金额是「分」的字符串**（`amountFen` / `totalAmountFen` / `priceFen` / `proratedFen` / `avgPriceFen`）——**禁浮点**。字符串是刻意的：JS 的 `Number` 承载不了分级的分精度。
> 2. **`avgPriceFen` 可空且空值是 `null` 不是 `"0"`** —— 前端禁止渲染成 ¥0。
> 3. **`windowEnd` 是开区间端点** —— 展示成「含当日」会让财务对不上账期。

> **🔴 摊分口径（前端不做任何推算）**：采用**累计比例差分法**
> （服务端 `domain/revenue.ts` 的 `prorateSubscription`）。
> 年费用户**每月都有**确认收入，不是首月一次性入账——所以「本月入账」不会因为来了个年费单就突然跳一大截。
> 前端**只展示服务端给的数**，任何「按天折算」的前端推算都是错的。
> 边界订阅（`start_at` 早于窗口但 `end_at` 晚于窗口）**同样计入**——
> 服务端取数按窗口**前后各外扩**再在应用层过滤，若直接用 `where` 卡窗口会漏掉整批跨界订阅，
> 表现为「老用户越多、报表营收越低」（方向明确但极难自查的错）。

> **⚠️ `details` 硬上限 500 条，超出即截断，且当前出参**不携带** `truncated` 标记**。
> 财务逐笔复核时若明细数恰好是 500，**无法区分「正好 500 条」与「被截断了」**——
> 这是本表已登记的已知缺口（与 §5.7.7 的 `truncated` 标记同源问题，但 revenue 端**尚未补**）。
> 处置方向：服务端补 `truncated: boolean`（与 changelog 端同口径），前端在 `true` 时提示「明细已截断，请缩小窗口」。
> **在补上之前，契约明确写「上限 500」而不是留白** —— 留白会让前端误以为看到的是全量。

---

### 13.7 系统端（设备/worker，非三端可见）

| 方法 | 路径 | 域函数 | 说明 |
|---|---|---|---|
| POST | `/activity/ingest` | — | 同 §13.3（设备令牌鉴权 `X-Device-Token`） |
| cron | `activity:daily-aggregate` | `classifyActivityStatus` + `computeConfidence` | 日聚合（写 `activity_daily_summary`） |
| cron | `activity:alert:sweep` | `shouldSuppressAlert` + `crossVerifySatisfied` | 久静/离线告警扫描（`activity_still_alert_min`；同类告警 `activity_alert_suppress_min=180` **闭区间**内不重复推送，`24003`） |
| cron | `activity:retention:sweep` | — | 原始特征留存清理（14 天），清理后写 `audit_logs` |
| cron | `activity:lead-trigger:sweep` | `detectLeadTriggers` | 引流触发器扫描（下降幅度/连续低活跃/新装体验），触点落 `activity_touchpoints` |

> **`POST /activity/ingest` 与 §13.3 是同一个端点**，不是两个。此处从系统视角补充其链路与幂等要求：① 幂等键 = `device_id + window_start`，Redis 占位 24h，重复上报回放首次结果；② 写库前在内存完成 HMAC 化（SSID/BSSID/MAC → `*_hmac`），**原文不出服务进程、不入日志**；③ `retained_until = window_end + activity_signal_retention_days`（14 天硬上限），留存 sweep 到期清理并写 `audit_logs`。

### 13.8 配置项（11 项，全部并入 `system_configs`，不建独立配置表）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `activity_watch_enabled` | BOOL | `false` | 感知总开关（默认关= opt-in；关闭时采集入口直接拒绝） |
| `activity_signal_ttl` | INT(秒) | `21600` | 超期分级强制回落 UNKNOWN |
| `activity_still_alert_min` | INT(分钟) | `240` | 久静告警阈值 |
| `activity_low_trend_window_days` | INT(天) | `3` | 连续低活跃判定窗口 |
| `activity_drop_pct_threshold` | INT(%) | `30` | 活动量下降**超**此比例触发引流触发器①（恰好 30% 不触发） |
| `activity_alert_suppress_min` | INT(分钟) | `180` | 同类告警抑制窗口（闭区间：恰好 180 分钟仍抑制） |
| `activity_signal_retention_days` | INT(天) | `14` | 原始特征留存硬上限 |
| `activity_dispatch_bonus_low` | INT(分) | `5` | LOW 加成分数（乘数语义已废弃，库中不再有 `weight_*` 键） |
| `activity_dispatch_bonus_still` | INT(分) | `10` | STILL 加成分数（同上） |
| `activity_cross_verify_required` | BOOL | `true` | 紧急告警强制双通道交叉验证（代码内锁死，配置仅留痕） |
| `activity_lead_incentive_newinstall` | INT(分) | `2000` | 新装体验券额度（列获客成本科目，不进分账池） |

### 13.9 引流触发器与漏斗归因

| 触发器 | 判定（`domain/activity.ts` `detectLeadTriggers`） | 触达 |
|---|---|---|
| `ACTIVITY_DROP` | 观察窗均值较基线下降**严格大于** `activity_drop_pct_threshold` | `LOW_TREND` 告警 + 关怀触达 |
| `LOW_TREND` | 连续 `activity_low_trend_window_days` 天 `status ∈ {LOW, STILL}` | 推荐位 / 派单加成 |
| `NEWINSTALL_EXPERIENCE` | `isNewInstall` 且渠道已激活 | **注册即发券**，券 `source=ACTIVITY_LEAD`，并与 `activity_touchpoints.touchpoint_id` 关联（归因链不断） |

触点全部落 `activity_touchpoints`（7 类枚举），漏斗报表口径与 `GET /admin/activity/funnel` 一致。

**`channelKey` 出参口径（契约级约定，主理人 2026-10 裁定）**

`GET /admin/activity/funnel?dimension=community` 的 `channelKey` 出参
= **`communities.community_code`**（如 `GZ_TH_HUAYING`），**不是数据库自增 id，不是数组下标**。

理由：运营要拿这个 key 做投放归因与去重，必须**跨环境稳定**。
自增 id 一旦换库/重建数据就变；下标根本不成立——
下标派生的 key 把「数组顺序」这个纯实现细节泄漏成了业务标识，
而真接后端后社区表返回顺序由 SQL 决定（无 `ORDER BY` 时 MySQL 不保证顺序），
同一份代码在不同环境下会产出不同的归因结果，**这类不一致无法被任何测试发现，
因为它在每个环境里都是自洽的**。

配套：`channelLabel` 出参 = `communities.community_name` 全称（带行政区前缀，如「天河区华颖社区」）。
社区名口径见 A7 ——**采纳「不加 `district` 列、`community_name` 存全称」**（宋砚秋落盘口径）。
若将来确需按行政区出数：**加 `district` 列，但 `community_name` 保持全称 `@unique` 不动**。

> **约束：`district` 一旦加列，不得反向用于重命名 `community_name`。**
> 否则会出现「`community_name` 全称里含区名 + `district` 列里又是区名」的重复存储，
> 将来行政区改名要同时改两处——那正是我们选独立社区表要消灭的分叉。

`dimension=trigger` 的 `channelKey` 同理 = **`activity_touch_channel` 枚举值**（七值），
不是触点文案、也不是漏斗层序号。

### 13.10 schema 定稿状态清单（A1–A6 全部闭环，A7 待产品）

| 项 | 依赖的字段 / 能力 | 当前状态 | 影响端点 |
|---|---|---|---|
| A1 派单三列 | `orders.dispatch_base_score` / `dispatch_activity_bonus` / `dispatch_reason_code` | **已定稿并落 schema**（主理人裁定加在 `orders` 表；`dispatch_reason_code` 存 `ACTIVITY_BONUS_REASON` 三值，**非** `ACTIVITY_EXPLAIN` 七值） | §13.5 派单推送、`GET /orders/dispatch/pool` |
| A2 投诉举报人兜底 | `complaints.complainant_id` 为 NOT NULL FK | **✅ 已定稿（主理人裁定 2026-10）：escalate 落 `complaints` 工单，`complainant_id` 记系统服务账号（`users.role=SYSTEM` + `is_system=true`），`complainant_role` 记 `SYSTEM`，并写 `audit_logs` 留痕（Q11）**。同时**复用 SOS 出口**（紧急联系人短信 + 绑定子女 IM + 到岗态订单 `suspendOrderForSafety`）——两条路径并存：工单是留痕与追责载体，SOS 出口是时效保障 | §13.6 `POST /admin/activity/alerts/:id/escalate` |
| A3 告警确认人 | `health_alerts.ack_by` / `ack_by_role` / `ack_at` | **✅ 已定稿（主理人裁定 2026-10）：三字段早已在 schema 落定**——`ack_by` BigInt?（跨域故不建 FK）、`ack_by_role` VarChar(16) 取值 `USER`（子女/老人）/ `ADMIN`（客服工作台）/ `SYSTEM`（系统服务账号）、`ack_at`。**允许 `ack_by_role=SYSTEM` 写入**（系统自动确认场景，如 cron 扫描到告警已被线下处置），`ack_by` 此时记系统服务账号 id | §13.4 `POST /activity/alerts/:id/ack`、§13.6 `ack` |
| A4 授权清理确认态 | `activity_consents.purge_status` / `unaggregated_purged_at` / `purge_error` | **已定稿并落 schema**（`activity_purge_status` 四态已镜像到 shared）。撤销与清理解耦：撤销即时停采 + 标记 `NOT_STARTED`，sweep 完成后回写 `CONFIRMED` | §13.3 `POST /activity/privacy/revoke` |
| A5 设备令牌 | `wifi_devices.device_token_hash` / `token_issued_at` / `token_expires_at` | **已定稿并落 schema**。只存 SHA-256 hex64，校验走 `safeEqualHex`（timingSafeEqual，防时序侧信道）；明文仅 bind 时返回一次 | §13.3 `POST /activity/ingest`、`POST /activity/devices/bind` |
| A6 推荐软文案 | 推荐接口文案来源 | **W-MVP 已定稿**：固定话术库 `packages/shared/src/activity-copy.ts`（`pickActivityCopy`），非 AI 生成；出参强制携带 `disclaimer`；文案不得暗示健康依据 | §13.4 `GET /activity/recommend` |
| A7 老人社区字段 | `elder_profiles.community_id` → `communities` 表 | **✅ 已定稿并落 schema（主理人裁定 2026-10，走独立 `communities` 表 + `elder_profiles.community_id BigInt?` 可空外键 + `@@index`，不污染 `orders` 合同快照；宋砚秋落 `schema.prisma:534-552`）**。`community_id` 可空——「档案没填社区」是正常业务态，接口出参为 `null`，前端须中性灰呈现不可当数据错误。社区名口径：`community_name` 存**全称**（如「天河区华颖社区」）且 `@unique`，**不加 `district` 列**；将来做区维度出数时加 `district` 但不得重命名 `community_name`（见 §13.9 约束） | §13.6 `GET /admin/activity/elders` | **【2026-10 补充】社区筛选项来源已定：服务端不提供独立社区字典端点，改由前端从 elders 返回结果的「所属社区」字段去重（见 §13.6.2.1.1）**

> **A1–A7 已全部闭环**，`modules/activity` 路由已落码。**枚举镜像由 CI 门禁保证**：`apps/server/src/modules/activity/enum-mirror.test.ts` 逐字比对 `schema.prisma` 与 `packages/shared/src/enums.ts`，schema 新增枚举而 shared 漏补会直接测试失败（该门禁上线当天即抓到 `activity_touch_channel` 漏补）。domain 层 6 个纯函数不依赖任何新表，可独立单测。
>
> **⚠ CI 门禁的覆盖边界（苏映棠补记）**：`enum-mirror` 管得到 **schema ↔ shared** 这一段，
> **管不到 mock 层自造的平行码表**。前端已因此出过一次真实事故：`OFFLINE_TOUCHPOINTS`
> 曾平行造了 `GATE_BANNER`/`UNIT_DOOR`/`GROUP_BUY`/`OPEN_DOOR_APP` 四个值，
> 真接后端时四类线下触点**全部映射不上、归因数据整体缺失且零报错**。
> 故 admin-web 侧已补「枚举门禁」：自动遍历 mock 每个集合的枚举型字段，
> 强制对齐共享枚举或显式声明「schema 里就是 String 列」并写明理由
> （`apps/admin-web/scripts/enum-guard.ts`）。**三端凡「共享包已有枚举」的域，mock/fixture 层都要有对应断言**。

### 13.11 版本与后续

- W+1（网关硬件）：启用 `CHANNEL_B_GATEWAY`，双通道交叉验证生效，新错误码启用 `25xxx` 段。
- W+2（订阅付费闭环）：订阅支付走**独立 payments 通道与独立科目**，不进陪聊分账池（Q8）；付费层卖主动预警 + AI 健康分析 + 历史回溯 + 多成员。

---
*编制：霍承钧（rnd-linban 后端架构）｜依据：ARCHITECTURE.md v1.6 §13、DATABASE.md v1.2 §8/§11、PRD MODULE-ACTIVITY-SENSE.md｜实现对照：apps/server/src/modules/*、apps/server/src/domain/activity.ts、prisma/seed.ts*
