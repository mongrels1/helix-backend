-- CreateTable
CREATE TABLE "WeeklyReportRun" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "studentsCount" INTEGER NOT NULL DEFAULT 0,
    "minutesTotal" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReportRun_createdAt_idx" ON "WeeklyReportRun"("createdAt");
