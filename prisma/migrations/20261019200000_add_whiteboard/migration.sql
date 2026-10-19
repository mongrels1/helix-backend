-- Live tutoring whiteboard. Purely additive and idempotent: two new tables and
-- their indexes. No existing table is altered and no existing row is touched,
-- so it is safe to apply with the old code still running.

CREATE TABLE IF NOT EXISTS "WhiteboardSession" (
    "id"               TEXT NOT NULL,
    "classroomId"      TEXT NOT NULL,
    "tutorId"          TEXT NOT NULL,
    "title"            TEXT NOT NULL DEFAULT 'Live session',
    "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
    "mode"             TEXT NOT NULL DEFAULT 'MONITOR',
    "focusStudentId"   TEXT,
    "presentedBoardId" TEXT,
    "lockedStudentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt"          TIMESTAMP(3),
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhiteboardSession_classroomId_status_idx"
    ON "WhiteboardSession"("classroomId", "status");
CREATE INDEX IF NOT EXISTS "WhiteboardSession_tutorId_idx"
    ON "WhiteboardSession"("tutorId");

CREATE TABLE IF NOT EXISTS "WhiteboardBoard" (
    "id"        TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "ownerId"   TEXT,
    "question"  JSONB,
    "pages"     JSONB NOT NULL,
    "version"   INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardBoard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhiteboardBoard_sessionId_idx"
    ON "WhiteboardBoard"("sessionId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'WhiteboardBoard_sessionId_fkey'
    ) THEN
        ALTER TABLE "WhiteboardBoard"
            ADD CONSTRAINT "WhiteboardBoard_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "WhiteboardSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- At most one ACTIVE session per classroom, even if two "Start" clicks race.
-- (A partial index: Prisma's schema cannot express it, so it lives only here.)
CREATE UNIQUE INDEX IF NOT EXISTS "WhiteboardSession_one_active_per_classroom"
    ON "WhiteboardSession"("classroomId") WHERE "status" = 'ACTIVE';
