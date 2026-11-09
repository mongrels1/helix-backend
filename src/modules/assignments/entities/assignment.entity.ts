export class AssignmentEntity {
  id!: string;
  title!: string;
  description!: string | null;
  linkUrl!: string | null;
  standard!: string | null;
  tasks!: string[];
  dueAt!: Date | null;
  startsAt!: Date | null;
  maxScore!: number;
  skillTags!: string[];
  classroomId!: string;
  courseId!: string | null;
  /** Build W: set when this is an A–D worksheet answered on its own page. */
  worksheetId?: string | null;
  rubric!: {
    id: string;
    title: string;
    criteria: { id: string; title: string; maxScore: number; order: number }[];
  } | null;
  createdAt!: Date;
  updatedAt!: Date;
}
