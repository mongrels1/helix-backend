import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveDiagnosticDto } from './dto/save-diagnostic.dto';

@Injectable()
export class DiagnosticService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a finished diagnostic. If userId is provided (signed-in student),
   * the session is attached to that account immediately. Otherwise it is stored
   * anonymously with a one-time claimToken so it can be attached after sign-up.
   */
  async save(dto: SaveDiagnosticDto, userId?: string) {
    const claimToken = userId ? null : randomUUID();
    const session = await this.prisma.diagnosticSession.create({
      data: {
        userId: userId ?? null,
        studentName: dto.studentName ?? null,
        grade: dto.grade ?? null,
        length: dto.length,
        theta: dto.theta,
        se: dto.se,
        itemsAsked: dto.itemsAsked,
        profile: dto.profile as Prisma.InputJsonValue,
        claimToken,
        responses: {
          create: dto.responses.map((r) => ({
            itemId: r.itemId,
            strand: r.strand,
            kc: r.kc,
            b: r.b,
            picked: r.picked,
            answer: r.answer,
            correct: r.correct,
            tag: r.tag,
            position: r.position,
          })),
        },
      },
      select: { id: true, claimToken: true },
    });
    return {
      id: session.id,
      saved: Boolean(userId),
      claimToken: session.claimToken,
    };
  }

  /** Attach a previously-anonymous session to a user after they sign up / log in. */
  async claim(sessionId: string, claimToken: string, userId: string) {
    const session = await this.prisma.diagnosticSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Diagnostic session not found');
    if (session.userId) {
      if (session.userId !== userId) {
        throw new ForbiddenException('This diagnostic is already saved to another account');
      }
      return { id: session.id, saved: true };
    }
    if (!session.claimToken || session.claimToken !== claimToken) {
      throw new ForbiddenException('Invalid claim token');
    }
    await this.prisma.diagnosticSession.update({
      where: { id: sessionId },
      data: { userId, claimToken: null },
    });
    return { id: sessionId, saved: true };
  }

  /** Summary list of a user's saved diagnostics (most recent first). */
  async listForUser(userId: string) {
    return this.prisma.diagnosticSession.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        studentName: true,
        grade: true,
        length: true,
        theta: true,
        se: true,
        itemsAsked: true,
        profile: true,
        completedAt: true,
      },
    });
  }

  /** Full saved diagnostic (with per-item responses) for its owner. */
  async getForUser(sessionId: string, userId: string) {
    const session = await this.prisma.diagnosticSession.findUnique({
      where: { id: sessionId },
      include: { responses: { orderBy: { position: 'asc' } } },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Diagnostic session not found');
    }
    return session;
  }
}
