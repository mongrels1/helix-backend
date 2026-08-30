import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { isBillingExempt, showsBillingSurface } from '../../common/billing/billing';
import {
  allowanceFor,
  dayKey,
  isIntroWindow,
  USAGE_KINDS,
  type UsageKind,
} from '../../common/usage/usage.constants';

/** What the counter and the nudge ladder both render from. */
export interface UsageState {
  kind: UsageKind;
  used: number;
  allowance: number;
  remaining: number;
  /** Unlimited: entitled, staff, or institutional. Nothing is metered or shown. */
  unlimited: boolean;
  /** Whether this account may ever be shown a price. */
  metered: boolean;
  intro: boolean;
  day: string;
}

/**
 * The free tier's meter.
 *
 * Entitlement answers "may this account use paid features at all". This answers
 * "how much of it is left today" for the accounts that have no plan. The two are
 * deliberately separate: a subscriber is never counted, and an institutional
 * family is never counted either, because someone else is paying and the
 * consent form they signed promises no charge and no trial.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlement: EntitlementService,
  ) {}

  private async account(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, planSource: true, createdAt: true },
    });
  }

  /**
   * Current state for one feature. Never throws on an unknown user - an absent
   * account is reported as fully metered with nothing remaining rather than
   * silently unlimited.
   */
  async state(userId: string, kind: UsageKind, now = new Date()): Promise<UsageState> {
    const user = await this.account(userId);
    const day = dayKey(now);
    if (!user) {
      return { kind, used: 0, allowance: 0, remaining: 0, unlimited: false, metered: true, intro: false, day };
    }

    // Staff, the owner, institutional families and anyone with an active plan
    // are not metered and are never shown a counter or a price.
    const surfaces = showsBillingSurface(user.role, user.planSource);
    const entitled = isBillingExempt(user.role) || (await this.entitlement.isEntitled(userId));
    if (!surfaces || entitled) {
      return {
        kind, used: 0, allowance: 0, remaining: Number.POSITIVE_INFINITY,
        unlimited: true, metered: false, intro: false, day,
      };
    }

    const row = await this.prisma.dailyUsage.findUnique({
      where: { userId_day_kind: { userId, day, kind } },
      select: { count: true },
    });
    const used = row?.count ?? 0;
    const allowance = allowanceFor(kind, user.createdAt, now);
    return {
      kind,
      used,
      allowance,
      remaining: Math.max(0, allowance - used),
      unlimited: false,
      metered: true,
      intro: isIntroWindow(user.createdAt, now),
      day,
    };
  }

  /** Every metered feature at once - what the dashboard counter reads. */
  async allStates(userId: string, now = new Date()): Promise<UsageState[]> {
    return Promise.all(USAGE_KINDS.map((k) => this.state(userId, k, now)));
  }

  /** True when the account may perform one more of this action right now. */
  async canConsume(userId: string, kind: UsageKind, now = new Date()): Promise<boolean> {
    const s = await this.state(userId, kind, now);
    return s.unlimited || s.remaining > 0;
  }

  /**
   * Record one use. Called AFTER the work succeeded, never before: a failed
   * tutor call must not cost a student one of their three.
   *
   * Unmetered accounts are a no-op, so callers do not have to ask first.
   */
  async consume(userId: string, kind: UsageKind, now = new Date()): Promise<UsageState> {
    const before = await this.state(userId, kind, now);
    if (before.unlimited) return before;

    const day = dayKey(now);
    const row = await this.prisma.dailyUsage.upsert({
      where: { userId_day_kind: { userId, day, kind } },
      create: { userId, day, kind, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return { ...before, used: row.count, remaining: Math.max(0, before.allowance - row.count) };
  }

  /**
   * Seven-day summary for the parent-facing nudge.
   *
   * The most persuasive sentence this product can write is a true one about the
   * parent's own child - "she used all 3 of her tutor questions on 5 of the last
   * 7 days" - so this returns the count of days the child actually ran out, and
   * nothing else. Callers must suppress the nudge when it is low; sending one
   * anyway teaches a parent the messages are automatic.
   */
  async daysAtCap(userId: string, kind: UsageKind, days = 7, now = new Date()): Promise<number> {
    const user = await this.account(userId);
    if (!user) return 0;
    const keys: string[] = [];
    for (let i = 0; i < days; i++) {
      keys.push(dayKey(new Date(now.getTime() - i * 86400000)));
    }
    const rows = await this.prisma.dailyUsage.findMany({
      where: { userId, kind, day: { in: keys } },
      select: { count: true, day: true },
    });
    return rows.filter((r) => r.count >= allowanceFor(kind, user.createdAt, now)).length;
  }

  /**
   * The parent-facing nudge, built from the children's real usage.
   *
   * The most persuasive sentence this product can write is a true one about the
   * parent's own child - "she used all 3 of her tutor questions on 5 of the last
   * 7 days". No claim is attached; the parent supplies the conclusion.
   *
   * Returns nothing at all when the parent is not metered (staff, institutional,
   * already subscribed), and callers must suppress a child whose `daysAtCap` is
   * low - a nudge sent when it is not true teaches a parent that the messages
   * are automatic and they stop reading them.
   */
  async childrenSummary(parentId: string, now = new Date()) {
    const parent = await this.account(parentId);
    if (!parent) return { metered: false, children: [] as unknown[] };

    const entitled = isBillingExempt(parent.role) || (await this.entitlement.isEntitled(parentId));
    if (!showsBillingSurface(parent.role, parent.planSource) || entitled) {
      return { metered: false, children: [] as unknown[] };
    }

    const links = await this.prisma.parentStudentLink.findMany({
      where: { parentId },
      select: {
        student: { select: { id: true, profile: { select: { firstName: true } } } },
      },
    });

    const children = await Promise.all(
      links.map(async (l) => {
        const id = l.student.id;
        const [tutor, practice] = await Promise.all([
          this.daysAtCap(id, 'TUTOR', 7, now),
          this.daysAtCap(id, 'PRACTICE', 7, now),
        ]);
        return {
          studentId: id,
          firstName: l.student.profile?.firstName ?? 'Your child',
          tutorDaysAtCap: tutor,
          practiceDaysAtCap: practice,
          /** The threshold below which the caller must stay silent. */
          worthShowing: Math.max(tutor, practice) >= 3,
        };
      }),
    );

    return { metered: true, children };
  }
}
