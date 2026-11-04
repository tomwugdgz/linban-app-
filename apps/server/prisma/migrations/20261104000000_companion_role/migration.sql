-- ============================================================================
-- 迁移：companions 新增供给身份列 role（架构 §15，2026-11-04 主理人裁定）
--
-- 对应 schema.prisma 的：
--   + enum companion_role { SHARED_SON / TIME_BANK / VOLUNTEER / PROFESSIONAL }
--   + companions.role  companion_role  @default(SHARED_SON)
--   + @@index([status, role])
--
-- 本轮四值一次留位，双开放 SHARED_SON + PROFESSIONAL；
-- TIME_BANK / VOLUNTEER 仅留枚举位、不可创建、绝不进分账流水（§15.1 C3 / §15.4）。
-- ============================================================================

-- AlterTable
-- 存量陪聊员一律回填 'SHARED_SON'（语义：既有供给即共享儿子），不写 NULL、不做二次人工改正。
-- MySQL 8：ADD COLUMN ... NOT NULL DEFAULT 为元数据级 ALGORITHM=INSTANT 操作，
-- 加列时即按默认值填充存量行，无需单独 UPDATE 回填脚本。
ALTER TABLE `companions` ADD COLUMN `role` ENUM('SHARED_SON', 'TIME_BANK', 'VOLUNTEER', 'PROFESSIONAL') NOT NULL DEFAULT 'SHARED_SON';

-- CreateIndex
-- 后台陪聊员列表按角色筛选 + 运营看板「状态 × 角色」聚合（架构 §15.8）。
-- 索引名与 Prisma @@index([status, role]) 生成规则一致：<table>_<col1>_<col2>_idx。
-- 按 DATABASE.md §4.3，枚举状态列不单独建索引，均以 (status, <第二列>) 联合形态出现。
CREATE INDEX `companions_status_role_idx` ON `companions`(`status`, `role`);
