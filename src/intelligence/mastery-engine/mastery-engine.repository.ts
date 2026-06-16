import { Injectable } from '@nestjs/common';
import { MasteryHistory, MasteryScore } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MasteryEngineRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertScore(
    studentId: string,
    skillTag: string,
    score: number,
    submissionId?: string,
  ): Promise<MasteryScore> {
    return this.prisma.$transaction(async (tx) => {
      const masteryScore = await tx.masteryScore.upsert({
        where: { studentId_skillTag: { studentId, skillTag } },
        update: { score },
        create: { studentId, skillTag, score },
      });

      await tx.masteryHistory.create({
        data: {
          masteryScoreId: masteryScore.id,
          score,
          submissionId,
        },
      });

      return masteryScore;
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
