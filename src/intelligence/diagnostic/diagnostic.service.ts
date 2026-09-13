import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MasteryEngineService } from '../mastery-engine/mastery-engine.service';
import { SaveDiagnosticDto } from './dto/save-diagnostic.dto';
import { RemediationService } from '../remediation/remediation.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { applyUrl as fellowsApplyLink } from '@modules/fellows/evidence-token';
import { loadFamilyLinksFor } from '../../common/family/family';

@Injectable()
export class DiagnosticService {
  private readonly logger = new Logger(DiagnosticService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly masteryEngine: MasteryEngineService,
    private readonly remediation: RemediationService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Decide which account a diagnostic belongs to, given whoever is signed in.
   *
   * ★ **A diagnostic belongs to the scholar who sat it, never to the adult at
   * the keyboard.** Both doors into ownership — `save()` for a signed-in run and
   * `claim()` for an anonymous one — ask this one question, so the two can never
   * answer it differently.
   *
   * - **STUDENT** → themselves.
   * - **PARENT with exactly one linked scholar** → that scholar.
   * - **PARENT with none, or several** → nobody. We do not guess which child sat
   *   a test; a wrong guess files one sibling's results on another's record,
   *   which is worse than asking.
   * - **anyone else** → nobody. A teacher or admin account is never the home for
   *   a child's diagnostic.
   *
   * Returns `ownerId: null` plus a `reason` written to be shown to a family,
   * not to a developer. The callers differ in what they do with it: `claim()`
   * refuses, `save()` falls back to storing the run anonymously so it can be
   * filed correctly later. Neither ever throws the result away.
   */
  private async resolveOwner(
    userId: string,
  ): Promise<{ ownerId: string; savedFor: string } | { ownerId: null; reason: string }> {
    const claimer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        email: true,
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    if (!claimer) return { ownerId: null, reason: 'Account not found' };

    if (claimer.role === 'STUDENT') {
      const name = [claimer.profile?.firstName, claimer.profile?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return { ownerId: claimer.id, savedFor: name || claimer.email };
    }

    if (claimer.role === 'PARENT') {
      const links = await loadFamilyLinksFor(this.prisma, claimer.id);
      if (links.children.length === 1) {
        this.logger.log(
          `Diagnostic owner resolved: parent ${claimer.id} -> scholar ${links.children[0].id}`,
        );
        return { ownerId: links.children[0].id, savedFor: links.children[0].name };
      }
      return {
        ownerId: null,
        reason:
          links.children.length === 0
            ? 'This result belongs to a scholar, not to a parent account. Sign in as your scholar to save it, or add them to your family first — the result is kept in the meantime.'
            : 'You have more than one scholar, so we will not guess whose result this is. Sign in as the scholar who took it and it will save to them.',
      };
    }

    return {
      ownerId: null,
      reason:
        'A diagnostic is saved to the scholar who took it. Sign in as that scholar to save this result.',
    };
  }

  /**
   * Persist a finished diagnostic.
   *
   * ⚠ This used to write `userId` — whoever was signed in — straight onto the
   * session, **and set `claimToken` to null because it looked saved**. So a
   * parent signed in while their child sat the test got the child's results on
   * their own record, silently, with no token left in existence to move it. That
   * is a worse failure than the anonymous one, because nothing is recoverable.
   *
   * Now the owner comes from `resolveOwner()`. When it cannot name a scholar the
   * run is stored **anonymously with a claim token** rather than on the wrong
   * account: the results page then shows "not saved yet", and the scholar can
   * sign in and claim it. Saving to nobody is recoverable. Saving to the wrong
   * person is not.
   */
  async save(dto: SaveDiagnosticDto, signedInUserId?: string) {
    const owner = signedInUserId ? await this.resolveOwner(signedInUserId) : null;
    if (owner && owner.ownerId === null) {
      this.logger.warn(
        `Diagnostic from user ${signedInUserId} stored anonymously for later claim: ${owner.reason}`,
      );
    }
    const userId = owner?.ownerId ?? undefined;
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
    // ── EdKairos Fellows admissions evidence ──────────────────────────────────
    // One of the five Fellows eligibility routes is "an EdKairos diagnostic placing the
    // student above grade level". That route has to be checkable, or a parent can simply
    // type a number into the apply URL. So we sign the provisional level HERE, where it
    // was actually computed, and hand back a link the family can follow.
    //
    // Note what is signed: `profile.level` — provisionalLevel(theta) — NOT a percentile.
    // The diagnostic does not compute a percentile and must never be read as if it does.
    // Returns undefined when FELLOWS_PCT_SECRET is unset, and the Fellows route is then
    // simply unavailable rather than silently unverified.
    //
    // Wrapped, and it must stay wrapped. The diagnostic is already in the database by
    // the time we reach here. The Fellows link is an OPTIONAL extra on the way out — a
    // marketing affordance for one of five eligibility routes. If building it fails for
    // any reason, the family must still get their saved diagnostic back. Losing a
    // completed 15-question session because an admissions link could not be signed is
    // exactly backwards, and it is what happened from 7-9 September 2026.
    let fellowsApplyUrl: string | undefined;
    try {
      const level = Number((dto.profile as { level?: unknown } | undefined)?.level);
      if (Number.isFinite(level)) {
        fellowsApplyUrl =
          fellowsApplyLink({
            level,
            grade: Number.isFinite(Number(dto.grade)) ? Number(dto.grade) : undefined,
            theta: dto.theta,
            se: dto.se,
            child: dto.studentName ?? undefined,
            dx: session.id,
          }) ?? undefined;
      }
    } catch (err) {
      this.logger.error(
        `fellows apply link failed for session=${session.id}: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      fellowsApplyUrl = undefined;
    }

    return {
      id: session.id,
      saved: Boolean(userId),
      claimToken: session.claimToken,
      fellowsApplyUrl,
    };
  }

  /**
   * Attach an anonymous diagnostic to an account.
   *
   * ★ **A diagnostic belongs to the scholar who sat it, never to the adult who
   * signs in.**
   *
   * This used to write `userId` — the id of whoever happened to authenticate —
   * straight onto the session. In a family product that is systematically the
   * wrong person: the child takes the test, the parent holds the account and
   * logs in, and the child's results land on the parent's record. On 13 Sept
   * 2026 that is exactly what happened to the Sterlings, and the parent wrote in
   * to say the site had lost her son's assessment. It had not lost it. It had
   * filed it under her name.
   *
   * Ownership now comes from `resolveOwner()` — the same rule `save()` uses.
   *
   * ⚠ The `409` is deliberately distinct from the `403`s below, because the
   * client uses the status to decide whether to keep the claim token and try
   * again. **A 409 is recoverable; a 403 never will be.** Changing either status
   * changes client behaviour — see `claimPendingDiagnostic` in the frontend.
   */
  async claim(sessionId: string, claimToken: string, claimerId: string) {
    const session = await this.prisma.diagnosticSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Diagnostic session not found');

    // `savedFor` is the scholar's display name, returned so the client can say
    // *whose* record it landed on rather than just "saved". A parent told "saved
    // to Cameron's record" can see at a glance that it went to the right child —
    // and "saved" is precisely what the old code could have said while filing it
    // under the wrong person.
    const owner = await this.resolveOwner(claimerId);
    if (owner.ownerId === null) throw new ConflictException(owner.reason);
    const { ownerId, savedFor } = owner;

    // Already attached? Fine if it is already where it belongs.
    if (session.userId) {
      if (session.userId === ownerId) return { id: session.id, saved: true, savedFor };
      throw new ForbiddenException('This diagnostic is already saved to another account');
    }
    if (!session.claimToken || session.claimToken !== claimToken) {
      throw new ForbiddenException('Invalid claim token');
    }

    await this.prisma.diagnosticSession.update({
      where: { id: sessionId },
      data: { userId: ownerId, claimToken: null },
    });
    // Now that the run belongs to a scholar, feed its results into the mastery
    // engine so the autonomous chain (mastery -> pacing -> tutor) engages. This
    // is why moving a row by hand is not equivalent to a real claim.
    const responses = await this.prisma.diagnosticResponse.findMany({
      where: { sessionId },
      select: { kc: true, tag: true },
    });
    await this.syncMasteryFromResponses(ownerId, responses);
    return { id: sessionId, saved: true, savedFor };
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
    // Resolve the student's classroom so mastery updates carry classroom context
    // (lets the pacing / teacher-alert chain attribute the gap to a classroom).
    const classroomId = await this.resolveClassroomId(userId);
    const gaps: string[] = [];
    for (const [kc, { sum, n }] of byKc) {
      const score = sum / n;
      if (score < 0.6) gaps.push(kc);
      try {
        await this.masteryEngine.updateMastery(
          userId,
          kc,
          score,
          1,
          undefined,
          classroomId,
        );
      } catch {
        // Best-effort: skip this KC if the mastery update fails.
      }
    }
    // Zero-touch autonomous trigger (feature-flagged, best-effort): on a finished
    // diagnostic, push a ready-to-use mini-lesson per gap and flag each gap to the
    // teacher's pacing alerts. Fire-and-forget so it never blocks the save.
    if (this.autoRemediationEnabled() && gaps.length > 0) {
      void this.triggerAutoRemediation(userId, classroomId, gaps);
    }
  }

  private autoRemediationEnabled(): boolean {
    return (process.env.AUTO_REMEDIATION_ENABLED ?? '').toLowerCase() === 'true';
  }

  /** Find the student's classroom via enrollment, if any. */
  private async resolveClassroomId(
    userId: string,
  ): Promise<string | undefined> {
    try {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: { studentId: userId },
        select: { classroomId: true },
      });
      return enrollment?.classroomId;
    } catch {
      return undefined;
    }
  }

  /**
   * For each gap KC: build a targeted mini-lesson and push it to the student as an
   * in-app notification (lesson embedded in metadata + a link to the lesson view),
   * then flag the gap to the teacher's pacing alerts. Bounded and best-effort.
   */
  private async triggerAutoRemediation(
    userId: string,
    classroomId: string | undefined,
    gaps: string[],
  ): Promise<void> {
    const MAX_AUTO_LESSONS = 12;
    for (const kc of gaps.slice(0, MAX_AUTO_LESSONS)) {
      try {
        const lesson = await this.remediation.buildLesson({ kc });
        await this.notifications.notify({
          userId,
          title: `New lesson ready: ${kc}`,
          body: `Your diagnostic showed a gap in ${kc}. A short lesson and quick check are ready for you.`,
          metadata: {
            type: 'auto_remediation',
            kc,
            link: `/dashboard/student/learn?kc=${encodeURIComponent(kc)}`,
            lesson,
          },
        });
      } catch (err) {
        this.logger.warn(
          `auto-remediation lesson failed for kc=${kc}: ${String(err)}`,
        );
      }
      try {
        await this.masteryEngine.flagGapForPacing({
          studentId: userId,
          skillTag: kc,
          currentScore: 0.15,
          classroomId,
        });
      } catch (err) {
        this.logger.warn(
          `auto-remediation pacing flag failed for kc=${kc}: ${String(err)}`,
        );
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

  /**
   * Published items from the diagnostic staging bank, shaped for the client
   * adaptive engine ({ id, g, strand, kc, b, stem, opts, correct }). Returns []
   * when nothing is published yet — the client then falls back to its in-code
   * bank, so the live diagnostic never breaks during curation.
   */
  async publishedBank() {
    const items = await this.prisma.diagnosticItem.findMany({
      where: { status: 'published' },
      select: { id: true, grade: true, strand: true, kc: true, b: true, stem: true, options: true, correct: true, figure: true },
      orderBy: [{ grade: 'asc' }, { strand: 'asc' }],
    });
    return items.map((it) => ({
      id: it.id,
      g: it.grade,
      strand: it.strand,
      kc: it.kc,
      b: it.b,
      stem: it.stem,
      opts: it.options,
      correct: it.correct,
      figure: it.figure ?? undefined,
    }));
  }

  /**
   * Item ids the student saw in their most recent diagnostic sessions. The
   * adaptive engine uses these to avoid re-serving the same questions every run
   * (the "same questions every time" problem). Capped to a few recent sessions
   * so the finite calibrated bank still rotates back over time, and so a heavy
   * user is never excluded out of a full-length diagnostic.
   */
  async seenItemIds(userId: string, recentSessions = 3): Promise<string[]> {
    const recent = await this.prisma.diagnosticSession.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      take: Math.max(1, recentSessions),
      select: { responses: { select: { itemId: true } } },
    });
    const ids = new Set<string>();
    for (const session of recent) {
      for (const response of session.responses) ids.add(response.itemId);
    }
    return [...ids];
  }
}
