-- Practice-driven misconception loop. Records each practice answer; captures the
-- misconception a student showed when they pick a tagged distractor. Additive only.
CREATE TABLE IF NOT EXISTS "PracticeResponse" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "draftItemId" TEXT NOT NULL,
  "standard" TEXT,
  "strand" TEXT,
  "pickedIndex" INTEGER NOT NULL,
  "correct" BOOLEAN NOT NULL,
  "misconceptionTag" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PracticeResponse_userId_idx" ON "PracticeResponse"("userId");
CREATE INDEX IF NOT EXISTS "PracticeResponse_userId_createdAt_idx" ON "PracticeResponse"("userId", "createdAt");
