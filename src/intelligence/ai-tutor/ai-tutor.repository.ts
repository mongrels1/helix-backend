import { Injectable } from '@nestjs/common';
import {
  TutorMessage,
  TutorMessageRole,
  TutorSession,
  TutorSessionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type TutorSessionWithMessages = TutorSession & {
  messages: TutorMessage[];
};

@Injectable()
export class AITutorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    studentId: string,
    assignmentId?: string,
  ): Promise<TutorSession> {
    return this.prisma.tutorSession.create({
      data: { studentId, assignmentId },
    });
  }

  async findSessionById(
    id: string,
  ): Promise<TutorSessionWithMessages | null> {
    return this.prisma.tutorSession.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async findSessionsForStudent(studentId: string): Promise<TutorSession[]> {
    return this.prisma.tutorSession.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async appendMessage(
    sessionId: string,
    role: TutorMessageRole,
    content: string,
  ): Promise<TutorMessage> {
    return this.prisma.tutorMessage.create({
      data: { sessionId, role, content },
    });
  }

  async endSession(id: string): Promise<TutorSession> {
    return this.prisma.tutorSession.update({
      where: { id },
      data: { status: TutorSessionStatus.ENDED, endedAt: new Date() },
    });
  }

  async countActiveSessions(studentId: string): Promise<number> {
    return this.prisma.tutorSession.count({
      where: { studentId, status: TutorSessionStatus.ACTIVE },
    });
  }
}
