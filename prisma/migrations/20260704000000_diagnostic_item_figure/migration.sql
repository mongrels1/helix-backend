-- Add a nullable figure spec (JSON) to diagnostic items so graphs/tables/dot-plots
-- can be stored & rendered (CRA visuals). Additive, safe.
ALTER TABLE "DiagnosticItem" ADD COLUMN IF NOT EXISTS "figure" JSONB;
