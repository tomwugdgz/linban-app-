-- ============================================================================
-- 存量 user_coupons 面额快照回填（team-lead 裁定 2026-10）
-- ----------------------------------------------------------------------------
-- 为什么必须用SQL 批量 UPDATE 而不能用 Prisma 逐条：
--   量级大了逐条 UPDATE 会把事务拉长到超时，且每条都要往返一次 DB。
--   一条 JOIN UPDATE 搞定，且天然幂等（WHERE value_snapshot IS NULL）。
--
-- 为什么这一步是上线阻塞：
--   回填前，所有存量券的 value_snapshot 都是 NULL，核销会走「回退读模板」
--   分支。此时若运营改了模板面额，存量券的面额会跟着变（资损）。
--   回填完成后，快照冻结面额，改模板不再影响存量券。
--
-- 【上线前必须验证】（team-lead 要求，纳入部署检查清单）：
--   SELECT COUNT(*) FROM user_coupons WHERE value_snapshot IS NULL;
--   必须为 0。不为 0 说明还有券在走回退分支。
--   注意：DRAFT 状态未投放的模板不会有 user_coupons 记录；
--   若确有脏数据导致 count 不为 0，需人工核对而非放宽 WHERE 条件。
--
-- 【NULL 回填的边界说明】
--   模板 value 为 NULL 时保持 NULL（而非填 0）：
--   填 0 会让「快照缺失」变成「面额为 0」，两种问题的处置方式完全不同。
--   coupons.value 是 NOT NULL，理论上不会出现，此处是防御。
-- ============================================================================

UPDATE `user_coupons` uc
JOIN `coupons` c ON uc.`coupon_id` = c.`id`
SET uc.`value_snapshot` = c.`value`
WHERE uc.`value_snapshot` IS NULL
  AND c.`value` IS NOT NULL;