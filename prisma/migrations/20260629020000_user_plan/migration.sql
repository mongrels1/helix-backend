-- Record which purchased plan/product a user came in on (from the GHL purchase
-- webhook). Nullable + additive; existing users are unaffected.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plan" TEXT;
