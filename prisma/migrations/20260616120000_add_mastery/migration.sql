ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "skillTags" TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "MasteryScore" (
"id"        TEXT NOT NULL,
"studentId" TEXT NOT NULL,
"skillTag"  TEXT NOT NULL,
"score"     DOUBLE PRECISION NOT NULL,
"updatedAt" TIMESTAMP(3) NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "MasteryScore_pkey" PRIMARY KEY ("id"),
CONSTRAINT "MasteryScore_studentId_skillTag_key" UNIQUE ("studentId", "skillTag"),
CONSTRAINT "MasteryScore_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "MasteryHistory" (
"id"             TEXT NOT NULL,
"masteryScoreId" TEXT NOT NULL,
"score"          DOUBLE PRECISION NOT NULL,
"submissionId"   TEXT,
"recordedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "MasteryHistory_pkey" PRIMARY KEY ("id"),
CONSTRAINT "MasteryHistory_masteryScoreId_fkey"
FOREIGN KEY ("masteryScoreId") REFERENCES "MasteryScore"("id")
ON DELETE RESTRICT ON UPDATE CASCADE
);
