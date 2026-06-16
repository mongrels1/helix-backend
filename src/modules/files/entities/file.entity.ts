import { FileStatus } from '@prisma/client';

export class FileEntity {
  id!: string;
  ownerId!: string;
  filename!: string;
  mimeType!: string;
  sizeBytes!: number | null;
  status!: FileStatus;
  uploadUrl?: string;
  downloadUrl?: string;
  createdAt!: Date;
}
