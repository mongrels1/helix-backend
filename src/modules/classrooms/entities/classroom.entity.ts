export class ClassroomEntity {
  id!: string;
  name!: string;
  description!: string | null;
  organizationId!: string;
  teacherId!: string;
  gradeLevel?: string | null;
  enrollmentCount!: number;
  /** The caller's access when listed for a teacher: their own class, or shared with them. */
  access?: 'owner' | 'co_teacher' | 'viewer';
  /** Owner's name, only on classes shared with the caller. */
  ownerName?: string | null;
  createdAt!: Date;
}
