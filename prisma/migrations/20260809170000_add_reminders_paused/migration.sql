-- "Silence reminders" support: skip a student in the reminder engine without
-- losing their plan/number. Additive, defaulted — nothing existing is altered.
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "remindersPaused" BOOLEAN NOT NULL DEFAULT false;
