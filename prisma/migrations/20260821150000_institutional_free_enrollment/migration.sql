-- Free institutional enrollment (the Redan model). All additive & idempotent.
--
-- (1) Org-level gates for the parent-facing enrollment page.
--     publicEnrollmentEnabled — master switch, OFF by default so no school is
--                               reachable until a super-admin turns it on.
--     enrollmentToken         — the unguessable value carried by the printed QR
--                               code. The slug is deliberately NOT the key: this
--                               endpoint hands out free accounts, and a slug is
--                               guessable.
--     enrollmentCap           — bounds the damage if a token ever leaks.
--     enrollmentsUsed         — incremented inside the same transaction that
--                               creates the accounts, so the cap cannot be raced.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "publicEnrollmentEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "enrollmentToken"         TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "enrollmentCap"           INTEGER;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "enrollmentsUsed"         INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_enrollmentToken_key" ON "Organization" ("enrollmentToken");

-- (2) The signed parent opt-in, stored verbatim.
--     A parent ticks three boxes and a hold-harmless on a form a school district
--     may later ask us to produce. consentText holds the EXACT wording rendered
--     on screen, not just a version string — a version alone cannot prove what
--     the parent actually agreed to. ipAddress/userAgent are captured for the
--     same reason.
--     One row per student: the UNIQUE key makes a double-submit idempotent
--     rather than recording consent twice.
--     No foreign keys, matching the HeldReport convention in this codebase —
--     the Prisma model declares scalar ids, not relations.
CREATE TABLE IF NOT EXISTS "EnrollmentConsent" (
  "id"                   TEXT         NOT NULL,
  "organizationId"       TEXT         NOT NULL,
  "parentId"             TEXT         NOT NULL,
  "studentId"            TEXT         NOT NULL,
  "parentName"           TEXT         NOT NULL,
  "parentEmail"          TEXT         NOT NULL,
  "parentPhone"          TEXT,
  "relationship"         TEXT         NOT NULL,
  "studentName"          TEXT         NOT NULL,
  "gradeLevel"           TEXT,
  "classPeriod"          TEXT,
  "studentIdExternal"    TEXT,
  "consentAccess"        BOOLEAN      NOT NULL,
  "consentProviderAndAi" BOOLEAN      NOT NULL,
  "consentDataUse"       BOOLEAN      NOT NULL,
  "consentHoldHarmless"  BOOLEAN      NOT NULL,
  "notifyEmail"          BOOLEAN      NOT NULL DEFAULT false,
  "notifySms"            BOOLEAN      NOT NULL DEFAULT false,
  "consentVersion"       TEXT         NOT NULL,
  "consentText"          TEXT         NOT NULL,
  "ipAddress"            TEXT,
  "userAgent"            TEXT,
  "signedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrollmentConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnrollmentConsent_studentId_key" UNIQUE ("studentId")
);
CREATE INDEX IF NOT EXISTS "EnrollmentConsent_organizationId_signedAt_idx"
  ON "EnrollmentConsent" ("organizationId", "signedAt");
