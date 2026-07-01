-- Growth Engine (BKT mastery + three-part gate + spaced retention).
-- Additive and idempotent: safe to re-run; no data loss on existing rows.

-- Mastery status lifecycle for the forced-pathway gate.
DO $$ BEGIN
  CREATE TYPE "MasteryStatus" AS ENUM ('NOT_STARTED', 'EMERGING', 'MASTERED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- MasteryScore: latent posterior + gate status + retention schedule.
ALTER TABLE "MasteryScore"
  ADD COLUMN IF NOT EXISTS "pMastered" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS "status" "MasteryStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS "masteredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nextRecheckAt" TIMESTAMP(3);

-- Backfill posterior from any existing displayed score so live rows are sane.
UPDATE "MasteryScore" SET "pMastered" = "score" WHERE "pMastered" = 0.25 AND "score" IS NOT NULL;

-- MasteryHistory: attempt-level evidence for breadth + rigor gate.
ALTER TABLE "MasteryHistory"
  ADD COLUMN IF NOT EXISTS "correct" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "rigor" INTEGER,
  ADD COLUMN IF NOT EXISTS "variantKey" TEXT,
  ADD COLUMN IF NOT EXISTS "pAfter" DOUBLE PRECISION;
