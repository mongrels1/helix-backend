import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isPlanActive } from '../billing/billing';

/**
 * Household membership — the parent↔scholar relation, in one place.
 *
 * ## Why this module exists
 *
 * `EntitlementService` has always known that a scholar's access can come from a
 * linked parent's subscription: that is what makes a family plan a family plan.
 * The admin user list did not know it. It derived both the Subscription column
 * and `canDelete` from `planStatus` **on the row itself**, so a scholar created
 * through a paying parent's "Add a child" button rendered as:
 *
 *     Cameron Sterling · STUDENT · No plan · [delete enabled]
 *
 * with nothing anywhere on the row naming Marsha. That is a live data-loss
 * hazard, not a cosmetic one — `UsersRepository.hardDelete()` explicitly
 * `deleteMany`s `ParentStudentLink`, so the foreign key does not stop the
 * delete either. The link is destroyed first and the scholar goes with it.
 *
 * So: the household rule now lives here, and the admin list, the delete guard
 * and entitlement all read it. Same shape as `common/billing/billing.ts` — one
 * answer, read by everything, so the answers cannot drift apart again.
 */

/**
 * Seats for an account whose `maxStudents` is null — every account created
 * before provisioning began setting it. One, deliberately: a larger default
 * would hand every legacy row seats nobody paid for. Purchases set the real
 * number in `provisioning.planConfig()`.
 *
 * Lives here rather than in `parent-experience.service` so the admin link
 * picker can display the same allowance that service enforces. Two copies of
 * this number would have been the same class of defect as the two copies of
 * "is this plan active".
 */
export const DEFAULT_FAMILY_SEATS = 1;

export interface FamilyMember {
  id: string;
  email: string;
  /** Display name, falling back to the email when no profile exists. */
  name: string;
  role: string;
  plan: string | null;
  planStatus: string | null;
  planRenewsAt: Date | null;
  /** Pre-computed so callers never re-derive "is this plan live?" themselves. */
  planActive: boolean;
}

export interface FamilyLinks {
  /** PARENT accounts this user is a child of. */
  parents: FamilyMember[];
  /** STUDENT accounts this user is the parent of. */
  children: FamilyMember[];
}

type LinkedUserRow = {
  id: string;
  email: string;
  role: string;
  plan: string | null;
  planStatus: string | null;
  planRenewsAt: Date | null;
  profile: { firstName: string | null; lastName: string | null } | null;
};

const linkedUserSelect = {
  id: true,
  email: true,
  role: true,
  plan: true,
  planStatus: true,
  planRenewsAt: true,
  profile: { select: { firstName: true, lastName: true } },
} as const;

function toMember(row: LinkedUserRow): FamilyMember {
  const name = `${row.profile?.firstName ?? ''} ${row.profile?.lastName ?? ''}`.trim();
  return {
    id: row.id,
    email: row.email,
    name: name || row.email,
    role: row.role,
    plan: row.plan,
    planStatus: row.planStatus,
    planRenewsAt: row.planRenewsAt,
    planActive: isPlanActive(row.planStatus, row.planRenewsAt),
  };
}

/**
 * Both directions of the household relation for a page of users, in two
 * queries regardless of page size.
 *
 * Deliberately batched: the admin list renders up to 100 rows and a per-row
 * lookup would be 200 round trips. Returns an entry for every id passed in,
 * so callers never have to null-check the map.
 */
export async function loadFamilyLinks(
  prisma: PrismaService,
  userIds: string[],
): Promise<Map<string, FamilyLinks>> {
  const result = new Map<string, FamilyLinks>();
  for (const id of userIds) result.set(id, { parents: [], children: [] });
  if (userIds.length === 0) return result;

  const [asChild, asParent] = await Promise.all([
    // Rows where one of our users is the scholar -> collect their parents.
    prisma.parentStudentLink.findMany({
      where: { studentId: { in: userIds } },
      select: { studentId: true, parent: { select: linkedUserSelect } },
    }),
    // Rows where one of our users is the parent -> collect their scholars.
    prisma.parentStudentLink.findMany({
      where: { parentId: { in: userIds } },
      select: { parentId: true, student: { select: linkedUserSelect } },
    }),
  ]);

  for (const row of asChild) {
    result.get(row.studentId)?.parents.push(toMember(row.parent as LinkedUserRow));
  }
  for (const row of asParent) {
    result.get(row.parentId)?.children.push(toMember(row.student as LinkedUserRow));
  }
  return result;
}

/** The single-user form. Same rule, one id. */
export async function loadFamilyLinksFor(
  prisma: PrismaService,
  userId: string,
): Promise<FamilyLinks> {
  const map = await loadFamilyLinks(prisma, [userId]);
  return map.get(userId) ?? { parents: [], children: [] };
}

/**
 * The parent whose subscription is actually paying for this scholar, if any.
 *
 * This is the same test `EntitlementService.isEntitled()` applies when it
 * decides whether to unlock the AI Tutor, so the admin list can no longer say
 * "No plan" about an account the product itself treats as paid.
 */
export function coveringParent(links: FamilyLinks): FamilyMember | null {
  return links.parents.find((parent) => parent.planActive) ?? null;
}

/**
 * What to print in the Subscription column, and where the answer came from.
 *
 * `own`     — this account holds the subscription.
 * `parent`  — a linked parent holds it; this scholar rides on it.
 * `none`    — nobody is paying for this account.
 *
 * `label` is the plan's product name when one is recorded. It can be null on a
 * genuinely paid account: the Stripe webhook path did not write a plan label
 * until this change, so rows created before it carry a status and no name.
 * Render "Paid" in that case — never invent a tier.
 */
export function resolvePlan(
  self: { plan?: string | null; planStatus?: string | null; planRenewsAt?: Date | null },
  links: FamilyLinks,
): { source: 'own' | 'parent' | 'none'; label: string | null; via: FamilyMember | null } {
  if (isPlanActive(self.planStatus ?? null, self.planRenewsAt ?? null)) {
    return { source: 'own', label: self.plan ?? null, via: null };
  }
  const parent = coveringParent(links);
  if (parent) {
    return { source: 'parent', label: parent.plan ?? null, via: parent };
  }
  // An inactive-but-present status (past_due, canceled) still names its plan.
  if (self.plan) return { source: 'own', label: self.plan, via: null };
  return { source: 'none', label: null, via: null };
}

/**
 * Why this account must not be hard-deleted, as a sentence an admin can act on
 * — or null when the household places no objection.
 *
 * Deleting either end of a link destroys the link row, and with it the family's
 * seat accounting and the scholar's route to their parent's subscription.
 * Pausing does neither, which is why every message here points at pause.
 */
export function familyDeleteBlock(
  role: string | null | undefined,
  links: FamilyLinks,
): string | null {
  if (role === Role.STUDENT && links.parents.length > 0) {
    const parent = coveringParent(links) ?? links.parents[0];
    const paying = parent.planActive ? ' (paying)' : '';
    return (
      `Linked to parent ${parent.name}${paying}. Deleting this scholar removes them ` +
      `from that family and frees nothing — unlink or pause instead.`
    );
  }
  if (links.children.length > 0) {
    const names = links.children.map((c) => c.name).join(', ');
    const count = links.children.length;
    return (
      `Parent of ${count} linked ${count === 1 ? 'scholar' : 'scholars'} (${names}). ` +
      `Deleting this account orphans ${count === 1 ? 'that login' : 'those logins'} — pause instead.`
    );
  }
  return null;
}
