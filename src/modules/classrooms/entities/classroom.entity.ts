export class ClassroomEntity {
  id!: string;
  name!: string;
  description!: string | null;
  organizationId!: string;
  teacherId!: string;
  enrollmentCount!: number;
  createdAt!: Date;
}
