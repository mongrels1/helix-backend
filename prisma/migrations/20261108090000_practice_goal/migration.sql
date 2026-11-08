-- Weekly practice goal per class (8 Nov 2026). Additive and idempotent; null = default (180 min).
ALTER TABLE "Classroom" ADD COLUMN IF NOT EXISTS "practiceGoalMinutes" INTEGER;
