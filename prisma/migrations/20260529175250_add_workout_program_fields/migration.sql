-- Clear old program and workout history before schema update
DELETE FROM "Set";
DELETE FROM "WorkoutSession";
DELETE FROM "Exercise";
DELETE FROM "WorkoutDay";

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
    "baselineWeightMin" REAL,
    "baselineWeightMax" REAL,
    "baselineNote" TEXT,
    "technique" TEXT,
    CONSTRAINT "Exercise_workoutDayId_fkey" FOREIGN KEY ("workoutDayId") REFERENCES "WorkoutDay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
DROP TABLE "Exercise";
ALTER TABLE "new_Exercise" RENAME TO "Exercise";
CREATE UNIQUE INDEX "Exercise_workoutDayId_orderIndex_key" ON "Exercise"("workoutDayId", "orderIndex");

CREATE TABLE "new_WorkoutDay" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dayNumber" INTEGER NOT NULL,
    "weekday" TEXT NOT NULL,
    "name" TEXT NOT NULL
);
DROP TABLE "WorkoutDay";
ALTER TABLE "new_WorkoutDay" RENAME TO "WorkoutDay";
CREATE UNIQUE INDEX "WorkoutDay_dayNumber_key" ON "WorkoutDay"("dayNumber");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
