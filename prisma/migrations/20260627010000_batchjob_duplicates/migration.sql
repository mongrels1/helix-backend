-- Track how many generated items were skipped as exact duplicates. Additive only.
ALTER TABLE "BatchJob" ADD COLUMN IF NOT EXISTS "duplicates" INTEGER NOT NULL DEFAULT 0;
