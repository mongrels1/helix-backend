-- Assignment start date: before this time students do not see the assignment.
-- Additive and idempotent; existing assignments keep NULL (visible as before).
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
