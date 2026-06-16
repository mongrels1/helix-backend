CREATE TYPE "InstructorContentType" AS ENUM ('INSIGHT','WARM_UP','RUBRIC_DRAFT','FEEDBACK_DRAFT');

CREATE TABLE IF NOT EXISTS "InstructorContent" (
"id"           TEXT                    NOT NULL,
"teacherId"    TEXT,
"classroomId"  TEXT,
"assignmentId" TEXT,
"type"         "InstructorContentType" NOT NULL,
"content"      TEXT                    NOT NULL,
"metadata"     JSONB,
"dismissed"    BOOLEAN                 NOT NULL DEFAULT false,
"dismissedAt"  TIMESTAMP(3),
"createdAt"    TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "InstructorContent_pkey" PRIMARY KEY ("id"),
CONSTRAINT "InstructorContent_teacherId_fkey"
FOREIGN KEY ("teacherId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE
);
