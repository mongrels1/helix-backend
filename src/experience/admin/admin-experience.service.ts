import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AttendanceStatus,
  Prisma,
  Role,
  SubmissionStatus,
  TutorSessionStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { isBillingExempt, isOwnerAccount, isPlanActive } from '../../common/billing/billing';
import {
  DEFAULT_FAMILY_SEATS,
  familyDeleteBlock,
  loadFamilyLinks,
  resolvePlan,
  type FamilyMember,
} from '../../common/family/family';
import {
  COMPARABLE_PRODUCT_IDS,
  PRODUCTS,
  comparisonMatrix,
  includesFor,
  isAssignableProductId,
  productFor,
  type ProductDefinition,
  type ProductId,
} from '../../common/product/product';

/** The product, flattened for the wire. `includes` is not sent with the list. */
interface ProductRef {
  id: ProductId;
  name: string;
  price: string | null;
  summary: string;
  invitationOnly: boolean;
}

function toProductRef(def: ProductDefinition): ProductRef {
  return {
    id: def.id,
    name: def.name,
    price: def.price,
    summary: def.summary,
    invitationOnly: def.invitationOnly,
  };
}

/** What a linked relative looks like on the wire. Dates are serialised by Nest. */
interface FamilyRef {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  planStatus: string | null;
  planActive: boolean;
}

/** A parent offered in the admin link picker, with their seat allowance. */
interface LinkableParent extends FamilyRef {
  seats: number;
  seatsUsed: number;
  seatsFull: boolean;
}

function toRef(member: FamilyMember): FamilyRef {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    plan: member.plan,
    planStatus: member.planStatus,
    planActive: member.planActive,
  };
}

@Injectable()
export class AdminExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getDashboard() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      users,
      organizations,
      classrooms,
      courses,
      assignments,
      submissions,
      activeEnrollments,
      newUsersLast7Days,
      submissionsLast7Days,
      gradedLast7Days,
      atRiskRows,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.classroom.count({ where: { deletedAt: null } }),
      this.prisma.course.count({ where: { deletedAt: null } }),
      this.prisma.assignment.count({ where: { deletedAt: null } }),
      this.prisma.submission.count(),
      this.prisma.enrollment.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.submission.count({ where: { createdAt: { gte: since } } }),
      this.prisma.grade.count({ where: { createdAt: { gte: since } } }),
      this.prisma.attendanceRecord.groupBy({
        by: ['studentId'],
        where: { status: AttendanceStatus.ABSENT },
        orderBy: { studentId: 'asc' },
        _count: { _all: true },
        having: { studentId: { _count: { gte: 3 } } },
      }),
    ]);

    return {
      counts: {
        users,
        organizations,
        classrooms,
        courses,
        assignments,
        submissions,
        activeEnrollments,
      },
      recentActivity: {
        newUsersLast7Days,
        submissionsLast7Days,
        gradedLast7Days,
      },
      atRiskStudents: atRiskRows.length,
    };
  }

  async getUsers(page = 1, limit = 20, role?: Role, search?: string) {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const trimmedSearch = search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(role ? { role } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { email: { contains: trimmedSearch, mode: 'insensitive' } },
              {
                profile: {
                  is: { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
                },
              },
              {
                profile: {
                  is: { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        skip: (normalizedPage - 1) * normalizedLimit,
        take: normalizedLimit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const ids = users.map((u) => u.id);
    const [enr, sub, cls, ic, families] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { studentId: { in: ids } }, select: { studentId: true } }),
      this.prisma.submission.findMany({ where: { studentId: { in: ids } }, select: { studentId: true } }),
      this.prisma.classroom.findMany({ where: { teacherId: { in: ids } }, select: { teacherId: true } }),
      this.prisma.instructorContent.findMany({ where: { teacherId: { in: ids } }, select: { teacherId: true } }),
      // Two extra queries for the whole page, not two per row.
      loadFamilyLinks(this.prisma, ids),
    ]);
    const activeIds = new Set<string>();
    for (const r of enr) activeIds.add(r.studentId);
    for (const r of sub) activeIds.add(r.studentId);
    for (const r of cls) activeIds.add(r.teacherId);
    for (const r of ic) if (r.teacherId) activeIds.add(r.teacherId);

    return {
      users: users.map((user) => {
        const family = families.get(user.id) ?? { parents: [], children: [] };
        // isPlanActive, not `=== 'active'`: a lapsed period is not a live plan,
        // and the product already stopped honouring it.
        const isPaid = isPlanActive(user.planStatus, user.planRenewsAt);
        const hasActivity = activeIds.has(user.id);
        const plan = resolvePlan(user, family);
        const familyBlock = familyDeleteBlock(user.role, family);

        // One ordered answer to "why is delete off?", because the old tooltip
        // said "has activity or a plan" for every reason including ownership,
        // and said nothing at all for the reason that actually mattered here.
        let deleteBlockedReason: string | null = null;
        if (isOwnerAccount(user.role)) {
          deleteBlockedReason = 'The owner account cannot be deleted.';
        } else if (familyBlock) {
          deleteBlockedReason = familyBlock;
        } else if (isPaid) {
          deleteBlockedReason = 'This account holds an active paid subscription — pause it instead.';
        } else if (hasActivity) {
          deleteBlockedReason =
            'This account has enrollments, submissions or taught classrooms — pause it instead.';
        }

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.profile?.firstName ?? null,
          lastName: user.profile?.lastName ?? null,
          createdAt: user.createdAt,
          deletedAt: user.deletedAt,
          suspendedAt: user.suspendedAt,
          plan: user.plan,
          planStatus: user.planStatus,
          planRenewsAt: user.planRenewsAt,
          // Staff and the owner are not billed, so any planStatus on those rows
          // is stale noise - the client renders "not billed" instead of a
          // billing state, and no billing rule may act on it.
          billingExempt: isBillingExempt(user.role),
          status: user.suspendedAt ? 'paused' : 'active',

          // --- Household. A scholar created through a paying parent's "Add a
          // child" button carries no plan of their own, so without these fields
          // the row reads as an abandoned free signup and invites deletion.
          linkedParents: family.parents.map(toRef),
          linkedChildren: family.children.map(toRef),
          /** The parent actually paying for this scholar, per EntitlementService. */
          coveredBy: plan.source === 'parent' && plan.via ? toRef(plan.via) : null,
          /** Product name to print. Null on a paid row means no label was ever recorded. */
          planLabel: plan.label,
          /** 'own' | 'parent' | 'none' — where the entitlement comes from. */
          planSourceKind: plan.source,

          /**
           * The resolved product — its own column in the UI, so accounts can be
           * sorted and segmented by what they bought. A scholar inherits the
           * product of the parent actually paying for them, which is why this
           * reads `plan.via` rather than the row's own label: Cameron Sterling
           * has no plan of his own and is on Above-Grade all the same.
           */
          product: toProductRef(
            plan.source === 'parent' && plan.via
              ? productFor(plan.via.plan, null, true)
              : productFor(user.plan, user.planSource, isPaid, user.role),
          ),

          canDelete: !isPaid && !hasActivity && !isOwnerAccount(user.role) && !familyBlock,
          deleteBlockedReason,
        };
      }),
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  /**
   * Attach an existing scholar to an existing parent, or detach them.
   *
   * The repair half of the same defect: showing the link is no use on a family
   * whose link was never created — a scholar who signed up at /register rather
   * than through the parent's "Add a child" button has no ParentStudentLink at
   * all, is not entitled through the parent's plan, and looks exactly like a
   * bot signup in this list.
   *
   * Creation lives on `POST /api/v1/experience/parent/link`, which is already
   * admin-scoped; this is the matching removal, kept here so both ends of the
   * admin-facing operation are reachable from the admin surface.
   */
  async listLinkableParents(search?: string): Promise<{ parents: LinkableParent[] }> {
    const term = search?.trim();
    const parents = await this.prisma.user.findMany({
      where: {
        role: Role.PARENT,
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { email: { contains: term, mode: 'insensitive' } },
                { profile: { is: { firstName: { contains: term, mode: 'insensitive' } } } },
                { profile: { is: { lastName: { contains: term, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        plan: true,
        planStatus: true,
        planRenewsAt: true,
        maxStudents: true,
        profile: { select: { firstName: true, lastName: true } },
        // Seats in use, so the picker can show "2 of 3" before the admin
        // commits rather than after the server refuses.
        _count: { select: { parentLinks: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    return {
      parents: parents.map((p) => {
        const name = `${p.profile?.firstName ?? ''} ${p.profile?.lastName ?? ''}`.trim();
        const seats = p.maxStudents ?? DEFAULT_FAMILY_SEATS;
        const seatsUsed = p._count.parentLinks;
        return {
          id: p.id,
          name: name || p.email,
          email: p.email,
          plan: p.plan,
          planStatus: p.planStatus,
          planActive: isPlanActive(p.planStatus, p.planRenewsAt),
          seats,
          seatsUsed,
          seatsFull: seatsUsed >= seats,
        };
      }),
    };
  }

  /**
   * Correct the product on an account by hand.
   *
   * Exists because there was no way to. `UpdateUserDto` extends `CreateUserDto`,
   * which carries email, name, role and password and nothing about billing — so
   * when a customer on Above-Grade was recorded as Standard, the only routes to
   * fixing it were a SQL statement or waiting for her next renewal.
   *
   * **This writes the label and the seat count; it does not touch `planStatus`.**
   * It is a correction to what somebody bought, not a grant of access. An
   * account with no active plan stays without one, and the caller is told so
   * rather than quietly ending up with a product name on a free row.
   */
  async setProduct(
    userId: string,
    productId: string,
  ): Promise<{
    id: string;
    product: ProductRef;
    seats: number | null;
    seatsChangedFrom: number | null;
    warning: string | null;
  }> {
    if (!isAssignableProductId(productId)) {
      throw new BadRequestException(
        `Unknown product "${productId}". Assignable products are ${Object.values(PRODUCTS)
          .filter((p) => p.id !== 'NONE' && p.id !== 'INSTITUTIONAL')
          .map((p) => p.id)
          .join(', ')}.`,
      );
    }
    const def = PRODUCTS[productId];

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, planStatus: true, planRenewsAt: true, maxStudents: true, planSource: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Institutional access is granted by a school, not bought. Overwriting it
    // with a consumer product label would misreport a free family as a paying
    // one and put them back in reach of billing copy they were promised they
    // would never see.
    if (user.planSource === 'INSTITUTIONAL') {
      throw new BadRequestException(
        'This account’s access comes from a school or partner programme, not a purchase. Change it there, not here.',
      );
    }

    const seatsChangedFrom =
      def.seats !== null && user.maxStudents !== def.seats ? user.maxStudents : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: def.name,
        ...(def.seats !== null ? { maxStudents: def.seats } : {}),
      },
    });

    const warning = isPlanActive(user.planStatus, user.planRenewsAt)
      ? null
      : 'Recorded, but this account has no active plan — the product name alone does not grant access.';

    return {
      id: userId,
      product: toProductRef(def),
      seats: def.seats,
      seatsChangedFrom,
      warning,
    };
  }

  /**
   * The product for one account, as that family sees it — for the ribbon.
   *
   * A scholar has no plan of their own; theirs comes from the parent paying for
   * them, exactly as `EntitlementService` decides access. Returns the full
   * definition, `includes` and all, because the ribbon opens onto it and a
   * family reading what they are owed should not need a second call.
   */
  async getProductForUser(userId: string): Promise<{
    product: ProductDefinition & { includes: string[] };
    source: 'own' | 'parent' | 'none';
    coveredBy: string | null;
    comparison: {
      products: { id: ProductId; name: string; price: string | null }[];
      rows: { key: string; label: string; has: Record<string, boolean> }[];
    };
  }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, plan: true, planStatus: true, planRenewsAt: true, planSource: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const family = (await loadFamilyLinks(this.prisma, [userId])).get(userId) ?? {
      parents: [],
      children: [],
    };
    const plan = resolvePlan(user, family);

    const paid = isPlanActive(user.planStatus, user.planRenewsAt);
    const fromParent = plan.source === 'parent' && plan.via;
    const def = fromParent
      ? productFor(plan.via!.plan, null, true)
      : productFor(user.plan, user.planSource, paid, user.role);

    // The comparison table behind the ribbon. Always the publicly purchasable
    // products, plus this family's own if it is not one of them — so a Legacy
    // or Fellows household sees their own column, while nobody else is shown an
    // invitation-only rate they cannot buy.
    const ids: ProductId[] = [...COMPARABLE_PRODUCT_IDS];
    // Staff and free accounts add no column: one has no product to compare,
    // the other is looking at what they could buy.
    if (def.id !== 'NONE' && def.id !== 'STAFF' && !ids.includes(def.id)) ids.push(def.id);

    return {
      product: { ...def, includes: includesFor(def.id) },
      source:
        fromParent
          ? 'parent'
          : paid || user.planSource === 'INSTITUTIONAL' || def.id === 'STAFF'
            ? 'own'
            : 'none',
      coveredBy: fromParent ? plan.via!.name : null,
      comparison: {
        products: ids.map((id) => ({
          id,
          name: PRODUCTS[id].name,
          price: PRODUCTS[id].price,
        })),
        rows: comparisonMatrix(ids),
      },
    };
  }

  async getOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      organizations: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        memberCount: organization._count.memberships,
        createdAt: organization.createdAt,
      })),
      total: organizations.length,
    };
  }

  async getHealth() {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      database,
      redis,
      aiProviders: {
        openai: { configured: Boolean(this.config.get<string>('ai.openaiKey')?.trim()) },
        gemini: { configured: Boolean(this.config.get<string>('ai.googleKey')?.trim()) },
        claude: { configured: Boolean(this.config.get<string>('ai.anthropicKey')?.trim()) },
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getMetrics() {
    const [
      submissionsTotal,
      draftSubmissions,
      submittedSubmissions,
      underReviewSubmissions,
      gradedSubmissions,
      returnedSubmissions,
      notificationsTotal,
      unreadNotifications,
      tutorSessionsTotal,
      activeTutorSessions,
      pacingRecommendationsTotal,
      dismissedPacingRecommendations,
      masteryScoresTotal,
      masteryScoresBelowThreshold,
    ] = await this.prisma.$transaction([
      this.prisma.submission.count(),
      this.prisma.submission.count({ where: { status: SubmissionStatus.DRAFT } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.SUBMITTED } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.UNDER_REVIEW } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.GRADED } }),
      this.prisma.submission.count({ where: { status: SubmissionStatus.RETURNED } }),
      this.prisma.notification.count({ where: { deletedAt: null } }),
      this.prisma.notification.count({ where: { readAt: null, deletedAt: null } }),
      this.prisma.tutorSession.count(),
      this.prisma.tutorSession.count({ where: { status: TutorSessionStatus.ACTIVE } }),
      this.prisma.pacingRecommendation.count(),
      this.prisma.pacingRecommendation.count({ where: { dismissed: true } }),
      this.prisma.masteryScore.count(),
      this.prisma.masteryScore.count({ where: { score: { lt: 0.6 } } }),
    ]);

    return {
      submissions: {
        total: submissionsTotal,
        byStatus: {
          DRAFT: draftSubmissions,
          SUBMITTED: submittedSubmissions,
          UNDER_REVIEW: underReviewSubmissions,
          GRADED: gradedSubmissions,
          RETURNED: returnedSubmissions,
        },
      },
      notifications: {
        total: notificationsTotal,
        unread: unreadNotifications,
      },
      tutorSessions: {
        total: tutorSessionsTotal,
        active: activeTutorSessions,
      },
      pacingRecommendations: {
        total: pacingRecommendationsTotal,
        dismissed: dismissedPacingRecommendations,
      },
      masteryScores: {
        total: masteryScoresTotal,
        belowThreshold: masteryScoresBelowThreshold,
      },
    };
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error'; latencyMs: number }> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch {
      return { status: 'error', latencyMs: -1 };
    }
  }

  private async checkRedis(): Promise<{ status: 'ok' | 'error' | 'unconfigured' }> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return { status: 'unconfigured' };

    let client: Redis | undefined;
    try {
      client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
      await client.connect();
      await client.ping();
      return { status: 'ok' };
    } catch {
      return { status: 'error' };
    } finally {
      client?.disconnect();
    }
  }
}
