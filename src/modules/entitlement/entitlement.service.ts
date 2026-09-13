import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isBillingExempt, isPlanActive } from '../../common/billing/billing';
import { coveringParent, loadFamilyLinksFor } from '../../common/family/family';

/**
 * Decides whether a user may access the PAID learning features (AI Tutor,
 * Practice, Skills-Up). The diagnostic is always free and is never gated by this.
 *
 * A user is entitled if EITHER:
 *  - their own subscription is active (planStatus = 'active' and not past renewal), OR
 *  - (for a child STUDENT) a linked PARENT's subscription is active — family plans
 *    cover every child linked via ParentStudentLink.
 *
 * The two tests it applies — `isPlanActive` and `coveringParent` — are now
 * shared with the admin user list rather than private to this file. That is the
 * whole point of the change: the list rendered "No plan" and an enabled delete
 * button on the very scholars this service was already treating as paid.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

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
    if (isPlanActive(user.planStatus, user.planRenewsAt)) return true;

    if (user.role === 'STUDENT') {
      const links = await loadFamilyLinksFor(this.prisma, userId);
      return coveringParent(links) !== null;
    }
    return false;
  }
}
