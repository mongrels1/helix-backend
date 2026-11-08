-- Class Pass personal code (8 Nov 2026): one code per student, typed alone at
-- /class, no class code and no name list. Additive and idempotent.
ALTER TABLE "ClassPass" ADD COLUMN IF NOT EXISTS "codeHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ClassPass_codeHash_key" ON "ClassPass"("codeHash");
