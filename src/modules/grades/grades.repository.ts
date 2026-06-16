import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { GradeEntity } from './entities/grade.entity';

const gradeInclude = {
  history: { orderBy: { createdAt: 'desc' as const } },
  submission: true,
};

type GradeWithSubmission = GradeEntity & {
  submission: { assignmentId: string; studentId: string };
};

@Injectable()
export class GradesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissionsRepository: SubmissionsRepository,
  ) {}

  async findBySubmission(
    submissionId: string,
  ): Promise<GradeWithSubmission | null> {
    return this.prisma.grade.findUnique({
      where: { submissionId },
      include: gradeInclude,
    }) as Promise<GradeWithSubmission | null>;
  }

  async findById(id: string): Promise<GradeWithSubmission | null> {
    return this.prisma.grade.findUnique({
      where: { id },
      include: gradeInclude,
    }) as Promise<GradeWithSubmission | null>;
  }

  async create(
    submissionId: string,
    score: number,
    maxScore: number,
    feedback: string | undefined,
    gradedById: string,
  ): Promise<GradeWithSubmission> {
    const existing = await this.findBySubmission(submissionId);
    if (existing) {
      throw new ConflictException('Grade already exists for this submission');
    }

    return this.prisma.$transaction(async (tx) => {
      const grade = await tx.grade.create({
        data: {
          submissionId,
          score,
          maxScore,
          feedback,
          gradedById,
        },
      });
      await tx.gradeHistory.create({
        data: {
          gradeId: grade.id,
          score,
          maxScore,
          feedback,
          changedById: gradedById,
        },
      });
      await this.submissionsRepository.updateStatus(
        submissionId,
        SubmissionStatus.GRADED,
        tx,
      );
      return tx.grade.findUniqueOrThrow({
        where: { id: grade.id },
        include: gradeInclude,
      });
    }) as Promise<GradeWithSubmission>;
  }

  async update(
    gradeId: string,
    dto: UpdateGradeDto,
    changedById: string,
  ): Promise<GradeWithSubmission> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.grade.findUniqueOrThrow({ where: { id: gradeId } });
      const nextScore = dto.score ?? current.score;
      const nextFeedback =
        dto.feedback === undefined ? current.feedback : dto.feedback;
      await tx.grade.update({
        where: { id: gradeId },
        data: {
          score: dto.score,
          feedback: dto.feedback,
        },
      });
      await tx.gradeHistory.create({
        data: {
          gradeId,
          score: nextScore,
          maxScore: current.maxScore,
          feedback: nextFeedback,
          changedById,
        },
      });
      return tx.grade.findUniqueOrThrow({
        where: { id: gradeId },
        include: gradeInclude,
      });
    }) as Promise<GradeWithSubmission>;
  }
}
