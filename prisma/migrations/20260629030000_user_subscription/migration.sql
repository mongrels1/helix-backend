-- Subscription entitlement on the user: status (active|canceled|past_due) and
-- the date access runs through (planRenewsAt). Set from GHL purchase/renewal/
-- cancel webhooks. Nullable + additive; free users have NULLs.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planStatus" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planRenewsAt" TIMESTAMP(3);
