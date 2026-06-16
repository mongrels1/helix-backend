CREATE TYPE "PacingTrigger" AS ENUM ('MASTERY_DROP', 'ENGAGEMENT_DROP');
CREATE TYPE "PacingType"    AS ENUM ('SLOW_DOWN', 'REMEDIATE', 'SKIP_AHEAD', 'STANDARD');

CREATE TABLE IF NOT EXISTS "PacingRecommendation" (
"id"          TEXT             NOT NULL,
"studentId"   TEXT             NOT NULL,
"classroomId" TEXT             NOT NULL,
"trigger"     "PacingTrigger"  NOT NULL,
"type"        "PacingType"     NOT NULL,
"rationale"   TEXT             NOT NULL,
"action"      TEXT             NOT NULL,
"dismissed"   BOOLEAN          NOT NULL DEFAULT false,
"dismissedAt" TIMESTAMP(3),
"createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "PacingRecommendation_pkey" PRIMARY KEY ("id"),
CONSTRAINT "PacingRecommendation_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "PacingRecommendation_classroomId_fkey"
FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
);
