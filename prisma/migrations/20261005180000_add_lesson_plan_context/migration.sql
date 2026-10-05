-- A teacher's saved Lesson Plan Maker context sheet. Purely additive and
-- idempotent: one new table, no foreign key, no existing table altered and no
-- existing row touched, so it is safe to apply with the old code still running.
--
-- One row per teacher. `data` holds the fields that do not change week to week
-- (period length, grade, team, school, co-teaching, groups, strategies and the
-- standing instructions), so next week the teacher edits the pacing lines and
-- nothing else.

CREATE TABLE IF NOT EXISTS "LessonPlanContext" (
    "userId"    TEXT NOT NULL,
    "data"      JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanContext_pkey" PRIMARY KEY ("userId")
);
