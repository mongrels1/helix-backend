import { Injectable } from '@nestjs/common';
import { InstructorContent, InstructorContentType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InstructorAssistantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    type: InstructorContentType;
    content: string;
    teacherId?: string;
    classroomId?: string;
    assignmentId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<InstructorContent> {
    return this.prisma.instructorContent.create({
      data: {
        type: data.type,
        content: data.content,
        teacherId: data.teacherId,
        classroomId: data.classroomId,
        assignmentId: data.assignmentId,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async findForTeacher(teacherId: string): Promise<InstructorContent[]> {
    return this.prisma.instructorContent.findMany({
      where: { teacherId, dismissed: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findById(id: string): Promise<InstructorContent | null> {
    return this.prisma.instructorContent.findUnique({ where: { id } });
  }

  async dismiss(id: string): Promise<InstructorContent> {
    return this.prisma.instructorContent.update({
      where: { id },
      data: { dismissed: true, dismissedAt: new Date() },
    });
  }
}
