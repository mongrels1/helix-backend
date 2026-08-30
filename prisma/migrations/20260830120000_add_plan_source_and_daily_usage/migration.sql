-- Plan provenance + daily usage metering. All additive & idempotent.
--
-- (1) PlanSource — where an account's plan came from.
--     The Stripe webhook matches customers by email, so any subscription
--     carrying an address that matches a User row writes its status onto that
--     row. That already cost the owner account (migration 20260823180000) and
--     the same exposure sits on every institutional family: a Redan parent who
--     ever bought anything personally has an email Stripe knows, and one
--     past_due event would silently revoke a free family's access.
--
--     NULL is deliberately permitted and means "unknown / legacy". Stripe may
--     write to NULL and STRIPE rows; it must refuse INSTITUTIONAL and COMP.
--     That keeps every existing row behaving exactly as it does today.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanSource') THEN
    CREATE TYPE "PlanSource" AS ENUM ('STRIPE', 'INSTITUTIONAL', 'COMP');
  END IF;
END$$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planSource"       "PlanSource";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User" ("stripeCustomerId");

-- (2) Backfill the accounts we can identify with certainty.
--     A parent who signed an EnrollmentConsent came in through the free
--     institutional route and has no Stripe object by construction.
UPDATE "User" u
   SET "planSource" = 'INSTITUTIONAL'
 WHERE u."planSource" IS NULL
   AND EXISTS (SELECT 1 FROM "EnrollmentConsent" c WHERE c."parentId" = u."id");

--     Their children are entitled through the parent link, not their own plan,
--     so stamp them too - otherwise a student row stays writable.
UPDATE "User" u
   SET "planSource" = 'INSTITUTIONAL'
 WHERE u."planSource" IS NULL
   AND EXISTS (SELECT 1 FROM "EnrollmentConsent" c WHERE c."studentId" = u."id");

--     Everything else is left NULL on purpose. Guessing STRIPE for a row we
--     cannot evidence would be the same class of error this migration exists to
--     prevent; NULL behaves exactly as today and can be stamped when observed.

-- (3) DailyUsage — the free tier's daily allowance.
--     A daily cap rather than a trial: it renews every midnight, so there is no
--     expiry to manage and each reset is a fresh chance to convert.
CREATE TABLE IF NOT EXISTS "DailyUsage" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "day"       TEXT         NOT NULL,
  "kind"      TEXT         NOT NULL,
  "count"     INTEGER      NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_userId_day_kind_key"
  ON "DailyUsage" ("userId", "day", "kind");
CREATE INDEX IF NOT EXISTS "DailyUsage_userId_day_idx"
  ON "DailyUsage" ("userId", "day");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyUsage_userId_fkey'
  ) THEN
    ALTER TABLE "DailyUsage"
      ADD CONSTRAINT "DailyUsage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;
