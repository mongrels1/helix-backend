-- Class Pass (7 Nov 2026): students sign in with a printed QR badge, or with a
-- class code + their name + a backup code. No emails, no passwords.
-- Additive and idempotent: two nullable/defaulted columns and one new table, so
-- every existing classroom behaves exactly as before until a teacher turns it on.

ALTER TABLE "Classroom" ADD COLUMN IF NOT EXISTS "classPassCode" TEXT;
ALTER TABLE "Classroom" ADD COLUMN IF NOT EXISTS "classPassOn" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "Classroom_classPassCode_key" ON "Classroom"("classPassCode");

CREATE TABLE IF NOT EXISTS "ClassPass" (
    "id"             TEXT NOT NULL,
    "classroomId"    TEXT NOT NULL,
    "studentId"      TEXT NOT NULL,
    "badgeHash"      TEXT NOT NULL,
    "backupHash"     TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil"    TIMESTAMP(3),
    "revokedAt"      TIMESTAMP(3),
    "issuedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"     TIMESTAMP(3),

    CONSTRAINT "ClassPass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassPass_badgeHash_key" ON "ClassPass"("badgeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "ClassPass_classroomId_studentId_key" ON "ClassPass"("classroomId", "studentId");
CREATE INDEX IF NOT EXISTS "ClassPass_studentId_idx" ON "ClassPass"("studentId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ClassPass_classroomId_fkey') THEN
        ALTER TABLE "ClassPass"
            ADD CONSTRAINT "ClassPass_classroomId_fkey"
            FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
