CREATE TYPE "TutorSessionStatus" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "TutorMessageRole"   AS ENUM ('STUDENT', 'TUTOR');

CREATE TABLE IF NOT EXISTS "TutorSession" (
"id"           TEXT                  NOT NULL,
"studentId"    TEXT                  NOT NULL,
"assignmentId" TEXT,
"status"       "TutorSessionStatus"  NOT NULL DEFAULT 'ACTIVE',
"createdAt"    TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
"endedAt"      TIMESTAMP(3),
CONSTRAINT "TutorSession_pkey" PRIMARY KEY ("id"),
CONSTRAINT "TutorSession_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TutorMessage" (
"id"        TEXT               NOT NULL,
"sessionId" TEXT               NOT NULL,
"role"      "TutorMessageRole" NOT NULL,
"content"   TEXT               NOT NULL,
"createdAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id"),
CONSTRAINT "TutorMessage_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "TutorSession"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
);
