-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `openid` VARCHAR(64) NOT NULL,
    `unionid` VARCHAR(64) NULL,
    `phone_cipher` VARCHAR(512) NULL,
    `phone_hmac` VARCHAR(64) NULL,
    `nickname` VARCHAR(64) NOT NULL,
    `avatar_url` VARCHAR(512) NULL,
    `role` ENUM('ELDER', 'FAMILY', 'COMPANION', 'SYSTEM') NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'FROZEN', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_openid_key`(`openid`),
    UNIQUE INDEX `users_phone_hmac_key`(`phone_hmac`),
    INDEX `users_role_status_idx`(`role`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `elder_profiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `gender` VARCHAR(8) NULL,
    `birthday` DATE NULL,
    `interests` JSON NULL,
    `health_boundaries` JSON NULL,
    `topic_heat` JSON NULL,
    `preferences` JSON NULL,
    `emergency_contact_name_cipher` VARCHAR(512) NULL,
    `emergency_contact_phone_cipher` VARCHAR(512) NULL,
    `emergency_contact_relation` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `elder_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `family_bindings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `family_user_id` BIGINT NOT NULL,
    `elder_user_id` BIGINT NOT NULL,
    `relation` VARCHAR(16) NOT NULL,
    `auth_level` ENUM('BASIC', 'PROGRESS', 'FULL') NOT NULL DEFAULT 'BASIC',
    `status` ENUM('PENDING', 'ACTIVE', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `active_key` VARCHAR(8) NULL,
    `bound_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `family_bindings_elder_user_id_status_idx`(`elder_user_id`, `status`),
    UNIQUE INDEX `family_bindings_family_user_id_elder_user_id_active_key_key`(`family_user_id`, `elder_user_id`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `real_name_cipher` VARCHAR(512) NOT NULL,
    `id_card_cipher` VARCHAR(512) NOT NULL,
    `id_card_hmac` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED', 'RETIRED') NOT NULL DEFAULT 'PENDING',
    `level` INTEGER NOT NULL DEFAULT 1,
    `credit_score` INTEGER NOT NULL DEFAULT 100,
    `hourly_rate_fen` BIGINT NOT NULL,
    `service_radius_m` INTEGER NOT NULL DEFAULT 3000,
    `anchor_lat` DECIMAL(10, 7) NOT NULL,
    `anchor_lng` DECIMAL(10, 7) NOT NULL,
    `geo_hash` VARCHAR(12) NOT NULL,
    `tags` JSON NULL,
    `rating_avg` DECIMAL(2, 1) NOT NULL DEFAULT 0,
    `rating_count` INTEGER NOT NULL DEFAULT 0,
    `total_orders` INTEGER NOT NULL DEFAULT 0,
    `completed_orders` INTEGER NOT NULL DEFAULT 0,
    `cancelled_orders` INTEGER NOT NULL DEFAULT 0,
    `deposit_balance_fen` BIGINT NOT NULL DEFAULT 0,
    `retired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `companions_user_id_key`(`user_id`),
    UNIQUE INDEX `companions_id_card_hmac_key`(`id_card_hmac`),
    INDEX `companions_status_geo_hash_idx`(`status`, `geo_hash`),
    INDEX `companions_status_credit_score_idx`(`status`, `credit_score`),
    INDEX `companions_status_level_idx`(`status`, `level`),
    INDEX `companions_status_hourly_rate_fen_idx`(`status`, `hourly_rate_fen`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companion_applications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `application_no` VARCHAR(32) NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `stage` ENUM('APPLIED', 'REALNAME_OK', 'FACE_OK', 'CRIMINAL_OK', 'TRAINING', 'EXAM_OK', 'DEPOSIT_OK', 'ACTIVE', 'SUSPENDED', 'BANNED') NOT NULL DEFAULT 'APPLIED',
    `active_key` VARCHAR(8) NULL,
    `realname_status` ENUM('PENDING', 'PASSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `realname_reviewer_id` BIGINT NULL,
    `realname_reviewed_at` DATETIME(3) NULL,
    `realname_comment` VARCHAR(512) NULL,
    `realname_ocr_biz_id` VARCHAR(64) NULL,
    `face_status` ENUM('PENDING', 'PASSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `face_reviewer_id` BIGINT NULL,
    `face_reviewed_at` DATETIME(3) NULL,
    `face_comment` VARCHAR(512) NULL,
    `face_verify_id` VARCHAR(64) NULL,
    `face_score` INTEGER NULL,
    `face_photo_file_id` BIGINT NULL,
    `criminal_status` ENUM('PENDING', 'PASSED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `criminal_reviewer_id` BIGINT NULL,
    `criminal_reviewed_at` DATETIME(3) NULL,
    `criminal_comment` VARCHAR(512) NULL,
    `criminal_material_file_id` BIGINT NULL,
    `training_completed_at` DATETIME(3) NULL,
    `training_course_ids` JSON NULL,
    `exam_score` INTEGER NULL,
    `exam_attempt_no` INTEGER NOT NULL DEFAULT 0,
    `exam_passed_at` DATETIME(3) NULL,
    `deposit_tx_id` BIGINT NULL,
    `deposit_amount_fen` BIGINT NULL,
    `deposit_paid_at` DATETIME(3) NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decided_at` DATETIME(3) NULL,
    `decided_by` BIGINT NULL,
    `decided_note` VARCHAR(512) NULL,
    `reject_reason` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companion_applications_application_no_key`(`application_no`),
    INDEX `companion_applications_stage_created_at_idx`(`stage`, `created_at`),
    UNIQUE INDEX `companion_applications_companion_id_active_key_key`(`companion_id`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companion_certifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `companion_id` BIGINT NOT NULL,
    `cert_type` VARCHAR(32) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `score` INTEGER NULL,
    `passed` BOOLEAN NOT NULL DEFAULT false,
    `certificate_no` VARCHAR(64) NULL,
    `valid_from` DATE NULL,
    `valid_until` DATE NULL,
    `file_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `companion_certifications_companion_id_cert_type_idx`(`companion_id`, `cert_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `companion_schedules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `companion_id` BIGINT NOT NULL,
    `date` DATE NULL,
    `weekday` INTEGER NULL,
    `start_time` VARCHAR(5) NOT NULL,
    `end_time` VARCHAR(5) NOT NULL,
    `status` ENUM('AVAILABLE', 'BLACKOUT') NOT NULL DEFAULT 'AVAILABLE',
    `note` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `companion_schedules_companion_id_status_idx`(`companion_id`, `status`),
    INDEX `companion_schedules_companion_id_weekday_idx`(`companion_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `credit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `companion_id` BIGINT NOT NULL,
    `change_score` INTEGER NOT NULL,
    `type` ENUM('GOOD_REVIEW', 'BAD_REVIEW', 'CANCEL', 'IM_VIOLATION', 'FLY_ORDER', 'MANUAL', 'SYSTEM') NOT NULL,
    `before_score` INTEGER NOT NULL,
    `after_score` INTEGER NOT NULL,
    `reason` VARCHAR(256) NOT NULL,
    `related_order_id` BIGINT NULL,
    `operator_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `credit_logs_companion_id_created_at_idx`(`companion_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deposit_transactions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tx_no` VARCHAR(32) NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `type` ENUM('IN', 'OUT', 'PENALTY') NOT NULL,
    `amount_fen` BIGINT NOT NULL,
    `balance_after_fen` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `wx_transaction_id` VARCHAR(64) NULL,
    `related_type` VARCHAR(32) NULL,
    `related_id` BIGINT NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `remark` VARCHAR(256) NULL,
    `succeeded_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `deposit_transactions_tx_no_key`(`tx_no`),
    UNIQUE INDEX `deposit_transactions_idempotency_key_key`(`idempotency_key`),
    INDEX `deposit_transactions_companion_id_created_at_idx`(`companion_id`, `created_at`),
    INDEX `deposit_transactions_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `penalty_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `companion_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `risk_event_id` BIGINT NULL,
    `report_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `deposit_deduct_fen` BIGINT NOT NULL DEFAULT 0,
    `credit_deduct` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(256) NOT NULL,
    `evidence_file_ids` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `operator_id` BIGINT NULL,
    `executed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `penalty_records_companion_id_created_at_idx`(`companion_id`, `created_at`),
    INDEX `penalty_records_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(32) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `elder_user_id` BIGINT NOT NULL,
    `companion_id` BIGINT NULL,
    `status` ENUM('CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'COMPLETED', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'REFUNDED') NOT NULL DEFAULT 'CREATED',
    `service_type` ENUM('CHAT', 'ACCOMPANY') NOT NULL DEFAULT 'CHAT',
    `duration_minutes` INTEGER NOT NULL,
    `service_date` DATE NOT NULL,
    `slot_start` DATETIME(3) NOT NULL,
    `slot_end` DATETIME(3) NOT NULL,
    `slot_guard` VARCHAR(8) NULL,
    `hourly_rate_fen` BIGINT NOT NULL,
    `original_amount_fen` BIGINT NOT NULL,
    `coupon_deduct_fen` BIGINT NOT NULL DEFAULT 0,
    `gift_card_deduct_fen` BIGINT NOT NULL DEFAULT 0,
    `total_amount_fen` BIGINT NOT NULL,
    `address_cipher` VARCHAR(1024) NOT NULL,
    `geo_hash` VARCHAR(12) NOT NULL,
    `elder_lat` DECIMAL(10, 7) NOT NULL,
    `elder_lng` DECIMAL(10, 7) NOT NULL,
    `distance_m` INTEGER NOT NULL DEFAULT 0,
    `night_order` BOOLEAN NOT NULL DEFAULT false,
    `family_confirmer_id` BIGINT NULL,
    `family_confirmed_at` DATETIME(3) NULL,
    `dispatched_at` DATETIME(3) NULL,
    `dispatch_deadline_at` DATETIME(3) NULL,
    `dispatch_base_score` INTEGER NOT NULL DEFAULT 0,
    `dispatch_activity_bonus` INTEGER NOT NULL DEFAULT 0,
    `dispatch_reason_code` VARCHAR(32) NULL,
    `accepted_at` DATETIME(3) NULL,
    `arrived_at` DATETIME(3) NULL,
    `service_started_at` DATETIME(3) NULL,
    `service_ended_at` DATETIME(3) NULL,
    `pending_confirm_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `suspended_at` DATETIME(3) NULL,
    `suspend_reason` VARCHAR(256) NULL,
    `cs_decision` VARCHAR(32) NULL,
    `cs_operator_id` BIGINT NULL,
    `closed_at` DATETIME(3) NULL,
    `cancel_initiator` ENUM('USER', 'COMPANION', 'PLATFORM', 'TIMEOUT') NULL,
    `cancel_reason` VARCHAR(256) NULL,
    `cancel_fee_fen` BIGINT NOT NULL DEFAULT 0,
    `refund_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `remark` VARCHAR(512) NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `created_via` VARCHAR(16) NOT NULL DEFAULT 'ELDER_APP',
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_order_no_key`(`order_no`),
    UNIQUE INDEX `orders_idempotency_key_key`(`idempotency_key`),
    INDEX `orders_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `orders_elder_user_id_status_idx`(`elder_user_id`, `status`),
    INDEX `orders_companion_id_status_service_date_idx`(`companion_id`, `status`, `service_date`),
    INDEX `orders_status_dispatch_deadline_at_idx`(`status`, `dispatch_deadline_at`),
    INDEX `orders_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `orders_companion_id_service_date_slot_start_slot_guard_key`(`companion_id`, `service_date`, `slot_start`, `slot_guard`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_timeline` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `from_status` ENUM('CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'COMPLETED', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'REFUNDED') NULL,
    `to_status` ENUM('CREATED', 'PAID', 'DISPATCHED', 'ACCEPTED', 'ARRIVED', 'IN_SERVICE', 'PENDING_CONFIRM', 'COMPLETED', 'SUSPENDED', 'CANCELLED', 'CLOSED', 'REFUNDED') NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `operator_type` ENUM('USER', 'COMPANION', 'ADMIN', 'SYSTEM') NOT NULL,
    `operator_id` BIGINT NULL,
    `reason` VARCHAR(256) NULL,
    `extra` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_timeline_order_id_id_idx`(`order_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `payment_no` VARCHAR(32) NOT NULL,
    `order_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'WX_JSAPI',
    `amount_fen` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'SUCCESS', 'REFUNDED', 'CLOSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `profit_sharing` BOOLEAN NOT NULL DEFAULT true,
    `wx_out_trade_no` VARCHAR(32) NOT NULL,
    `wx_prepay_id` VARCHAR(64) NULL,
    `wx_transaction_id` VARCHAR(64) NULL,
    `paid_at` DATETIME(3) NULL,
    `refund_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `refunded_at` DATETIME(3) NULL,
    `wx_refund_id` VARCHAR(64) NULL,
    `fail_reason` VARCHAR(256) NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_payment_no_key`(`payment_no`),
    UNIQUE INDEX `payments_wx_out_trade_no_key`(`wx_out_trade_no`),
    UNIQUE INDEX `payments_idempotency_key_key`(`idempotency_key`),
    INDEX `payments_status_created_at_idx`(`status`, `created_at`),
    INDEX `payments_wx_transaction_id_idx`(`wx_transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `profit_sharing_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `sharing_no` VARCHAR(32) NOT NULL,
    `order_id` BIGINT NOT NULL,
    `payment_id` BIGINT NOT NULL,
    `status` ENUM('FROZEN', 'SHARED', 'RETURNED') NOT NULL DEFAULT 'FROZEN',
    `frozen_amount_fen` BIGINT NOT NULL,
    `platform_commission_fen` BIGINT NOT NULL,
    `companion_income_fen` BIGINT NOT NULL,
    `commission_rate_bp` INTEGER NOT NULL,
    `wx_transaction_id` VARCHAR(64) NOT NULL,
    `wx_sharing_order_no` VARCHAR(64) NULL,
    `shared_at` DATETIME(3) NULL,
    `return_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `wx_return_no` VARCHAR(64) NULL,
    `returned_at` DATETIME(3) NULL,
    `return_reason` VARCHAR(256) NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `last_error` VARCHAR(512) NULL,
    `manual_ticket_no` VARCHAR(64) NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `profit_sharing_records_sharing_no_key`(`sharing_no`),
    UNIQUE INDEX `profit_sharing_records_idempotency_key_key`(`idempotency_key`),
    INDEX `profit_sharing_records_order_id_idx`(`order_id`),
    INDEX `profit_sharing_records_status_created_at_idx`(`status`, `created_at`),
    INDEX `profit_sharing_records_wx_transaction_id_idx`(`wx_transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `withdrawal_no` VARCHAR(32) NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `amount_fen` BIGINT NOT NULL,
    `fee_fen` BIGINT NOT NULL DEFAULT 0,
    `actual_amount_fen` BIGINT NOT NULL,
    `bank_account_cipher` VARCHAR(512) NOT NULL,
    `bank_name` VARCHAR(64) NOT NULL,
    `account_name_cipher` VARCHAR(512) NOT NULL,
    `status` ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING_REVIEW',
    `face_verified` BOOLEAN NOT NULL DEFAULT false,
    `sms_verified` BOOLEAN NOT NULL DEFAULT false,
    `reviewer_id` BIGINT NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reject_reason` VARCHAR(256) NULL,
    `wx_batch_no` VARCHAR(64) NULL,
    `wx_transaction_id` VARCHAR(64) NULL,
    `paid_at` DATETIME(3) NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `withdrawals_withdrawal_no_key`(`withdrawal_no`),
    UNIQUE INDEX `withdrawals_idempotency_key_key`(`idempotency_key`),
    INDEX `withdrawals_companion_id_created_at_idx`(`companion_id`, `created_at`),
    INDEX `withdrawals_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reconciliation_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `batch_no` VARCHAR(32) NOT NULL,
    `batch_date` DATE NOT NULL,
    `channel` ENUM('WX_PAY', 'WX_SHARING', 'WX_REFUND', 'WX_WITHDRAW') NOT NULL,
    `local_count` INTEGER NOT NULL DEFAULT 0,
    `local_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `wx_count` INTEGER NOT NULL DEFAULT 0,
    `wx_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `match_count` INTEGER NOT NULL DEFAULT 0,
    `diff_count` INTEGER NOT NULL DEFAULT 0,
    `diff_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'RUNNING', 'MATCHED', 'DIFF', 'RESOLVED') NOT NULL DEFAULT 'PENDING',
    `diff_detail` JSON NULL,
    `bill_downloaded_at` DATETIME(3) NULL,
    `resolved_by` BIGINT NULL,
    `resolved_at` DATETIME(3) NULL,
    `resolve_note` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `reconciliation_records_batch_no_key`(`batch_no`),
    INDEX `reconciliation_records_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `reconciliation_records_batch_date_channel_key`(`batch_date`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `type` ENUM('ARRIVAL', 'COMPLETION') NOT NULL,
    `status` ENUM('PENDING', 'PASSED', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `attempt_no` INTEGER NOT NULL DEFAULT 1,
    `dynamic_code` VARCHAR(6) NULL,
    `code_mode` ENUM('ELDER_SHOW', 'COMPANION_SCAN') NULL,
    `code_sent_at` DATETIME(3) NULL,
    `code_expires_at` DATETIME(3) NULL,
    `code_verified_at` DATETIME(3) NULL,
    `face_score` INTEGER NULL,
    `face_passed` BOOLEAN NULL,
    `liveness_score` INTEGER NULL,
    `face_verify_id` VARCHAR(64) NULL,
    `gps_lat` DECIMAL(10, 7) NULL,
    `gps_lng` DECIMAL(10, 7) NULL,
    `gps_deviation_m` INTEGER NULL,
    `arrived_at` DATETIME(3) NULL,
    `companion_confirmed_at` DATETIME(3) NULL,
    `elder_confirmed_at` DATETIME(3) NULL,
    `elder_voice_asr` VARCHAR(256) NULL,
    `completion_note` VARCHAR(256) NULL,
    `fail_reason` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `verifications_order_id_status_idx`(`order_id`, `status`),
    INDEX `verifications_companion_id_created_at_idx`(`companion_id`, `created_at`),
    UNIQUE INDEX `verifications_order_id_type_attempt_no_key`(`order_id`, `type`, `attempt_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_meta` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `object_key` VARCHAR(512) NOT NULL,
    `bucket` VARCHAR(64) NOT NULL,
    `region` VARCHAR(32) NULL,
    `uploader_id` BIGINT NULL,
    `uploader_role` VARCHAR(16) NULL,
    `biz_type` VARCHAR(32) NULL,
    `biz_id` BIGINT NULL,
    `file_type` ENUM('FACE_PHOTO', 'LIVENESS_VIDEO', 'ID_CARD_FRONT', 'ID_CARD_BACK', 'CRIMINAL_CERT', 'TRAINING_MATERIAL', 'SERVICE_LOG', 'SOS_RECORD', 'COMPLAINT_EVIDENCE', 'REPORT_EVIDENCE', 'VOICE_NOTE', 'OTHER') NOT NULL,
    `access_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL DEFAULT 'L2',
    `size_bytes` BIGINT NOT NULL DEFAULT 0,
    `content_type` VARCHAR(128) NULL,
    `sha256` VARCHAR(64) NULL,
    `access_count` INTEGER NOT NULL DEFAULT 0,
    `last_access_at` DATETIME(3) NULL,
    `last_accessor_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `file_meta_object_key_key`(`object_key`),
    INDEX `file_meta_uploader_id_created_at_idx`(`uploader_id`, `created_at`),
    INDEX `file_meta_biz_type_biz_id_idx`(`biz_type`, `biz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `evidence_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `file_meta_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `verification_id` BIGINT NULL,
    `file_type` ENUM('FACE_PHOTO', 'LIVENESS_VIDEO', 'ID_CARD_FRONT', 'ID_CARD_BACK', 'CRIMINAL_CERT', 'TRAINING_MATERIAL', 'SERVICE_LOG', 'SOS_RECORD', 'COMPLAINT_EVIDENCE', 'REPORT_EVIDENCE', 'VOICE_NOTE', 'OTHER') NOT NULL,
    `access_level` ENUM('L1', 'L2', 'L3', 'L4') NOT NULL DEFAULT 'L3',
    `remark` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `evidence_files_order_id_idx`(`order_id`),
    INDEX `evidence_files_verification_id_idx`(`verification_id`),
    INDEX `evidence_files_file_meta_id_idx`(`file_meta_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `revisit_tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_no` VARCHAR(32) NOT NULL,
    `order_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `companion_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `assignee_id` BIGINT NULL,
    `planned_at` DATETIME(3) NOT NULL,
    `done_at` DATETIME(3) NULL,
    `method` VARCHAR(16) NULL,
    `satisfaction` INTEGER NULL,
    `result_note` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `revisit_tasks_task_no_key`(`task_no`),
    INDEX `revisit_tasks_status_planned_at_idx`(`status`, `planned_at`),
    INDEX `revisit_tasks_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_conversations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `user_unread` INTEGER NOT NULL DEFAULT 0,
    `companion_unread` INTEGER NOT NULL DEFAULT 0,
    `last_message_at` DATETIME(3) NULL,
    `last_message_preview` VARCHAR(128) NULL,
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `im_conversations_order_id_key`(`order_id`),
    INDEX `im_conversations_user_id_last_message_at_idx`(`user_id`, `last_message_at`),
    INDEX `im_conversations_companion_id_last_message_at_idx`(`companion_id`, `last_message_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `conversation_id` BIGINT NOT NULL,
    `sender_id` BIGINT NOT NULL,
    `sender_role` ENUM('USER', 'COMPANION', 'SYSTEM') NOT NULL,
    `msg_type` ENUM('TEXT', 'IMAGE', 'VOICE', 'SYSTEM') NOT NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('NORMAL', 'REVOKED', 'BLOCKED') NOT NULL DEFAULT 'NORMAL',
    `review_status` ENUM('PENDING', 'PASS', 'REJECT') NOT NULL DEFAULT 'PENDING',
    `risk_event_id` BIGINT NULL,
    `file_meta_id` BIGINT NULL,
    `voice_duration_ms` INTEGER NULL,
    `asr_text` VARCHAR(1024) NULL,
    `client_msg_id` VARCHAR(64) NOT NULL,
    `read_by_user_at` DATETIME(3) NULL,
    `read_by_companion_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `im_messages_conversation_id_id_idx`(`conversation_id`, `id`),
    INDEX `im_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    INDEX `im_messages_sender_id_created_at_idx`(`sender_id`, `created_at`),
    INDEX `im_messages_review_status_created_at_idx`(`review_status`, `created_at`),
    UNIQUE INDEX `im_messages_conversation_id_client_msg_id_key`(`conversation_id`, `client_msg_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `privacy_bindings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `companion_id` BIGINT NOT NULL,
    `axb_bind_id` VARCHAR(64) NULL,
    `user_virtual_number` VARCHAR(32) NULL,
    `companion_virtual_number` VARCHAR(32) NULL,
    `status` ENUM('ACTIVE', 'EXPIRED', 'UNBOUND') NOT NULL DEFAULT 'ACTIVE',
    `bound_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expired_at` DATETIME(3) NULL,
    `unbound_at` DATETIME(3) NULL,
    `call_records` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `privacy_bindings_order_id_key`(`order_id`),
    UNIQUE INDEX `privacy_bindings_axb_bind_id_key`(`axb_bind_id`),
    INDEX `privacy_bindings_status_expired_at_idx`(`status`, `expired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `session_no` VARCHAR(32) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `message_count` INTEGER NOT NULL DEFAULT 0,
    `context_summary` VARCHAR(2048) NULL,
    `emotion_tags` JSON NULL,
    `crisis_flag` BOOLEAN NOT NULL DEFAULT false,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `last_message_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_sessions_session_no_key`(`session_no`),
    INDEX `ai_sessions_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `ai_sessions_status_last_message_at_idx`(`status`, `last_message_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `session_id` BIGINT NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `content` TEXT NOT NULL,
    `audio_object_key` VARCHAR(512) NULL,
    `audio_duration_ms` INTEGER NULL,
    `asr_text` VARCHAR(2048) NULL,
    `llm_provider` VARCHAR(32) NULL,
    `llm_model` VARCHAR(64) NULL,
    `prompt_tokens` INTEGER NULL,
    `completion_tokens` INTEGER NULL,
    `latency_ms` INTEGER NULL,
    `emotion_label` VARCHAR(32) NULL,
    `topic_label` VARCHAR(32) NULL,
    `review_status` ENUM('PENDING', 'PASS', 'REJECT') NOT NULL DEFAULT 'PENDING',
    `sampled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ai_messages_session_id_id_idx`(`session_id`, `id`),
    INDEX `ai_messages_session_id_created_at_idx`(`session_id`, `created_at`),
    INDEX `ai_messages_review_status_created_at_idx`(`review_status`, `created_at`),
    INDEX `ai_messages_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_profiles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `interest_vector` JSON NULL,
    `emotion_trend` JSON NULL,
    `topic_heat` JSON NULL,
    `loneliness_index` INTEGER NULL,
    `match_scores` JSON NULL,
    `weekly_report_generated_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_profiles_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT NOT NULL,
    `reviewer_id` BIGINT NOT NULL,
    `reviewee_id` BIGINT NOT NULL,
    `reviewer_role` ENUM('USER', 'COMPANION') NOT NULL,
    `rating` INTEGER NOT NULL,
    `tags` JSON NULL,
    `content` VARCHAR(1024) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN') NOT NULL DEFAULT 'PENDING',
    `is_anonymous` BOOLEAN NOT NULL DEFAULT false,
    `reply_content` VARCHAR(512) NULL,
    `replied_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reviews_reviewee_id_created_at_idx`(`reviewee_id`, `created_at`),
    INDEX `reviews_status_created_at_idx`(`status`, `created_at`),
    UNIQUE INDEX `reviews_order_id_reviewer_role_key`(`order_id`, `reviewer_role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `complaints` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `complaint_no` VARCHAR(32) NOT NULL,
    `complainant_id` BIGINT NOT NULL,
    `complainant_role` VARCHAR(16) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `order_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `description` VARCHAR(1024) NOT NULL,
    `evidence_file_ids` JSON NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `handler_id` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `result_note` VARCHAR(512) NULL,
    `compensation_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `complaints_complaint_no_key`(`complaint_no`),
    INDEX `complaints_status_created_at_idx`(`status`, `created_at`),
    INDEX `complaints_complainant_id_created_at_idx`(`complainant_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `gift_cards` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `card_no` VARCHAR(32) NOT NULL,
    `buyer_user_id` BIGINT NOT NULL,
    `recipient_user_id` BIGINT NULL,
    `recipient_phone_hmac` VARCHAR(64) NULL,
    `bound_user_id` BIGINT NULL,
    `face_amount_fen` BIGINT NOT NULL,
    `duration_minutes` INTEGER NOT NULL,
    `balance_amount_fen` BIGINT NOT NULL,
    `balance_duration_minutes` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'USED', 'EXPIRED', 'REFUNDED') NOT NULL DEFAULT 'ACTIVE',
    `message` VARCHAR(256) NULL,
    `purchased_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bound_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `gift_cards_card_no_key`(`card_no`),
    INDEX `gift_cards_buyer_user_id_idx`(`buyer_user_id`),
    INDEX `gift_cards_recipient_phone_hmac_idx`(`recipient_phone_hmac`),
    INDEX `gift_cards_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coupons` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `coupon_no` VARCHAR(32) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `type` ENUM('FULL_REDUCTION', 'DURATION') NOT NULL,
    `value` INTEGER NOT NULL,
    `min_spend_fen` BIGINT NOT NULL DEFAULT 0,
    `valid_days` INTEGER NOT NULL DEFAULT 30,
    `total_count` INTEGER NOT NULL DEFAULT 0,
    `claimed_count` INTEGER NOT NULL DEFAULT 0,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `scope_rules` JSON NULL,
    `start_at` DATETIME(3) NULL,
    `end_at` DATETIME(3) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_coupon_no_key`(`coupon_no`),
    INDEX `coupons_status_start_at_idx`(`status`, `start_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_coupons` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `coupon_id` BIGINT NOT NULL,
    `status` ENUM('UNUSED', 'USED', 'EXPIRED') NOT NULL DEFAULT 'UNUSED',
    `source` ENUM('REPURCHASE', 'REPORT_REWARD', 'COMPLAINT', 'INVITE', 'ACTIVITY_LEAD', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
    `used_order_id` BIGINT NULL,
    `used_at` DATETIME(3) NULL,
    `expired_at` DATETIME(3) NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_coupons_user_id_status_idx`(`user_id`, `status`),
    INDEX `user_coupons_status_expired_at_idx`(`status`, `expired_at`),
    INDEX `user_coupons_coupon_id_idx`(`coupon_id`),
    INDEX `user_coupons_source_received_at_idx`(`source`, `received_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `distributors` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `distributor_no` VARCHAR(32) NOT NULL,
    `user_id` BIGINT NULL,
    `name` VARCHAR(64) NOT NULL,
    `phone_cipher` VARCHAR(512) NOT NULL,
    `phone_hmac` VARCHAR(64) NOT NULL,
    `community_name` VARCHAR(128) NOT NULL,
    `invite_code` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    `total_commission_fen` BIGINT NOT NULL DEFAULT 0,
    `settled_commission_fen` BIGINT NOT NULL DEFAULT 0,
    `pending_commission_fen` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `distributors_distributor_no_key`(`distributor_no`),
    UNIQUE INDEX `distributors_user_id_key`(`user_id`),
    UNIQUE INDEX `distributors_phone_hmac_key`(`phone_hmac`),
    UNIQUE INDEX `distributors_invite_code_key`(`invite_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `commission_no` VARCHAR(32) NOT NULL,
    `distributor_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `related_user_id` BIGINT NULL,
    `type` ENUM('ORDER_COMMISSION', 'INVITE_REWARD') NOT NULL,
    `amount_fen` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'SETTLED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `settled_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `wx_transaction_id` VARCHAR(64) NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `commissions_commission_no_key`(`commission_no`),
    UNIQUE INDEX `commissions_idempotency_key_key`(`idempotency_key`),
    INDEX `commissions_distributor_id_created_at_idx`(`distributor_id`, `created_at`),
    INDEX `commissions_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `insurance_policies` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `policy_no` VARCHAR(64) NOT NULL,
    `order_id` BIGINT NULL,
    `insured_user_id` BIGINT NOT NULL,
    `insured_companion_id` BIGINT NULL,
    `insurer` VARCHAR(64) NOT NULL,
    `product_name` VARCHAR(128) NOT NULL,
    `coverage_amount_fen` BIGINT NOT NULL,
    `premium_fen` BIGINT NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'CLAIMING', 'CLAIMED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `claim_no` VARCHAR(64) NULL,
    `claim_status` VARCHAR(16) NULL,
    `claim_amount_fen` BIGINT NULL,
    `claimed_at` DATETIME(3) NULL,
    `remark` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `insurance_policies_policy_no_key`(`policy_no`),
    INDEX `insurance_policies_order_id_idx`(`order_id`),
    INDEX `insurance_policies_status_end_at_idx`(`status`, `end_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `risk_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `event_no` VARCHAR(32) NOT NULL,
    `type` VARCHAR(48) NOT NULL,
    `level` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'LOW',
    `subject_type` VARCHAR(16) NOT NULL,
    `subject_id` VARCHAR(64) NOT NULL,
    `order_id` BIGINT NULL,
    `im_message_id` BIGINT NULL,
    `rule_code` VARCHAR(64) NOT NULL,
    `hit_detail` JSON NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'RESOLVED', 'FALSE_POSITIVE') NOT NULL DEFAULT 'PENDING',
    `action_taken` VARCHAR(64) NULL,
    `handler_id` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `handle_note` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `risk_events_event_no_key`(`event_no`),
    INDEX `risk_events_status_level_created_at_idx`(`status`, `level`, `created_at`),
    INDEX `risk_events_subject_type_subject_id_idx`(`subject_type`, `subject_id`),
    INDEX `risk_events_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `report_no` VARCHAR(32) NOT NULL,
    `reporter_id` BIGINT NOT NULL,
    `reporter_role` VARCHAR(16) NOT NULL,
    `target_type` VARCHAR(16) NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `order_id` BIGINT NULL,
    `type` VARCHAR(32) NOT NULL,
    `description` VARCHAR(1024) NOT NULL,
    `evidence_file_ids` JSON NULL,
    `status` ENUM('PENDING', 'SUBSTANTIATED', 'UNFOUNDED') NOT NULL DEFAULT 'PENDING',
    `reward_status` ENUM('NONE', 'PENDING', 'PAID') NOT NULL DEFAULT 'NONE',
    `reward_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `reward_user_coupon_id` BIGINT NULL,
    `handler_id` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `handle_note` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reports_report_no_key`(`report_no`),
    INDEX `reports_status_created_at_idx`(`status`, `created_at`),
    INDEX `reports_reporter_id_created_at_idx`(`reporter_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `blacklists` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `target_type` ENUM('USER', 'COMPANION', 'DEVICE') NOT NULL,
    `target_id` VARCHAR(64) NOT NULL,
    `device_fingerprint` VARCHAR(128) NULL,
    `reason` VARCHAR(256) NOT NULL,
    `scope` ENUM('ORDER', 'IM', 'LOGIN', 'PLATFORM') NOT NULL,
    `status` ENUM('ACTIVE', 'LIFTED') NOT NULL DEFAULT 'ACTIVE',
    `active_key` VARCHAR(8) NULL,
    `created_by` BIGINT NULL,
    `expires_at` DATETIME(3) NULL,
    `lifted_at` DATETIME(3) NULL,
    `lift_reason` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `blacklists_device_fingerprint_idx`(`device_fingerprint`),
    UNIQUE INDEX `blacklists_target_type_target_id_scope_active_key_key`(`target_type`, `target_id`, `scope`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `admin_id` BIGINT NULL,
    `action` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `target_type` VARCHAR(32) NULL,
    `target_id` VARCHAR(64) NULL,
    `request_id` VARCHAR(64) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(256) NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_admin_id_created_at_idx`(`admin_id`, `created_at`),
    INDEX `audit_logs_module_created_at_idx`(`module`, `created_at`),
    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admins` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(256) NOT NULL,
    `real_name` VARCHAR(64) NOT NULL,
    `phone_cipher` VARCHAR(512) NULL,
    `role_id` BIGINT NOT NULL,
    `totp_secret_cipher` VARCHAR(512) NULL,
    `status` ENUM('ACTIVE', 'FROZEN') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NULL,
    `login_fail_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admins_username_key`(`username`),
    INDEX `admins_role_id_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `role_key` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(256) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `roles_role_key_key`(`role_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `perm_key` VARCHAR(64) NOT NULL,
    `module` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `description` VARCHAR(256) NULL,

    UNIQUE INDEX `permissions_perm_key_key`(`perm_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` BIGINT NOT NULL,
    `permission_id` BIGINT NOT NULL,

    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_configs` (
    `config_key` VARCHAR(64) NOT NULL,
    `config_value` VARCHAR(256) NOT NULL,
    `value_type` VARCHAR(16) NOT NULL,
    `description` VARCHAR(256) NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`config_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `channel` ENUM('SUBSCRIBE_MESSAGE', 'SMS', 'IM_SYSTEM') NOT NULL,
    `template_id` VARCHAR(64) NULL,
    `target_user_id` BIGINT NOT NULL,
    `target_phone_cipher` VARCHAR(512) NULL,
    `title` VARCHAR(128) NULL,
    `content` VARCHAR(1024) NOT NULL,
    `biz_type` VARCHAR(32) NULL,
    `biz_id` VARCHAR(64) NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(256) NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `sent_at` DATETIME(3) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_logs_target_user_id_created_at_idx`(`target_user_id`, `created_at`),
    INDEX `notification_logs_status_created_at_idx`(`status`, `created_at`),
    INDEX `notification_logs_biz_type_biz_id_idx`(`biz_type`, `biz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminder_settings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `reminder_type` ENUM('BIRTHDAY', 'HEALTH', 'NEUTRAL') NOT NULL,
    `channel` ENUM('SUBSCRIBE_MESSAGE', 'SMS', 'IM_SYSTEM') NOT NULL DEFAULT 'SUBSCRIBE_MESSAGE',
    `time_of_day` VARCHAR(5) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `content_template` VARCHAR(512) NULL,
    `last_sent_at` DATETIME(3) NULL,
    `next_send_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reminder_settings_enabled_next_send_at_idx`(`enabled`, `next_send_at`),
    UNIQUE INDEX `reminder_settings_user_id_reminder_type_time_of_day_key`(`user_id`, `reminder_type`, `time_of_day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wifi_devices` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `device_no` VARCHAR(32) NOT NULL,
    `elder_user_id` BIGINT NOT NULL,
    `device_type` ENUM('APP_PROBE', 'GATEWAY') NOT NULL,
    `status` ENUM('PENDING', 'ONLINE', 'OFFLINE', 'UNBOUND', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `active_key` VARCHAR(8) NULL,
    `vendor` VARCHAR(64) NULL,
    `model` VARCHAR(64) NULL,
    `device_mac_hmac` VARCHAR(64) NULL,
    `ssid_hmac` VARCHAR(64) NULL,
    `bssid_hmac` VARCHAR(64) NULL,
    `device_token_hash` VARCHAR(64) NULL,
    `token_issued_at` DATETIME(3) NULL,
    `token_expires_at` DATETIME(3) NULL,
    `collect_enabled` BOOLEAN NOT NULL DEFAULT true,
    `disabled_at` DATETIME(3) NULL,
    `last_heartbeat_at` DATETIME(3) NULL,
    `heartbeat_interval_sec` INTEGER NOT NULL DEFAULT 60,
    `window_minutes` INTEGER NOT NULL DEFAULT 5,
    `bound_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `wifi_devices_device_no_key`(`device_no`),
    INDEX `wifi_devices_elder_user_id_status_idx`(`elder_user_id`, `status`),
    INDEX `wifi_devices_status_last_heartbeat_at_idx`(`status`, `last_heartbeat_at`),
    INDEX `wifi_devices_bssid_hmac_idx`(`bssid_hmac`),
    INDEX `wifi_devices_token_expires_at_idx`(`token_expires_at`),
    UNIQUE INDEX `wifi_devices_elder_user_id_device_type_active_key_key`(`elder_user_id`, `device_type`, `active_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_signals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `elder_user_id` BIGINT NOT NULL,
    `device_id` BIGINT NULL,
    `channel` ENUM('CHANNEL_A_APP', 'CHANNEL_B_GATEWAY') NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `window_end` DATETIME(3) NOT NULL,
    `window_minutes` INTEGER NOT NULL DEFAULT 5,
    `features` JSON NOT NULL,
    `feature_schema_version` INTEGER NOT NULL DEFAULT 1,
    `event_flag` VARCHAR(32) NULL,
    `confidence` INTEGER NOT NULL DEFAULT 0,
    `data_freshness_seconds` INTEGER NOT NULL DEFAULT 0,
    `ssid_hmac` VARCHAR(64) NULL,
    `bssid_hmac` VARCHAR(64) NULL,
    `retained_until` DATETIME(3) NOT NULL,
    `purged_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_signals_elder_user_id_window_start_idx`(`elder_user_id`, `window_start`),
    INDEX `activity_signals_retained_until_idx`(`retained_until`),
    UNIQUE INDEX `activity_signals_device_id_window_start_key`(`device_id`, `window_start`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_daily_summary` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `elder_user_id` BIGINT NOT NULL,
    `summary_date` DATE NOT NULL,
    `status` ENUM('ACTIVE', 'LOW', 'STILL', 'AWAY', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `status_confidence` INTEGER NOT NULL DEFAULT 0,
    `data_freshness_minutes` INTEGER NOT NULL DEFAULT 0,
    `active_slots` JSON NULL,
    `activity_score` INTEGER NOT NULL DEFAULT 0,
    `still_count` INTEGER NOT NULL DEFAULT 0,
    `away_count` INTEGER NOT NULL DEFAULT 0,
    `home_dwell_minutes` INTEGER NOT NULL DEFAULT 0,
    `signal_count` INTEGER NOT NULL DEFAULT 0,
    `device_count` INTEGER NOT NULL DEFAULT 0,
    `channel_mask` INTEGER NOT NULL DEFAULT 0,
    `is_reference_only` BOOLEAN NOT NULL DEFAULT true,
    `computed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `activity_daily_summary_summary_date_status_idx`(`summary_date`, `status`),
    UNIQUE INDEX `activity_daily_summary_elder_user_id_summary_date_key`(`elder_user_id`, `summary_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `health_alerts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `alert_no` VARCHAR(32) NOT NULL,
    `elder_user_id` BIGINT NOT NULL,
    `device_id` BIGINT NULL,
    `summary_id` BIGINT NULL,
    `type` ENUM('STILL_TOO_LONG', 'FALL_SUSPECT', 'DEVICE_OFFLINE', 'NOCTURNAL_ACTIVITY', 'LOW_TREND', 'RESPIRATORY_TREND') NOT NULL,
    `level` ENUM('REMIND', 'WARN', 'URGENT') NOT NULL DEFAULT 'REMIND',
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'PROCESSING', 'RESOLVED', 'DISMISSED', 'ESCALATED') NOT NULL DEFAULT 'OPEN',
    `confidence` INTEGER NOT NULL DEFAULT 0,
    `is_reference_only` BOOLEAN NOT NULL DEFAULT true,
    `source_channel` ENUM('CHANNEL_A_APP', 'CHANNEL_B_GATEWAY') NULL,
    `triggered_by_rule` VARCHAR(64) NOT NULL,
    `triggered_at` DATETIME(3) NOT NULL,
    `suppressed_until` DATETIME(3) NULL,
    `escalated_at` DATETIME(3) NULL,
    `ack_by` BIGINT NULL,
    `ack_by_role` VARCHAR(16) NULL,
    `ack_at` DATETIME(3) NULL,
    `handled_by` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `conclusion` VARCHAR(512) NULL,
    `complaint_id` BIGINT NULL,
    `order_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `health_alerts_alert_no_key`(`alert_no`),
    INDEX `health_alerts_elder_user_id_triggered_at_idx`(`elder_user_id`, `triggered_at`),
    INDEX `health_alerts_status_level_triggered_at_idx`(`status`, `level`, `triggered_at`),
    INDEX `health_alerts_type_suppressed_until_idx`(`type`, `suppressed_until`),
    INDEX `health_alerts_complaint_id_idx`(`complaint_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_consents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `elder_user_id` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'GRANTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `policy_version` VARCHAR(16) NOT NULL,
    `granted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `collect_stopped_at` DATETIME(3) NULL,
    `device_stop_requested_at` DATETIME(3) NULL,
    `unaggregated_purged_at` DATETIME(3) NULL,
    `purge_status` ENUM('NOT_STARTED', 'RUNNING', 'CONFIRMED', 'FAILED') NOT NULL DEFAULT 'NOT_STARTED',
    `purge_error` VARCHAR(256) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `activity_consents_elder_user_id_key`(`elder_user_id`),
    INDEX `activity_consents_status_revoked_at_idx`(`status`, `revoked_at`),
    INDEX `activity_consents_purge_status_idx`(`purge_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_consent_scopes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `consent_id` BIGINT NOT NULL,
    `family_binding_id` BIGINT NOT NULL,
    `viewer_level` ENUM('NONE', 'DAILY_SUMMARY', 'ALERT_ONLY', 'TREND') NOT NULL DEFAULT 'TREND',
    `granted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `activity_consent_scopes_family_binding_id_revoked_at_idx`(`family_binding_id`, `revoked_at`),
    UNIQUE INDEX `activity_consent_scopes_consent_id_family_binding_id_key`(`consent_id`, `family_binding_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_touchpoints` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `elder_user_id` BIGINT NULL,
    `event_type` ENUM('INSTALL', 'ACTIVATION', 'CONSENT_GRANTED', 'DATA_AVAILABLE', 'ALERT_RAISED', 'FIRST_ORDER', 'REORDER') NOT NULL,
    `funnel_stage` VARCHAR(32) NOT NULL,
    `source_channel` ENUM('CHANNEL_A_APP', 'CHANNEL_B_GATEWAY') NULL,
    `touch_channel` ENUM('PUSH', 'SMS', 'IM', 'MEDIA_SCREEN', 'MEDIA_STICKER', 'DISTRIBUTOR', 'OPENING_APP') NULL,
    `alert_id` BIGINT NULL,
    `order_id` BIGINT NULL,
    `converted` BOOLEAN NOT NULL DEFAULT false,
    `converted_at` DATETIME(3) NULL,
    `touchpoint_at` DATETIME(3) NOT NULL,
    `metadata` JSON NULL,
    `incentive_id` BIGINT NULL,
    `incentive_amount_fen` BIGINT NOT NULL DEFAULT 0,
    `cost_account` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_touchpoints_elder_user_id_touchpoint_at_idx`(`elder_user_id`, `touchpoint_at`),
    INDEX `activity_touchpoints_event_type_touchpoint_at_idx`(`event_type`, `touchpoint_at`),
    INDEX `activity_touchpoints_touch_channel_touchpoint_at_idx`(`touch_channel`, `touchpoint_at`),
    INDEX `activity_touchpoints_cost_account_touchpoint_at_idx`(`cost_account`, `touchpoint_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_subscriptions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `subscription_no` VARCHAR(32) NOT NULL,
    `elder_user_id` BIGINT NOT NULL,
    `tier` ENUM('FREE', 'PRO', 'INSTITUTIONAL') NOT NULL DEFAULT 'FREE',
    `status` ENUM('PENDING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED') NOT NULL DEFAULT 'PENDING',
    `price_fen` BIGINT NOT NULL DEFAULT 0,
    `billing_cycle` VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
    `institutional_name` VARCHAR(128) NULL,
    `capabilities` JSON NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `auto_renew` BOOLEAN NOT NULL DEFAULT true,
    `cancelled_at` DATETIME(3) NULL,
    `revenue_account` VARCHAR(32) NOT NULL DEFAULT 'SUBSCRIPTION_REVENUE',
    `external_ref` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `activity_subscriptions_subscription_no_key`(`subscription_no`),
    INDEX `activity_subscriptions_elder_user_id_status_idx`(`elder_user_id`, `status`),
    INDEX `activity_subscriptions_status_end_at_idx`(`status`, `end_at`),
    INDEX `activity_subscriptions_tier_status_idx`(`tier`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `elder_profiles` ADD CONSTRAINT `elder_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_bindings` ADD CONSTRAINT `family_bindings_family_user_id_fkey` FOREIGN KEY (`family_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `family_bindings` ADD CONSTRAINT `family_bindings_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companions` ADD CONSTRAINT `companions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_applications` ADD CONSTRAINT `companion_applications_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_certifications` ADD CONSTRAINT `companion_certifications_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `companion_schedules` ADD CONSTRAINT `companion_schedules_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `credit_logs` ADD CONSTRAINT `credit_logs_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `credit_logs` ADD CONSTRAINT `credit_logs_related_order_id_fkey` FOREIGN KEY (`related_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deposit_transactions` ADD CONSTRAINT `deposit_transactions_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `penalty_records` ADD CONSTRAINT `penalty_records_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `penalty_records` ADD CONSTRAINT `penalty_records_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `penalty_records` ADD CONSTRAINT `penalty_records_risk_event_id_fkey` FOREIGN KEY (`risk_event_id`) REFERENCES `risk_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `penalty_records` ADD CONSTRAINT `penalty_records_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_timeline` ADD CONSTRAINT `order_timeline_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profit_sharing_records` ADD CONSTRAINT `profit_sharing_records_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `profit_sharing_records` ADD CONSTRAINT `profit_sharing_records_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verifications` ADD CONSTRAINT `verifications_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verifications` ADD CONSTRAINT `verifications_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verifications` ADD CONSTRAINT `verifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_files` ADD CONSTRAINT `evidence_files_file_meta_id_fkey` FOREIGN KEY (`file_meta_id`) REFERENCES `file_meta`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_files` ADD CONSTRAINT `evidence_files_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `evidence_files` ADD CONSTRAINT `evidence_files_verification_id_fkey` FOREIGN KEY (`verification_id`) REFERENCES `verifications`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revisit_tasks` ADD CONSTRAINT `revisit_tasks_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revisit_tasks` ADD CONSTRAINT `revisit_tasks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `revisit_tasks` ADD CONSTRAINT `revisit_tasks_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_conversations` ADD CONSTRAINT `im_conversations_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_conversations` ADD CONSTRAINT `im_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_conversations` ADD CONSTRAINT `im_conversations_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_messages` ADD CONSTRAINT `im_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `im_conversations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_messages` ADD CONSTRAINT `im_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `im_messages` ADD CONSTRAINT `im_messages_file_meta_id_fkey` FOREIGN KEY (`file_meta_id`) REFERENCES `file_meta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `privacy_bindings` ADD CONSTRAINT `privacy_bindings_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `privacy_bindings` ADD CONSTRAINT `privacy_bindings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `privacy_bindings` ADD CONSTRAINT `privacy_bindings_companion_id_fkey` FOREIGN KEY (`companion_id`) REFERENCES `companions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_sessions` ADD CONSTRAINT `ai_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_messages` ADD CONSTRAINT `ai_messages_session_id_fkey` FOREIGN KEY (`session_id`) REFERENCES `ai_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_profiles` ADD CONSTRAINT `ai_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewee_id_fkey` FOREIGN KEY (`reviewee_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_complainant_id_fkey` FOREIGN KEY (`complainant_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_buyer_user_id_fkey` FOREIGN KEY (`buyer_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_recipient_user_id_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `gift_cards` ADD CONSTRAINT `gift_cards_bound_user_id_fkey` FOREIGN KEY (`bound_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_coupon_id_fkey` FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_coupons` ADD CONSTRAINT `user_coupons_used_order_id_fkey` FOREIGN KEY (`used_order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `distributors` ADD CONSTRAINT `distributors_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_distributor_id_fkey` FOREIGN KEY (`distributor_id`) REFERENCES `distributors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commissions` ADD CONSTRAINT `commissions_related_user_id_fkey` FOREIGN KEY (`related_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance_policies` ADD CONSTRAINT `insurance_policies_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance_policies` ADD CONSTRAINT `insurance_policies_insured_user_id_fkey` FOREIGN KEY (`insured_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `insurance_policies` ADD CONSTRAINT `insurance_policies_insured_companion_id_fkey` FOREIGN KEY (`insured_companion_id`) REFERENCES `companions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_events` ADD CONSTRAINT `risk_events_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `risk_events` ADD CONSTRAINT `risk_events_im_message_id_fkey` FOREIGN KEY (`im_message_id`) REFERENCES `im_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admins`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admins` ADD CONSTRAINT `admins_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_logs` ADD CONSTRAINT `notification_logs_target_user_id_fkey` FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminder_settings` ADD CONSTRAINT `reminder_settings_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wifi_devices` ADD CONSTRAINT `wifi_devices_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_signals` ADD CONSTRAINT `activity_signals_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_signals` ADD CONSTRAINT `activity_signals_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `wifi_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_daily_summary` ADD CONSTRAINT `activity_daily_summary_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_alerts` ADD CONSTRAINT `health_alerts_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_alerts` ADD CONSTRAINT `health_alerts_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `wifi_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_alerts` ADD CONSTRAINT `health_alerts_summary_id_fkey` FOREIGN KEY (`summary_id`) REFERENCES `activity_daily_summary`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_alerts` ADD CONSTRAINT `health_alerts_complaint_id_fkey` FOREIGN KEY (`complaint_id`) REFERENCES `complaints`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `health_alerts` ADD CONSTRAINT `health_alerts_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_consents` ADD CONSTRAINT `activity_consents_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_consent_scopes` ADD CONSTRAINT `activity_consent_scopes_consent_id_fkey` FOREIGN KEY (`consent_id`) REFERENCES `activity_consents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_consent_scopes` ADD CONSTRAINT `activity_consent_scopes_family_binding_id_fkey` FOREIGN KEY (`family_binding_id`) REFERENCES `family_bindings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_touchpoints` ADD CONSTRAINT `activity_touchpoints_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_touchpoints` ADD CONSTRAINT `activity_touchpoints_alert_id_fkey` FOREIGN KEY (`alert_id`) REFERENCES `health_alerts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_touchpoints` ADD CONSTRAINT `activity_touchpoints_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_touchpoints` ADD CONSTRAINT `activity_touchpoints_incentive_id_fkey` FOREIGN KEY (`incentive_id`) REFERENCES `user_coupons`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_subscriptions` ADD CONSTRAINT `activity_subscriptions_elder_user_id_fkey` FOREIGN KEY (`elder_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

