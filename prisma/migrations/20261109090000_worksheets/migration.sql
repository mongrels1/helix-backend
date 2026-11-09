-- Build W: upload a worksheet + A–D key, assign it, score it on the server.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "Worksheet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "standard" TEXT,
    "questionCount" INTEGER NOT NULL,
    "key" TEXT[],
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Worksheet_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Worksheet_ownerId_idx" ON "Worksheet"("ownerId");

CREATE TABLE IF NOT EXISTS "WorksheetPage" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorksheetPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorksheetPage_worksheetId_pageNo_key" ON "WorksheetPage"("worksheetId", "pageNo");
DO $$ BEGIN
  ALTER TABLE "WorksheetPage" ADD CONSTRAINT "WorksheetPage_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "worksheetId" TEXT;
CREATE INDEX IF NOT EXISTS "Assignment_worksheetId_idx" ON "Assignment"("worksheetId");
DO $$ BEGIN
  ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AssignmentTarget" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentTarget_assignmentId_studentId_key" ON "AssignmentTarget"("assignmentId", "studentId");
CREATE INDEX IF NOT EXISTS "AssignmentTarget_studentId_idx" ON "AssignmentTarget"("studentId");
DO $$ BEGIN
  ALTER TABLE "AssignmentTarget" ADD CONSTRAINT "AssignmentTarget_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
