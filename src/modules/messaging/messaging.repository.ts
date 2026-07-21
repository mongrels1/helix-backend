import { Injectable } from '@nestjs/common';
import { Message, Role, Thread } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecipientResult {
  id: string;
  name: string;
  role: Role;
  email: string;
  sublabel: string;
}

function displayName(
  profile: { firstName: string; lastName: string } | null | undefined,
  email: string,
): string {
  const name = `${profile?.firstName ?? ''} ${profile?.lastName ?? ''}`.trim();
  return name || email;
}

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

  // Prefix-match on first OR last name (case-insensitive), scoped to the
  // students enrolled in this teacher's classrooms and those students' linked
  // parents. Typing "kat" surfaces "Kataleena". An empty query returns the
  // first slice of eligible people so the picker can show suggestions.
  async searchTeacherRecipients(
    teacherId: string,
    query: string,
    limit = 10,
  ): Promise<RecipientResult[]> {
    const classrooms = await this.prisma.classroom.findMany({
      where: { teacherId, deletedAt: null },
      select: { id: true },
    });
    const classroomIds = classrooms.map((classroom) => classroom.id);
    if (classroomIds.length === 0) return [];

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId: { in: classroomIds } },
      select: { studentId: true },
    });
    const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
    if (studentIds.length === 0) return [];

    const parentLinks = await this.prisma.parentStudentLink.findMany({
      where: { studentId: { in: studentIds } },
      select: {
        parentId: true,
        student: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    const parentToStudents = new Map<string, string[]>();
    for (const link of parentLinks) {
      const childName = displayName(link.student?.profile, link.student?.email ?? '');
      const list = parentToStudents.get(link.parentId) ?? [];
      if (childName) list.push(childName);
      parentToStudents.set(link.parentId, list);
    }
    const parentIds = [...new Set(parentLinks.map((link) => link.parentId))];

    const candidateIds = [...new Set([...studentIds, ...parentIds])];
    const q = query.trim();
    const nameFilter = q
      ? {
          OR: [
            { profile: { firstName: { startsWith: q, mode: 'insensitive' as const } } },
            { profile: { lastName: { startsWith: q, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const users = await this.prisma.user.findMany({
      where: { id: { in: candidateIds }, ...nameFilter },
      include: { profile: true },
      orderBy: { profile: { firstName: 'asc' } },
      take: limit,
    });

    return users.map((user) => {
      const name = displayName(user.profile, user.email);
      let sublabel: string = user.role;
      if (user.role === Role.STUDENT) sublabel = 'Student';
      if (user.role === Role.PARENT) {
        const kids = parentToStudents.get(user.id) ?? [];
        sublabel = kids.length ? `Parent · ${kids.join(', ')}` : 'Parent';
      }
      return { id: user.id, name, role: user.role, email: user.email, sublabel };
    });
  }

  // Broader search for org/super admins: any user with a matching name prefix,
  // excluding the caller.
  async searchAllRecipients(
    query: string,
    excludeUserId: string,
    limit = 10,
  ): Promise<RecipientResult[]> {
    const q = query.trim();
    const nameFilter = q
      ? {
          OR: [
            { profile: { firstName: { startsWith: q, mode: 'insensitive' as const } } },
            { profile: { lastName: { startsWith: q, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const users = await this.prisma.user.findMany({
      where: { id: { not: excludeUserId }, ...nameFilter },
      include: { profile: true },
      orderBy: { profile: { firstName: 'asc' } },
      take: limit,
    });
    return users.map((user) => ({
      id: user.id,
      name: displayName(user.profile, user.email),
      role: user.role,
      email: user.email,
      sublabel: user.role.charAt(0) + user.role.slice(1).toLowerCase(),
    }));
  }
}
