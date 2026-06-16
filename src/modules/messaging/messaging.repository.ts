import { Injectable } from '@nestjs/common';
import { Message, Thread } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const threadDetailInclude = {
  participants: true,
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
  },
};

@Injectable()
export class MessagingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findThreadsByUser(
    userId: string,
    page: number,
    limit: number,
  ): Promise<[Thread[], number]> {
    const where = { participants: { some: { userId } } };
    const skip = (page - 1) * limit;
    const [threads, total] = await this.prisma.$transaction([
      this.prisma.thread.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { participants: true } },
        },
      }),
      this.prisma.thread.count({ where }),
    ]);
    return [threads as Thread[], total];
  }

  async findThreadById(id: string): Promise<Thread | null> {
    return this.prisma.thread.findUnique({
      where: { id },
      include: threadDetailInclude,
    }) as Promise<Thread | null>;
  }

  async createThread(
    subject: string | undefined,
    participantIds: string[],
  ): Promise<Thread> {
    const uniqueParticipantIds = [...new Set(participantIds)];
    return this.prisma.thread.create({
      data: {
        subject,
        participants: {
          create: uniqueParticipantIds.map((userId) => ({ userId })),
        },
      },
      include: threadDetailInclude,
    }) as Promise<Thread>;
  }

  async addMessage(
    threadId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: { threadId, senderId, content },
    });
  }

  async getMessages(
    threadId: string,
    page: number,
    limit: number,
  ): Promise<[Message[], number]> {
    const where = { threadId };
    const skip = (page - 1) * limit;
    const [messages, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.message.count({ where }),
    ]);
    return [messages, total];
  }

  async isParticipant(threadId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.threadParticipant.count({
      where: { threadId, userId },
    });
    return count > 0;
  }
}
