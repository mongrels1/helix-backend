-- Seat limit for a family/parent account: how many child STUDENT logins they can
-- add. Set from the purchased plan (e.g. Founding Family = multi, others = 1).
-- Nullable + additive.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxStudents" INTEGER;
