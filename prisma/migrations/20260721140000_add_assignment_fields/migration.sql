-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "linkUrl" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "standard" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "tasks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
