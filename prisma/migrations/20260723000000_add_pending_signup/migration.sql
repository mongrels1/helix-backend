-- Verify-before-create: a signup that has NOT yet confirmed its email. No User/Profile
-- row exists until the emailed token is verified, which is how bots that never open the
-- inbox are stopped from ever becoming accounts. Standalone table (no FK to User).
-- The "Role" enum already exists (used by User); we only reference it here.
CREATE TABLE IF NOT EXISTS "PendingSignup" (
  "id"           TEXT         NOT NULL,
  "email"        TEXT         NOT NULL,
  "passwordHash" TEXT         NOT NULL,
  "firstName"    TEXT         NOT NULL,
  "lastName"     TEXT         NOT NULL,
  "role"         "Role"       NOT NULL DEFAULT 'STUDENT',
  "token"        TEXT         NOT NULL,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingSignup_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "PendingSignup_email_key" UNIQUE ("email"),
  CONSTRAINT "PendingSignup_token_key" UNIQUE ("token")
);
