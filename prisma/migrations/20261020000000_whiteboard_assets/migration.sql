-- Live whiteboard: pictures used as questions (photo, screenshot, PDF page).
-- Additive and idempotent: one new table. Rows are removed with their session.

CREATE TABLE IF NOT EXISTS "WhiteboardAsset" (
    "id"         TEXT NOT NULL,
    "sessionId"  TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "mime"       TEXT NOT NULL,
    "data"       BYTEA NOT NULL,
    "size"       INTEGER NOT NULL,
    "width"      INTEGER NOT NULL,
    "height"     INTEGER NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhiteboardAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhiteboardAsset_sessionId_idx" ON "WhiteboardAsset"("sessionId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhiteboardAsset_sessionId_fkey') THEN
        ALTER TABLE "WhiteboardAsset"
            ADD CONSTRAINT "WhiteboardAsset_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "WhiteboardSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
