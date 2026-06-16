CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'UPLOADED', 'DELETED');

CREATE TABLE "FileRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "r2Key" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileRecord_r2Key_key" ON "FileRecord"("r2Key");

ALTER TABLE "FileRecord" ADD CONSTRAINT "FileRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
