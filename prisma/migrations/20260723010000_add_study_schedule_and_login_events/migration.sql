-- Study-plan + reminder foundation (Phase 1 of the scheduling/reminder system).
-- Additive only: two nullable Profile columns + two new tables. Nothing existing
-- is altered or dropped.

-- Profile: SMS target + IANA timezone for reminder send-time conversion.
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "phone"    TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "timezone" TEXT;

-- StudySchedule: one row per selected day; the set of rows is the weekly plan.
CREATE TABLE IF NOT EXISTS "StudySchedule" (
  "id"        TEXT         NOT NULL,
  "studentId" TEXT         NOT NULL,
  "dayOfWeek" INTEGER      NOT NULL,
  "studyTime" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudySchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudySchedule_studentId_dayOfWeek_key" UNIQUE ("studentId", "dayOfWeek"),
  CONSTRAINT "StudySchedule_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "StudySchedule_dayOfWeek_idx" ON "StudySchedule" ("dayOfWeek");

-- LoginEvent: raw sign-in signal for engagement analytics (on-time/late/missed).
CREATE TABLE IF NOT EXISTS "LoginEvent" (
  "id"      TEXT         NOT NULL,
  "userId"  TEXT         NOT NULL,
  "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "LoginEvent_userId_loginAt_idx" ON "LoginEvent" ("userId", "loginAt");
