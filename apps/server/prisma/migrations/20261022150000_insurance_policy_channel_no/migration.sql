-- ============================================================================
-- 迁移：insurance_policies 拆分「我方单号」与「渠道单号」
--
-- 背景（2026-10-22，team-lead 裁定 + 承钧实测）：
--   原实现 `MockInsuranceAdapter.createPolicy` 硬编码拼接保单号
--     `POL${Date.now()}${orderNo.slice(-6)}`（22 字符），
--   绕过了 BIZ_NO_PREFIX 号段体系；而 BIZ_NO_PREFIX 已登记 `policy: 'POL'`，
--   成为「登记未使用」的死键。
--   即：**同一业务两种单号已经发生**（adapter 硬编码 vs 号段登记），不是未来风险。
--
--   更硬的一点：`policy_no` 已对外暴露
--     （docs/API-CONTRACT.md 登记 POST /insurance/policies/:policyNo/claim），
--   且**存量格式已固化**，所以本期**不做存量数据迁移**（见 DEPLOYMENT.md）。
--   本期只做：① 新单号改走 genBizNo('policy') 收敛入口  ② 渠道单号独立成列。
--
-- 本文件对应 schema.prisma 的：
--   + channel_policy_no  String? @db.VarChar(64)
--   + insurer_code       String? @db.VarChar(32)
--   + @@index([channel_policy_no])
--
-- ⚠️ 真机验证状态（按「已验证必须留痕」纪律）：
--   **截至本文件落盘，从未在任何真实 MySQL 上执行过。**
--   已做的离线验证仅两项：① `npm run prisma:migrate:check`（迁移链末态 ≡ schema）
--   ② `npx prisma generate` + `tsc --noEmit` 退出码 0。
--   两者**都不证明本 SQL 能在真实 MySQL 上跑通** —— 详见 DEPLOYMENT.md §0/§6。
-- ============================================================================

-- AlterTable
-- 🔴 可空（NULL）而非 NOT NULL：存量行**没有渠道单号**，
--   加 NOT NULL 会要求回填，而回填需要先有渠道 —— 那是接渠道时的事，不该被本次迁移卡住。
--   MySQL 方言核对：ADD COLUMN ... NULL 在 8.0 上无需 DEFAULT，直接可空。
ALTER TABLE `insurance_policies` ADD COLUMN `channel_policy_no` VARCHAR(64) NULL;

-- AlterTable
ALTER TABLE `insurance_policies` ADD COLUMN `insurer_code` VARCHAR(32) NULL;

-- CreateIndex
-- 渠道回调按渠道单号反查保单（接入真实渠道后必需）。
-- MySQL 方言核对：普通 CREATE INDEX，列名与 Prisma @@index([channel_policy_no]) 一致。
-- ⚠️ 索引名 `insurance_policies_channel_policy_no_idx` 长31 字符 < 64，MySQL 上限安全。
CREATE INDEX `insurance_policies_channel_policy_no_idx` ON `insurance_policies`(`channel_policy_no`);

-- ============================================================================
-- 存量数据处置（**刻意不做**，理由记录在此以免后人重复推导）
-- ============================================================================
-- `policy_no` 存在两种历史格式：
--   ① 旧：`POL{13位时间戳}{orderNo后6位}` = 22 字符
--   ② 新：`POL{yyyyMMdd}{10位随机}`        = 21 字符
-- **不做 UPDATE 统一格式**，理由三条：
--   1. 存量单号已对外暴露并写入用户手持的保单凭证，改格式 = 破坏性变更；
--   2. 存量单号都能通过 `findUnique({ policy_no })` 精确查回（唯一索引兜底），
--      **没有实际危害**—— 为「格式好看」去动生产数据是风险大于收益；
--   3. 入口统一后格式会自然收敛（新数据用新格式），历史数据不需要迁移。
--
-- ⚠️ **解析保单号时不得依赖格式**（前缀截断/长度判断都会在两种格式间失效），
--    只能精确匹配查库。这条已写进 schema.prisma 的字段注释。