-- Item generation: GenStatus enum + DraftItem + BatchJob tables.
-- Additive only — creates one enum and two new tables, no changes to existing tables/data.

DO $$ BEGIN
  CREATE TYPE "GenStatus" AS ENUM ('draft', 'validated', 'field_test', 'operational', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "DraftItem" (
  "id"                    TEXT         NOT NULL,
  "batchId"               TEXT         NOT NULL,
  "baseSourceId"          TEXT,
  "status"                "GenStatus"  NOT NULL DEFAULT 'draft',
  "versionType"           TEXT         NOT NULL,
  "stem"                  TEXT         NOT NULL,
  "figure"                JSONB,
  "options"               JSONB        NOT NULL,
  "answer"                TEXT         NOT NULL,
  "solution"              TEXT         NOT NULL,
  "standard"              TEXT         NOT NULL,
  "ga"                    TEXT,
  "gaCluster"             TEXT,
  "skillTags"             TEXT[],
  "skillNode"             TEXT,
  "misconceptionTags"     TEXT[],
  "dok"                   INTEGER      NOT NULL,
  "difficulty"            TEXT         NOT NULL,
  "microDiagnosticSignal" TEXT         NOT NULL,
  "provenance"            TEXT         NOT NULL DEFAULT 'AIG',
  "validation"            JSONB,
  "calibration"           JSONB,
  "createdBy"             TEXT         NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DraftItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DraftItem_batchId_idx" ON "DraftItem"("batchId");
CREATE INDEX IF NOT EXISTS "DraftItem_status_idx" ON "DraftItem"("status");
CREATE INDEX IF NOT EXISTS "DraftItem_gaCluster_idx" ON "DraftItem"("gaCluster");

CREATE TABLE IF NOT EXISTS "BatchJob" (
  "id"        TEXT         NOT NULL,
  "batchId"   TEXT         NOT NULL,
  "status"    TEXT         NOT NULL DEFAULT 'running',
  "total"     INTEGER      NOT NULL,
  "done"      INTEGER      NOT NULL DEFAULT 0,
  "passed"    INTEGER      NOT NULL DEFAULT 0,
  "failed"    INTEGER      NOT NULL DEFAULT 0,
  "error"     TEXT,
  "createdBy" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BatchJob_batchId_key" ON "BatchJob"("batchId");
