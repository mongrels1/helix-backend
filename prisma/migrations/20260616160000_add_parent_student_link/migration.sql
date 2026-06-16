CREATE TABLE IF NOT EXISTS "ParentStudentLink" (
  "id"        TEXT         NOT NULL,
  "parentId"  TEXT         NOT NULL,
  "studentId" TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentStudentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentStudentLink_parentId_studentId_key" UNIQUE ("parentId","studentId"),
  CONSTRAINT "ParentStudentLink_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ParentStudentLink_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
