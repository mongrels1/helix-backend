export class ClassroomEntity {
  id!: string;
  name!: string;
  description!: string | null;
  organizationId!: string;
  teacherId!: string;
  gradeLevel?: string | null;
  enrollmentCount!: number;
  createdAt!: Date;
}
