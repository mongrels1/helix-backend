import { SubmissionStatus } from '@prisma/client';

export class SubmissionEntity {
  id!: string;
  assignmentId!: string;
  studentId!: string;
  status!: SubmissionStatus;
  content!: string | null;
  fileUrl!: string | null;
  submittedAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
