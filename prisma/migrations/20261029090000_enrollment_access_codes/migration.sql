-- Per-student single-use enrollment access codes (Redan flyers, 29 Oct 2026).
-- Additive and idempotent: one new column with a false default (so every
-- existing school behaves exactly as before) and one new table.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "requireAccessCode" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "EnrollmentAccessCode" (
    "id"                 TEXT NOT NULL,
    "organizationId"     TEXT NOT NULL,
    "codeHash"           TEXT NOT NULL,
    "freeMonths"         INTEGER NOT NULL DEFAULT 10,
    "redeemedAt"         TIMESTAMP(3),
    "redeemedByParentId" TEXT,
    "redeemedStudentId"  TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentAccessCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EnrollmentAccessCode_codeHash_key" ON "EnrollmentAccessCode"("codeHash");
CREATE INDEX IF NOT EXISTS "EnrollmentAccessCode_organizationId_redeemedAt_idx" ON "EnrollmentAccessCode"("organizationId", "redeemedAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EnrollmentAccessCode_organizationId_fkey') THEN
        ALTER TABLE "EnrollmentAccessCode"
            ADD CONSTRAINT "EnrollmentAccessCode_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
