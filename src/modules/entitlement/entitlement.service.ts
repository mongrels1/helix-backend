import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isBillingExempt } from '../../common/billing/billing';

/**
 * Decides whether a user may access the PAID learning features (AI Tutor,
 * Practice, Skills-Up). The diagnostic is always free and is never gated by this.
 *
 * A user is entitled if EITHER:
 *  - their own subscription is active (planStatus = 'active' and not past renewal), OR
 *  - (for a child STUDENT) a linked PARENT's subscription is active — family plans
 *    cover every child linked via ParentStudentLink.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  private isActive(planStatus: string | null, planRenewsAt: Date | null): boolean {
    if (planStatus !== 'active') return false;
    return planRenewsAt === null || planRenewsAt.getTime() > Date.now();
  }

  async isEntitled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, planStatus: true, planRenewsAt: true },
    });
    if (!user) return false;
    // Staff and the owner do not pay, so they are entitled regardless of what
    // planStatus happens to say. Without this a stray Stripe webhook against
    // the owner's email would revoke the owner's own access.
    if (isBillingExempt(user.role)) return true;
    if (this.isActive(user.planStatus, user.planRenewsAt)) return true;

    if (user.role === 'STUDENT') {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { studentId: userId },
        select: { parent: { select: { planStatus: true, planRenewsAt: true } } },
      });
      return links.some((l) => this.isActive(l.parent.planStatus, l.parent.planRenewsAt));
    }
    return false;
  }
}
