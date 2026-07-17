ALTER TABLE "DiagnosticItem" ADD COLUMN "misconceptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
