-- CreateTable
CREATE TABLE "KSportsFact" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "masteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KSportsFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KSportsFact_studentId_module_factKey_key" ON "KSportsFact"("studentId", "module", "factKey");

-- CreateIndex
CREATE INDEX "KSportsFact_studentId_idx" ON "KSportsFact"("studentId");
