-- Diagnostic staging bank. A DB-managed copy of the calibrated diagnostic items
-- so Super Admins can grow/review/curate the scored bank toward viability. The
-- live diagnostic keeps serving from code until items here are published. Additive.
CREATE TABLE IF NOT EXISTS "DiagnosticItem" (
  "id" TEXT NOT NULL,
  "grade" INTEGER NOT NULL,
  "strand" TEXT NOT NULL,
  "kc" TEXT NOT NULL,
  "standard" TEXT,
  "dok" INTEGER,
  "b" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "stem" TEXT NOT NULL,
  "options" TEXT[],
  "correct" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiagnosticItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DiagnosticItem_grade_idx" ON "DiagnosticItem"("grade");
CREATE INDEX IF NOT EXISTS "DiagnosticItem_status_idx" ON "DiagnosticItem"("status");
