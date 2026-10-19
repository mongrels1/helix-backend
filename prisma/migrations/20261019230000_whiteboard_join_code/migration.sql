-- Live whiteboard: quick sessions without a classroom, joined with a short code.
-- Additive and idempotent: one nullable column, one relaxed NOT NULL, two partial
-- unique indexes. No existing row changes meaning: classroom sessions keep their
-- classroomId, and existing sessions simply have no code.

ALTER TABLE "WhiteboardSession" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;
ALTER TABLE "WhiteboardSession" ALTER COLUMN "classroomId" DROP NOT NULL;

-- A code identifies exactly one live session.
CREATE UNIQUE INDEX IF NOT EXISTS "WhiteboardSession_active_join_code"
    ON "WhiteboardSession"("joinCode") WHERE "status" = 'ACTIVE' AND "joinCode" IS NOT NULL;

-- One running quick session per tutor (starting again resumes it).
CREATE UNIQUE INDEX IF NOT EXISTS "WhiteboardSession_one_active_quick_per_tutor"
    ON "WhiteboardSession"("tutorId") WHERE "status" = 'ACTIVE' AND "classroomId" IS NULL;
