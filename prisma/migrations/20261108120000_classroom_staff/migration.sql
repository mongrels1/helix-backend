-- Share a class with other teachers (district staff email only).

DO $$ BEGIN
  CREATE TYPE "ClassroomStaffRole" AS ENUM ('CO_TEACHER', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClassroomStaff" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClassroomStaffRole" NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassroomStaff_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClassroomStaff_classroomId_userId_key" ON "ClassroomStaff"("classroomId", "userId");
CREATE INDEX IF NOT EXISTS "ClassroomStaff_userId_idx" ON "ClassroomStaff"("userId");
DO $$ BEGIN
  ALTER TABLE "ClassroomStaff" ADD CONSTRAINT "ClassroomStaff_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClassroomStaff" ADD CONSTRAINT "ClassroomStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClassroomInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "grants" JSONB NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassroomInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClassroomInvite_tokenHash_key" ON "ClassroomInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "ClassroomInvite_organizationId_email_idx" ON "ClassroomInvite"("organizationId", "email");
