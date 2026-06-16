import { Injectable } from '@nestjs/common';
import { PacingRecommendation, PacingTrigger, PacingType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PacingEngineRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRecommendation(data: {
    studentId: string;
    classroomId: string;
    trigger: PacingTrigger;
    type: PacingType;
    rationale: string;
    action: string;
  }): Promise<PacingRecommendation> {
    return this.prisma.pacingRecommendation.create({ data });
  }

  async getActiveForStudent(
    studentId: string,
  ): Promise<PacingRecommendation[]> {
    return this.prisma.pacingRecommendation.findMany({
      where: { studentId, dismissed: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveForClassroom(
    classroomId: string,
  ): Promise<PacingRecommendation[]> {
    return this.prisma.pacingRecommendation.findMany({
      where: { classroomId, dismissed: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async dismiss(id: string): Promise<PacingRecommendation> {
    return this.prisma.pacingRecommendation.update({
      where: { id },
      data: { dismissed: true, dismissedAt: new Date() },
    });
  }

  async findById(id: string): Promise<PacingRecommendation | null> {
    return this.prisma.pacingRecommendation.findUnique({ where: { id } });
  }
}
