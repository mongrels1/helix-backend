-- The Kairos Point review gate. Purely additive and idempotent: one new table,
-- two indexes, two foreign keys. No existing table is altered and no existing
-- row is touched, so this is safe to apply to the live database with the old
-- application code still running.
--
-- Why the table exists at all: a generated report makes specific, actionable
-- claims about a named child, built from numbers a model read off a scanned
-- document. Before this, reports lived in memory for six hours and then ceased
-- to exist, which made two things impossible — holding one for administrative
-- review before a family sees it, and diffing the next report against it to
-- show that a child actually moved.
--
-- `status` is TEXT rather than an enum on purpose. The state machine will grow
-- (a queued state, a superseded state), and on Postgres adding an enum value is
-- a migration against a live table; adding a string is not.

CREATE TABLE IF NOT EXISTS "KairosPointReport" (
    "id"             TEXT NOT NULL,
    "studentId"      TEXT NOT NULL,
    -- Staff today; the linked parent once self-serve upload ships.
    "createdById"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'PENDING_REVIEW',

    -- What the human confirmed on the builder's confirm screen, kept beside the
    -- composed map so a report can be rebuilt, and so a later change to the
    -- composition can be replayed against the original numbers rather than
    -- re-read from a document we deliberately do not store.
    "extraction"     JSONB NOT NULL,
    -- The composed map exactly as it was shown and sent.
    "map"            JSONB NOT NULL,

    -- Resolved at generation time. A later tier change must not silently
    -- rewrite what a family was already told.
    "productId"      TEXT NOT NULL,
    "reach"          INTEGER NOT NULL,

    -- Denormalised so the review queue lists without joining three tables.
    "studentName"    TEXT NOT NULL,
    "assessmentName" TEXT NOT NULL,
    "takenOn"        TEXT,
    "overall"        INTEGER NOT NULL,

    "reviewedById"   TEXT,
    "reviewedAt"     TIMESTAMP(3),
    -- Why it was rejected. Kept because a pattern of misreads across several
    -- rejections is the only signal that tells us whether to fix the prompt,
    -- the render resolution, or the confirm screen.
    "reviewNote"     TEXT,

    "sentAt"         TIMESTAMP(3),
    -- Captured at send time: the parent's address can change afterwards, and
    -- "who did we tell" has to stay answerable.
    "sentToEmail"    TEXT,

    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KairosPointReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "KairosPointReport_status_createdAt_idx"
    ON "KairosPointReport" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "KairosPointReport_studentId_createdAt_idx"
    ON "KairosPointReport" ("studentId", "createdAt");

-- Deleting a scholar takes their reports with them; deleting the staff member
-- who built one must NOT, which is why these two differ.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KairosPointReport_studentId_fkey'
  ) THEN
    ALTER TABLE "KairosPointReport"
      ADD CONSTRAINT "KairosPointReport_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KairosPointReport_createdById_fkey'
  ) THEN
    ALTER TABLE "KairosPointReport"
      ADD CONSTRAINT "KairosPointReport_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;
