-- Live whiteboard (19 Nov 2026): additive and idempotent.
-- groupWrite: whether students may write on the shared board while the tutor shows it ("Let students write").
-- invitedStudentIds: students sent an invite, so their screens can show a "Join now" banner.
ALTER TABLE "WhiteboardSession" ADD COLUMN IF NOT EXISTS "groupWrite" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WhiteboardSession" ADD COLUMN IF NOT EXISTS "invitedStudentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
