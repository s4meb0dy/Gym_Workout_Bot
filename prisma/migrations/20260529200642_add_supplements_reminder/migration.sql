-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ReminderSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "workoutEnabled" BOOLEAN NOT NULL DEFAULT true,
    "proteinEnabled" BOOLEAN NOT NULL DEFAULT true,
    "workoutHour" INTEGER NOT NULL DEFAULT 10,
    "proteinHour" INTEGER NOT NULL DEFAULT 20,
    "proteinTarget" INTEGER NOT NULL DEFAULT 160,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supplementsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "supplementsHour" INTEGER NOT NULL DEFAULT 21,
    CONSTRAINT "ReminderSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ReminderSetting" ("backupEnabled", "chatId", "digestEnabled", "id", "proteinEnabled", "proteinHour", "proteinTarget", "userId", "workoutEnabled", "workoutHour") SELECT "backupEnabled", "chatId", "digestEnabled", "id", "proteinEnabled", "proteinHour", "proteinTarget", "userId", "workoutEnabled", "workoutHour" FROM "ReminderSetting";
DROP TABLE "ReminderSetting";
ALTER TABLE "new_ReminderSetting" RENAME TO "ReminderSetting";
CREATE UNIQUE INDEX "ReminderSetting_userId_key" ON "ReminderSetting"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
