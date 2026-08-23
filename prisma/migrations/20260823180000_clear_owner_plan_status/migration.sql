-- Clear stale billing state from owner accounts. Additive-safe & idempotent:
-- re-running it changes nothing once the rows are already NULL.
--
-- WHY THIS ROW WAS WRONG
--   StripeService.applyEntitlement() matches a Stripe customer by EMAIL alone.
--   Any subscription that ever carried the owner's address - a test purchase, a
--   personal card, a legacy GHL customer record - wrote its status onto the
--   owner's User row. That is how a SUPER_ADMIN came to read 'past_due' while
--   never having been billed for anything.
--
-- WHY THE CODE FIX CAME FIRST
--   As of commit 9c8525f, applyEntitlement() refuses to write any plan status
--   onto a SUPER_ADMIN, and common/billing/billing.ts exempts staff and owner
--   roles from every billing gate. Without that, this UPDATE would be undone by
--   the next webhook. This statement only cleans up what was written before the
--   door was shut.
--
-- SCOPE: SUPER_ADMIN only.
--   ORG_ADMIN and TEACHER are exempt from billing ENFORCEMENT and DISPLAY, but
--   an institution may still legitimately carry a subscription on such a row.
--   Deleting that would destroy real billing history. Ownership is the only role
--   for which a plan status is meaningless by definition.
--
-- planRenewsAt is cleared alongside planStatus: a renewal date without a plan is
-- a date for a subscription that does not exist.

UPDATE "User"
SET "planStatus" = NULL,
    "planRenewsAt" = NULL
WHERE "role" = 'SUPER_ADMIN'
  AND ("planStatus" IS NOT NULL OR "planRenewsAt" IS NOT NULL);
