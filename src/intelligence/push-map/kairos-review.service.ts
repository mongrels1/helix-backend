import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../modules/email/email.service';
import { coveringParent, loadFamilyLinksFor } from '../../common/family/family';
import { coverLetterHtml, coverLetterSubject, coverLetterText } from './kairos-email';
import { sign, verify, viewUrl } from './kairos-link';
import type { PushMap, ScoreExtraction } from './push-map.types';

export type ReportStatus = 'PENDING_REVIEW' | 'APPROVED' | 'SENT' | 'REJECTED';

/**
 * The administrative gate between a generated Kairos Point and a family.
 *
 * ★ **Nothing in this service sends anything on its own.** Generation writes a
 * row at `PENDING_REVIEW`; only `approve()` moves it forward, and only
 * `dispatch()` sends — each an explicit call from an authenticated admin, each
 * recorded with who did it.
 *
 * The reason is the same one the confirm screen exists for, one step further
 * out. The report makes specific, actionable claims about a named child, built
 * from numbers a model read off a scanned document. The confirm screen catches a
 * misread before the page is built. This catches everything the confirm screen
 * could not: a plausible number attached to the wrong domain, a strand mapped
 * oddly, a sentence that reads badly for this particular family. A wrong report
 * that was never sent is an inconvenience; a wrong report in a parent's inbox is
 * a trust problem that no correction fully undoes.
 */
@Injectable()
export class KairosReviewService {
  private readonly logger = new Logger(KairosReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Called by PushMapService the moment a map is composed. */
  async record(input: {
    studentId: string;
    createdById: string;
    extraction: ScoreExtraction;
    map: PushMap;
    productId: string;
    reach: number;
  }): Promise<{ id: string }> {
    const row = await this.prisma.kairosPointReport.create({
      data: {
        studentId: input.studentId,
        createdById: input.createdById,
        status: 'PENDING_REVIEW',
        extraction: input.extraction as unknown as object,
        map: input.map as unknown as object,
        productId: input.productId,
        reach: input.reach,
        studentName: input.map.studentName,
        assessmentName: input.map.assessmentName,
        takenOn: input.map.takenOn,
        overall: input.map.overall,
      },
      select: { id: true },
    });
    this.logger.log(`Kairos Point ${row.id} recorded for ${input.studentId}, awaiting review`);
    return row;
  }

  /** The review queue. Oldest first — a report waiting longest is the one to do. */
  async queue(status: ReportStatus = 'PENDING_REVIEW', take = 50) {
    return this.prisma.kairosPointReport.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take,
      select: {
        id: true,
        status: true,
        studentName: true,
        assessmentName: true,
        takenOn: true,
        overall: true,
        productId: true,
        reach: true,
        createdAt: true,
        sentAt: true,
        sentToEmail: true,
        reviewNote: true,
      },
    });
  }

  async get(id: string) {
    const row = await this.prisma.kairosPointReport.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Report not found');
    return row;
  }

  async approve(id: string, reviewerId: string) {
    const row = await this.get(id);
    if (row.status === 'SENT') throw new ConflictException('Already sent.');
    return this.prisma.kairosPointReport.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: null },
    });
  }

  /**
   * Rejection requires a reason, and the reason is kept.
   *
   * Not bureaucracy: a rejected report is the only evidence we get that the
   * reader misread something, and the pattern across several is what tells us
   * whether to fix the prompt, the render resolution, or the confirm screen. A
   * rejection with no reason throws that signal away.
   */
  async reject(id: string, reviewerId: string, note: string) {
    const reason = (note ?? '').trim();
    if (reason.length < 3) {
      throw new BadRequestException('Say why it was rejected — the reason is the useful part.');
    }
    const row = await this.get(id);
    if (row.status === 'SENT') throw new ConflictException('Already sent; cannot reject.');
    return this.prisma.kairosPointReport.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewNote: reason,
      },
    });
  }

  /**
   * Send an approved report to the paying parent.
   *
   * Refuses anything not explicitly APPROVED, and refuses to send twice. Both
   * are deliberate: an endpoint that would send a PENDING_REVIEW report if asked
   * nicely is not a gate, and a duplicate send is how a family receives the same
   * report three times because a button was double-clicked.
   */
  async dispatch(id: string, senderId: string): Promise<{ sentTo: string }> {
    const row = await this.get(id);

    if (row.status === 'SENT') {
      throw new ConflictException(`Already sent on ${row.sentAt?.toISOString() ?? 'an earlier date'}.`);
    }
    if (row.status !== 'APPROVED') {
      throw new ConflictException('This report has not been approved. Approve it first.');
    }

    // Who pays is who hears from us — the same rule the ribbon and the admin
    // list use, rather than a second guess at which adult to email.
    const family = await loadFamilyLinksFor(this.prisma, row.studentId);
    const payer = coveringParent(family) ?? family.parents[0] ?? null;
    if (!payer?.email) {
      throw new BadRequestException(
        'No parent is linked to this scholar, so there is nobody to send it to. Link a parent first.',
      );
    }

    const token = sign(row.id);
    if (!token) {
      // Refusing beats sending an unsigned or weakly signed link. See kairos-link.ts.
      throw new BadRequestException(
        'KAIROS_LINK_SECRET is not configured, so a secure link cannot be signed. Nothing was sent.',
      );
    }

    const map = row.map as unknown as PushMap;
    const firstName = (map.studentName ?? '').trim().split(/\s+/)[0] || 'your scholar';
    const url = viewUrl(token);

    await this.email.sendWeeklyReport(
      payer.email,
      coverLetterSubject(firstName),
      coverLetterHtml(firstName, url),
      coverLetterText(firstName, url),
    );

    await this.prisma.kairosPointReport.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), sentToEmail: payer.email },
    });
    this.logger.log(`Kairos Point ${id} sent to ${payer.email} by ${senderId}`);
    return { sentTo: payer.email };
  }

  /**
   * Resolve a signed link to the report behind it.
   *
   * Deliberately returns only the composed map, never the row: the confirmed
   * extraction, the reviewer, the internal status and the product id are ours,
   * not the family's.
   */
  async openByToken(token: unknown): Promise<{ map: PushMap }> {
    const result = verify(token);
    if (!result.ok) {
      throw new NotFoundException(
        result.reason === 'expired'
          ? 'This link has expired. Ask us for a fresh one and we will send it.'
          : 'This link is not valid.',
      );
    }
    const row = await this.prisma.kairosPointReport.findUnique({
      where: { id: result.reportId },
      select: { map: true, status: true },
    });
    // A valid signature over a report that was never sent must still not open —
    // otherwise a link generated during review is a way around the gate.
    if (!row || row.status !== 'SENT') throw new NotFoundException('This link is not valid.');
    return { map: row.map as unknown as PushMap };
  }
}
