-- Diagnostic results persistence: DiagnosticSession + DiagnosticResponse.
-- Additive only — creates two new tables, no changes to existing tables/data.

CREATE TABLE IF NOT EXISTS "DiagnosticSession" (
  "id"          TEXT             NOT NULL,
  "userId"      TEXT,
  "studentName" TEXT,
  "grade"       TEXT,
  "length"      TEXT             NOT NULL,
  "theta"       DOUBLE PRECISION NOT NULL,
  "se"          DOUBLE PRECISION NOT NULL,
  "itemsAsked"  INTEGER          NOT NULL,
  "profile"     JSONB            NOT NULL,
  "claimToken"  TEXT,
  "completedAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiagnosticSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiagnosticSession_claimToken_key" UNIQUE ("claimToken"),
  CONSTRAINT "DiagnosticSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DiagnosticSession_userId_idx" ON "DiagnosticSession"("userId");

CREATE TABLE IF NOT EXISTS "DiagnosticResponse" (
  "id"        TEXT             NOT NULL,
  "sessionId" TEXT             NOT NULL,
  "itemId"    TEXT             NOT NULL,
  "strand"    TEXT             NOT NULL,
  "kc"        TEXT             NOT NULL,
  "b"         DOUBLE PRECISION NOT NULL,
  "picked"    TEXT             NOT NULL,
  "answer"    TEXT             NOT NULL,
  "correct"   BOOLEAN          NOT NULL,
  "tag"       TEXT             NOT NULL,
  "position"  INTEGER          NOT NULL,
  CONSTRAINT "DiagnosticResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiagnosticResponse_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "DiagnosticSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DiagnosticResponse_sessionId_idx" ON "DiagnosticResponse"("sessionId");
