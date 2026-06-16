import { AttendanceStatus } from '@prisma/client';

export class AttendanceRecordEntity {
  id!: string;
  classroomId!: string;
  studentId!: string;
  date!: Date;
  status!: AttendanceStatus;
  note!: string | null;
  recordedById!: string;
  createdAt!: Date;
}
