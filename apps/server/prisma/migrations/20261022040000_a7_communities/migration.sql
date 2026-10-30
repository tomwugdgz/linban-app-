-- AlterTable
ALTER TABLE `elder_profiles` ADD COLUMN `community_id` BIGINT NULL;

-- AlterTable
ALTER TABLE `verifications` ADD COLUMN `community_id` BIGINT NULL;

-- AlterTable
ALTER TABLE `activity_touchpoints` ADD COLUMN `community_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `communities` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `community_code` VARCHAR(32) NOT NULL,
    `community_name` VARCHAR(128) NOT NULL,
    `city` VARCHAR(32) NULL,
    `address` VARCHAR(256) NULL,
    `lng` DECIMAL(10, 6) NULL,
    `lat` DECIMAL(10, 6) NULL,
    `distributor_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `communities_community_code_key`(`community_code`),
    UNIQUE INDEX `communities_community_name_key`(`community_name`),
    INDEX `communities_distributor_id_idx`(`distributor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `elder_profiles_community_id_idx` ON `elder_profiles`(`community_id`);

-- CreateIndex
CREATE INDEX `verifications_community_id_created_at_idx` ON `verifications`(`community_id`, `created_at`);

-- CreateIndex
CREATE INDEX `activity_touchpoints_community_id_touchpoint_at_idx` ON `activity_touchpoints`(`community_id`, `touchpoint_at`);

-- AddForeignKey
ALTER TABLE `communities` ADD CONSTRAINT `communities_distributor_id_fkey` FOREIGN KEY (`distributor_id`) REFERENCES `distributors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `elder_profiles` ADD CONSTRAINT `elder_profiles_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `verifications` ADD CONSTRAINT `verifications_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `activity_touchpoints` ADD CONSTRAINT `activity_touchpoints_community_id_fkey` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

