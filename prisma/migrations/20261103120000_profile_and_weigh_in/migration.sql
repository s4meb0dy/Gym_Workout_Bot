-- AlterTable
ALTER TABLE "User" ADD COLUMN "heightCm" INTEGER;
ALTER TABLE "User" ADD COLUMN "goal" TEXT NOT NULL DEFAULT 'lean_bulk';

-- AlterTable
ALTER TABLE "ReminderSetting" ADD COLUMN "weightEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ReminderSetting" ADD COLUMN "weightHour" INTEGER NOT NULL DEFAULT 8;

-- Зріст раніше був зашитий у промпт порад (~182 см) — переносимо його в профіль.
UPDATE "User" SET "heightCm" = 182 WHERE "heightCm" IS NULL;
