export class GradeEntity {
  id!: string;
  submissionId!: string;
  score!: number;
  maxScore!: number;
  feedback!: string | null;
  gradedById!: string;
  history!: {
    id: string;
    score: number;
    maxScore: number;
    feedback: string | null;
    changedById: string;
    createdAt: Date;
  }[];
  createdAt!: Date;
  updatedAt!: Date;
}
