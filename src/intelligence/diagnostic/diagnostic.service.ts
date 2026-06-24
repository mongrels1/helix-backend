import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasteryEngineService } from '../mastery-engine/mastery-engine.service';
import { SaveDiagnosticDto } from './dto/save-diagnostic.dto';

@Injectable()
export class DiagnosticService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly masteryEngine: MasteryEngineService,
  ) {}

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
    // Close the loop: a signed-in student's results flow straight into the
    // mastery engine (which chains to pacing + the AI tutor). Anonymous runs
    // sync later, on claim.
    if (userId) {
      await this.syncMasteryFromResponses(userId, dto.responses);
    }
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
    // Now that the anonymous run belongs to a student, feed its results into the
    // mastery engine so the autonomous chain (mastery -> pacing -> tutor) engages.
    const responses = await this.prisma.diagnosticResponse.findMany({
      where: { sessionId },
      select: { kc: true, tag: true },
    });
    await this.syncMasteryFromResponses(userId, responses);
    return { id: sessionId, saved: true };
  }

  /**
   * Map a finished diagnostic's per-item results onto per-knowledge-component
   * mastery scores and push them into the mastery engine. This is the joint that
   * makes the diagnostic the entry point of the autonomous loop: mastery updates
   * fan out to pacing recommendations and the AI tutor. Best-effort — a mastery
   * failure must never break saving the diagnostic itself.
   */
  private async syncMasteryFromResponses(
    userId: string,
    responses: { kc: string; tag: string }[],
  ): Promise<void> {
    // Aggregate per KC (mean of state values; above-level misses are skipped).
    const byKc = new Map<string, { sum: number; n: number }>();
    for (const response of responses) {
      const value = this.masteryValueForTag(response.tag);
      if (value === null) continue;
      const entry = byKc.get(response.kc) ?? { sum: 0, n: 0 };
      entry.sum += value;
      entry.n += 1;
      byKc.set(response.kc, entry);
    }
    for (const [kc, { sum, n }] of byKc) {
      try {
        await this.masteryEngine.updateMastery(userId, kc, sum / n, 1);
      } catch {
        // Best-effort: skip this KC if the mastery update fails.
      }
    }
  }

  /**
   * Convert a diagnostic response tag to a 0..1 mastery value.
   * Returns null for above-level items (a harder-than-grade miss is not a gap).
   */
  private masteryValueForTag(tag: string): number | null {
    const t = tag.toLowerCase().replace(/[^a-z]/g, '');
    if (t.includes('master')) return 1;
    if (t.includes('emerg')) return 0.6;
    if (t.includes('above') || t.includes('stretch') || t.includes('reach')) return null;
    return 0.15; // not yet
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
