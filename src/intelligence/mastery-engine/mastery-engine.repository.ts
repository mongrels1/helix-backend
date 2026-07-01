import { Injectable } from '@nestjs/common';
import { MasteryHistory, MasteryScore, MasteryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ApplyUpdateInput {
  studentId: string;
  skillTag: string;
  /** Displayed proficiency (mirrors pMastered for back-compat). */
  score: number;
  pMastered: number;
  correct: boolean;
  rigor?: number;
  variantKey?: string;
  pAfter: number;
  submissionId?: string;
  status: MasteryStatus;
  masteredAt: Date | null;
  nextRecheckAt: Date | null;
}

@Injectable()
export class MasteryEngineRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one BKT update: upsert the mastery record (posterior + gate status +
   * retention schedule) and append an attempt-level history row carrying the
   * evidence (correct/rigor/variantKey) the gate needs.
   */
  async applyUpdate(input: ApplyUpdateInput): Promise<MasteryScore> {
    return this.prisma.$transaction(async (tx) => {
      const masteryScore = await tx.masteryScore.upsert({
        where: {
          studentId_skillTag: {
            studentId: input.studentId,
            skillTag: input.skillTag,
          },
        },
        update: {
          score: input.score,
          pMastered: input.pMastered,
          status: input.status,
          masteredAt: input.masteredAt,
          nextRecheckAt: input.nextRecheckAt,
        },
        create: {
          studentId: input.studentId,
          skillTag: input.skillTag,
          score: input.score,
          pMastered: input.pMastered,
          status: input.status,
          masteredAt: input.masteredAt,
          nextRecheckAt: input.nextRecheckAt,
        },
      });

      await tx.masteryHistory.create({
        data: {
          masteryScoreId: masteryScore.id,
          score: input.score,
          correct: input.correct,
          rigor: input.rigor ?? null,
          variantKey: input.variantKey ?? null,
          pAfter: input.pAfter,
          submissionId: input.submissionId,
        },
      });

      return masteryScore;
    });
  }

  /** Persist a spaced-retention decay (reopen a previously mastered skill). */
  async applyDecay(
    id: string,
    pMastered: number,
    status: MasteryStatus,
    nextRecheckAt: Date | null,
  ): Promise<MasteryScore> {
    return this.prisma.masteryScore.update({
      where: { id },
      data: { pMastered, score: pMastered, status, masteredAt: null, nextRecheckAt },
    });
  }

  /** Correct attempts for a skill — used to count breadth + rigor coverage. */
  async getCorrectHistory(
    studentId: string,
    skillTag: string,
  ): Promise<MasteryHistory[]> {
    return this.prisma.masteryHistory.findMany({
      where: { masteryScore: { studentId, skillTag }, correct: true },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getRecentHistory(
    studentId: string,
    skillTag: string,
    limit: number,
  ): Promise<MasteryHistory[]> {
    return this.prisma.masteryHistory.findMany({
      where: { masteryScore: { studentId, skillTag } },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
  }

  async getAllScoresForStudent(studentId: string): Promise<MasteryScore[]> {
    return this.prisma.masteryScore.findMany({
      where: { studentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getScoreForSkill(
    studentId: string,
    skillTag: string,
  ): Promise<MasteryScore | null> {
    return this.prisma.masteryScore.findUnique({
      where: { studentId_skillTag: { studentId, skillTag } },
    });
  }

  async getClassroomMastery(classroomId: string): Promise<MasteryScore[]> {
    return this.prisma.masteryScore.findMany({
      where: {
        student: {
          enrollments: {
            some: { classroomId },
          },
        },
      },
      orderBy: [{ studentId: 'asc' }, { skillTag: 'asc' }],
    });
  }
}
