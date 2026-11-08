-- Class grade (8 Nov 2026). Additive and idempotent. Students without their own
-- grade inherit it; the app fills missing student grades when it is set.
ALTER TABLE "Classroom" ADD COLUMN IF NOT EXISTS "gradeLevel" TEXT;
