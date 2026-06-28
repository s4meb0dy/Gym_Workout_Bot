-- AlterTable
ALTER TABLE "User" ADD COLUMN "healthSyncToken" TEXT;

-- CreateTable
CREATE TABLE "HealthLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sleepMinutes" INTEGER,
    "restingHr" INTEGER,
    "hrv" REAL,
    "steps" INTEGER,
    "activeCalories" INTEGER,
    "standHours" INTEGER,
    "workoutMinutes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'apple_watch',
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HealthLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HealthLog_userId_date_idx" ON "HealthLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HealthLog_userId_date_key" ON "HealthLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_healthSyncToken_key" ON "User"("healthSyncToken");
