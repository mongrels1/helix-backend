-- Institutional roster + vetted reporting foundation. All additive & idempotent.
--
-- (1) Org-level gates.
--     rosterEnabled       — a super-admin has approved this school for trial/
--                           contract; teachers may only upload rosters once true.
--     studentEmailInvites — may EdKairos email students a set-password link
--                           (default false = the teacher hands out a printed
--                           credential sheet). Parent-facing email is never sent.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "rosterEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "studentEmailInvites" BOOLEAN NOT NULL DEFAULT false;
-- Per-teacher student cap: null = trial default (25/teacher, applied in code);
-- a number = the contracted per-teacher limit. Per-teacher override: User.maxStudents.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "perTeacherCap" INTEGER;

-- (2) School student ID on the Profile — the roster dedup key and the
--     disambiguator when two students share a name. Uniqueness is enforced
--     per-organization in the import service (a Profile has no org column, so a
--     DB-wide UNIQUE would be wrong across schools). Nullable + additive.
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "studentId" TEXT;
CREATE INDEX IF NOT EXISTS "Profile_studentId_idx" ON "Profile" ("studentId");

-- (3) Institutional weekly reports are GENERATED then HELD for teacher review —
--     never auto-emailed to a parent (parent-facing content is vetted by the
--     school). One row per (student, class, period); the UNIQUE key makes report
--     regeneration idempotent. Separate from WeeklyReportRun (family/B2C send log).
CREATE TABLE IF NOT EXISTS "HeldReport" (
  "id"           TEXT         NOT NULL,
  "studentId"    TEXT         NOT NULL,
  "classroomId"  TEXT         NOT NULL,
  "teacherId"    TEXT         NOT NULL,
  "orgId"        TEXT         NOT NULL,
  "periodStart"  TIMESTAMP(3) NOT NULL,
  "periodEnd"    TIMESTAMP(3) NOT NULL,
  "studentName"  TEXT         NOT NULL,
  "minutesTotal" INTEGER      NOT NULL DEFAULT 0,
  "reportHtml"   TEXT         NOT NULL,
  "reportText"   TEXT         NOT NULL,
  "status"       TEXT         NOT NULL DEFAULT 'HELD',
  "releasedAt"   TIMESTAMP(3),
  "releasedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HeldReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HeldReport_studentId_classroomId_periodStart_key" UNIQUE ("studentId", "classroomId", "periodStart")
);
CREATE INDEX IF NOT EXISTS "HeldReport_classroomId_status_idx" ON "HeldReport" ("classroomId", "status");
CREATE INDEX IF NOT EXISTS "HeldReport_teacherId_status_idx" ON "HeldReport" ("teacherId", "status");
