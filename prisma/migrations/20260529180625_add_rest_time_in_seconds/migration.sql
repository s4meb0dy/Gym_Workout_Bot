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
INSERT INTO "new_Exercise" ("baselineNote", "baselineWeightMax", "baselineWeightMin", "block", "bodyPart", "exerciseType", "id", "name", "orderIndex", "progressionMode", "progressionStep", "targetRepsMax", "targetRepsMin", "targetSets", "technique", "workoutDayId") SELECT "baselineNote", "baselineWeightMax", "baselineWeightMin", "block", "bodyPart", "exerciseType", "id", "name", "orderIndex", "progressionMode", "progressionStep", "targetRepsMax", "targetRepsMin", "targetSets", "technique", "workoutDayId" FROM "Exercise";
DROP TABLE "Exercise";
ALTER TABLE "new_Exercise" RENAME TO "Exercise";
CREATE UNIQUE INDEX "Exercise_workoutDayId_orderIndex_key" ON "Exercise"("workoutDayId", "orderIndex");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
