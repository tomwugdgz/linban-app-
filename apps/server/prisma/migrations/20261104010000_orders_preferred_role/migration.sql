-- ============================================================================
-- 迁移：orders 新增供给角色偏好列 preferred_role
--        （架构 §15.8 / §15.12 C8，2026-11-04 主理人裁定）
--
-- 对应 schema.prisma 的：
--   + orders.preferred_role  companion_role?
--
-- 背景：§15.8 给 POST /orders 加了入参 preferredRole?，但首轮只有入参、无落库列，
-- 派单引擎拿不到「子女指定的角色」，C8 裁定补落库 + 调用侧补接线（C9）。
-- 四值复用 companion_role 枚举，与 companions.role 完全一致，不另立枚举。
-- ============================================================================

-- AlterTable
-- 必须可空、无默认值：NULL = 未指定（老人直用路径），与「默认共享儿子」是不同的派单语义，
-- 设 DEFAULT 'SHARED_SON' 会把两种语义混为一谈（§15.12 C8）。
-- 可空枚举列无存量回填需求；MySQL 8 ADD COLUMN ... NULL 为元数据级 ALGORITHM=INSTANT 操作。
ALTER TABLE `orders` ADD COLUMN `preferred_role` ENUM('SHARED_SON', 'TIME_BANK', 'VOLUNTEER', 'PROFESSIONAL') NULL;

-- 刻意不建索引：该列只随订单主档读取（下单写入 + 派单时随订单带出），
-- 不存在「按偏好角色反查订单」的查询形状；按 DATABASE.md §4.3，不为假想查询预留索引。
