export class AssignmentEntity {
  id!: string;
  title!: string;
  description!: string | null;
  dueAt!: Date | null;
  maxScore!: number;
  skillTags!: string[];
  classroomId!: string;
  courseId!: string | null;
  rubric!: {
    id: string;
    title: string;
    criteria: { id: string; title: string; maxScore: number; order: number }[];
  } | null;
  createdAt!: Date;
  updatedAt!: Date;
}
