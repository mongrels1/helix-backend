import { MasteryStatus } from '@prisma/client';

export class MasteryScoreEntity {
  id!: string;
  studentId!: string;
  skillTag!: string;
  /** Displayed proficiency (mirrors the BKT posterior). */
  score!: number;
  /** Canonical latent mastery posterior P(mastered). */
  pMastered!: number;
  /** Gate lifecycle: NOT_STARTED | EMERGING | MASTERED. */
  status!: MasteryStatus;
  updatedAt!: Date;
}
