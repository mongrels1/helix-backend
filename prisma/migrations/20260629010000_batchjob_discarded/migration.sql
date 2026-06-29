-- Track how many generated items were discarded by the correctness self-check
-- (independently re-solved and found wrong/ambiguous) before saving. Additive.
ALTER TABLE "BatchJob" ADD COLUMN IF NOT EXISTS "discarded" INTEGER NOT NULL DEFAULT 0;
