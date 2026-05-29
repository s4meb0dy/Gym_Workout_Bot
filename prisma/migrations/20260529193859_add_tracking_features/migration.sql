-- AlterTable
ALTER TABLE "Set" ADD COLUMN "note" TEXT;
ALTER TABLE "Set" ADD COLUMN "rpe" REAL;

-- CreateTable
CREATE TABLE "BodyWeight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "weightKg" REAL NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyWeight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NutritionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "proteinGrams" REAL NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NutritionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReminderSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "workoutEnabled" BOOLEAN NOT NULL DEFAULT true,
    "proteinEnabled" BOOLEAN NOT NULL DEFAULT true,
    "workoutHour" INTEGER NOT NULL DEFAULT 9,
    "proteinHour" INTEGER NOT NULL DEFAULT 20,
    "proteinTarget" INTEGER NOT NULL DEFAULT 160,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ReminderSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Exercise" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workoutDayId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "targetSets" INTEGER NOT NULL,
    "targetRepsMin" INTEGER NOT NULL,
    "targetRepsMax" INTEGER NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "muscleGroup" TEXT NOT NULL DEFAULT 'Інше',
    "exerciseType" TEXT NOT NULL DEFAULT 'reps',
    "progressionMode" TEXT NOT NULL DEFAULT 'weight',
    "progressionStep" REAL NOT NULL DEFAULT 2,
    "restTimeInSeconds" INTEGER NOT NULL DEFAULT 90,
    "baselineWeightMin" REAL,
    "baselineWeightMax" REAL,
    "baselineNote" TEXT,
    "technique" TEXT,
    CONSTRAINT "Exercise_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Exercise" ("baselineNote", "baselineWeightMax", "baselineWeightMin", "block", "bodyPart", "exerciseType", "id", "name", "orderIndex", "progressionMode", "progressionStep", "restTimeInSeconds", "targetRepsMax", "targetRepsMin", "targetSets", "technique", "workoutDayId") SELECT "baselineNote", "baselineWeightMax", "baselineWeightMin", "block", "bodyPart", "exerciseType", "id", "name", "orderIndex", "progressionMode", "progressionStep", "restTimeInSeconds", "targetRepsMax", "targetRepsMin", "targetSets", "technique", "workoutDayId" FROM "Exercise";
DROP TABLE "Exercise";
ALTER TABLE "new_Exercise" RENAME TO "Exercise";
CREATE UNIQUE INDEX "Exercise_workoutDayId_orderIndex_key" ON "Exercise"("workoutDayId", "orderIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BodyWeight_userId_recordedAt_idx" ON "BodyWeight"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "NutritionLog_userId_date_idx" ON "NutritionLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSetting_userId_key" ON "ReminderSetting"("userId");
