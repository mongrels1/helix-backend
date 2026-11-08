import { BadRequestException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClassroomStaffRole, Prisma, Role } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { assertClassroomAccess, type AccessCaller } from '@common/classroom-access/classroom-access';
import { isDistrictStaffEmail, teacherSignupDomains } from '@common/teacher/teacher-signup';
import { EmailService } from '@modules/email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { ShareRole } from './dto/sharing.dto';

const INVITE_DAYS = 7;
const hashToken = (t: string) => createHash('sha256').update(`invite:${t}`).digest('hex');
const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}`.trim() : '');
type Grant = { classroomId: string; role: ShareRole };

/**
 * Sharing a class with other teachers. The owner (or a school admin) invites a
 * colleague by their district email; the emailed link works only when opened
 * while signed in with that same district address. Who may then do what in the
 * class is decided by common/classroom-access, not here.
 */
@Injectable()
export class ClassroomSharingService {
  private readonly logger = new Logger(ClassroomSharingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private async manageable(classroomId: string, caller: AccessCaller) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      select: { id: true, name: true, teacherId: true, organizationId: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    await assertClassroomAccess(this.prisma, classroom, caller, 'manage');
    return classroom;
  }

  /** Who this class is shared with, and invitations not yet accepted. */
  async list(classroomId: string, caller: AccessCaller) {
    const classroom = await this.manageable(classroomId, caller);
    const [staff, invites] = await Promise.all([
      this.prisma.classroomStaff.findMany({
        where: { classroomId },
        select: { userId: true, role: true, createdAt: true, user: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.classroomInvite.findMany({
        where: { organizationId: classroom.organizationId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, grants: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      domains: teacherSignupDomains(),
      staff: staff.map((s) => ({ userId: s.userId, name: fullName(s.user.profile) || s.user.email, email: s.user.email, role: s.role, since: s.createdAt })),
      invites: invites
        .map((i) => ({ ...i, grant: (i.grants as Grant[]).find((g) => g.classroomId === classroomId) }))
        .filter((i) => i.grant)
        .map((i) => ({ id: i.id, email: i.email, role: i.grant!.role, expiresAt: i.expiresAt, sentAt: i.createdAt })),
    };
  }

  /** Invite a colleague to one or more classes. Returns the link once, for copying. */
  async invite(caller: AccessCaller, email: string, role: ShareRole, classroomIds: string[]) {
    const address = email.trim().toLowerCase();
    if (!isDistrictStaffEmail(address)) {
      throw new BadRequestException(`Classes can only be shared with a district staff email (@${teacherSignupDomains().join(', @')}).`);
    }
    const ids = [...new Set(classroomIds)];
    const classes = [];
    for (const id of ids) classes.push(await this.manageable(id, caller));
    const orgs = new Set(classes.map((c) => c.organizationId));
    if (orgs.size !== 1) throw new BadRequestException('Share classes from one school at a time.');
    const existing = await this.prisma.user.findUnique({ where: { email: address }, select: { id: true, role: true } });
    if (existing && classes.some((c) => c.teacherId === existing.id)) {
      throw new BadRequestException('That teacher already owns one of these classes.');
    }
    if (existing && existing.role !== Role.TEACHER && existing.role !== Role.ORG_ADMIN) {
      throw new BadRequestException('That address belongs to an account that is not a teacher account.');
    }

    const token = randomBytes(24).toString('base64url');
    const grants: Grant[] = classes.map((c) => ({ classroomId: c.id, role }));
    // A newer invite for the same person replaces older pending ones for these classes.
    const pending = await this.prisma.classroomInvite.findMany({
      where: { email: address, acceptedAt: null, revokedAt: null },
      select: { id: true, grants: true },
    });
    const replaced = pending.filter((p) => (p.grants as Grant[]).some((g) => ids.includes(g.classroomId))).map((p) => p.id);
    if (replaced.length) await this.prisma.classroomInvite.updateMany({ where: { id: { in: replaced } }, data: { revokedAt: new Date() } });

    const invite = await this.prisma.classroomInvite.create({
      data: {
        organizationId: classes[0].organizationId,
        email: address,
        grants: grants as unknown as Prisma.InputJsonValue,
        tokenHash: hashToken(token),
        invitedById: caller.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      },
      select: { id: true, expiresAt: true },
    });

    const inviter = await this.prisma.user.findUnique({ where: { id: caller.userId }, select: { email: true, profile: { select: { firstName: true, lastName: true } } } });
    const inviterName = fullName(inviter?.profile) || inviter?.email || 'A colleague';
    const link = `${(this.config.get<string>('app.frontendUrl') ?? 'http://localhost:3000').replace(/\/$/, '')}/join-class/${token}`;
    const what = role === 'CO_TEACHER' ? 'co-teach' : 'view (read-only)';
    const names = classes.map((c) => c.name).join(', ');
    await this.email.sendClassInvite(address, {
      subject: `${inviterName} shared ${classes.length === 1 ? 'a class' : `${classes.length} classes`} with you on EdKairos`,
      inviterName,
      classNames: names,
      what,
      link,
      days: INVITE_DAYS,
    });
    this.logger.log(`[sharing] invite=${invite.id} classes=${ids.length} role=${role}`);
    return { id: invite.id, email: address, role, classes: classes.map((c) => ({ id: c.id, name: c.name })), expiresAt: invite.expiresAt, link };
  }

  async cancelInvite(caller: AccessCaller, inviteId: string) {
    const inv = await this.prisma.classroomInvite.findUnique({ where: { id: inviteId }, select: { id: true, grants: true, invitedById: true, acceptedAt: true } });
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.invitedById !== caller.userId) {
      for (const g of inv.grants as Grant[]) await this.manageable(g.classroomId, caller);
    }
    await this.prisma.classroomInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    return { cancelled: true };
  }

  async setRole(caller: AccessCaller, classroomId: string, userId: string, role: ShareRole) {
    await this.manageable(classroomId, caller);
    const row = await this.prisma.classroomStaff.findUnique({ where: { classroomId_userId: { classroomId, userId } }, select: { id: true } });
    if (!row) throw new NotFoundException('That teacher is not on this class.');
    await this.prisma.classroomStaff.update({ where: { id: row.id }, data: { role: role as ClassroomStaffRole } });
    return this.list(classroomId, caller);
  }

  /** The owner removes a teacher, or a teacher leaves a class shared with them. */
  async remove(caller: AccessCaller, classroomId: string, userId: string) {
    if (caller.userId !== userId) await this.manageable(classroomId, caller);
    await this.prisma.classroomStaff.deleteMany({ where: { classroomId, userId } });
    return { removed: true };
  }

  private async findInvite(token: string) {
    const inv = await this.prisma.classroomInvite.findUnique({ where: { tokenHash: hashToken(token ?? '') } });
    if (!inv) throw new NotFoundException('This invitation link is not valid.');
    if (inv.revokedAt) throw new GoneException('This invitation was cancelled. Ask for a new one.');
    if (inv.acceptedAt) throw new GoneException('This invitation has already been used.');
    if (inv.expiresAt <= new Date()) throw new GoneException('This invitation has expired. Ask for a new one.');
    return inv;
  }

  /** What the invite is for, shown before accepting. Never reveals student data. */
  async preview(caller: AccessCaller & { email?: string }, token: string) {
    const inv = await this.findInvite(token);
    const grants = inv.grants as Grant[];
    const [classes, inviter, me] = await Promise.all([
      this.prisma.classroom.findMany({ where: { id: { in: grants.map((g) => g.classroomId) }, deletedAt: null }, select: { id: true, name: true, organization: { select: { name: true } } } }),
      this.prisma.user.findUnique({ where: { id: inv.invitedById }, select: { email: true, profile: { select: { firstName: true, lastName: true } } } }),
      this.prisma.user.findUnique({ where: { id: caller.userId }, select: { email: true } }),
    ]);
    return {
      invitedEmail: inv.email,
      signedInAs: me?.email ?? null,
      emailMatches: (me?.email ?? '').toLowerCase() === inv.email,
      invitedBy: fullName(inviter?.profile) || inviter?.email || 'A colleague',
      school: classes[0]?.organization.name ?? null,
      role: grants[0]?.role ?? 'VIEWER',
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      expiresAt: inv.expiresAt,
    };
  }

  async accept(caller: AccessCaller, token: string) {
    const inv = await this.findInvite(token);
    const me = await this.prisma.user.findUnique({ where: { id: caller.userId }, select: { id: true, email: true, role: true, deletedAt: true } });
    if (!me || me.deletedAt) throw new ForbiddenException('Sign in first.');
    if (me.email.toLowerCase() !== inv.email) {
      throw new ForbiddenException(`This invitation is for ${inv.email}. Sign in with that district account to accept it.`);
    }
    if (!isDistrictStaffEmail(me.email)) throw new ForbiddenException('Only district staff accounts can accept a shared class.');
    if (me.role !== Role.TEACHER && me.role !== Role.ORG_ADMIN) {
      throw new ForbiddenException('Only a teacher account can accept a shared class.');
    }
    const grants = inv.grants as Grant[];
    const live = await this.prisma.classroom.findMany({
      where: { id: { in: grants.map((g) => g.classroomId) }, deletedAt: null },
      select: { id: true, name: true, teacherId: true },
    });
    await this.prisma.$transaction([
      ...live
        .filter((c) => c.teacherId !== me.id)
        .map((c) => {
          const role = grants.find((g) => g.classroomId === c.id)!.role as ClassroomStaffRole;
          return this.prisma.classroomStaff.upsert({
            where: { classroomId_userId: { classroomId: c.id, userId: me.id } },
            create: { classroomId: c.id, userId: me.id, role, addedById: inv.invitedById },
            update: { role },
          });
        }),
      this.prisma.classroomInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedById: me.id } }),
    ]);
    return { classes: live.map((c) => ({ id: c.id, name: c.name })) };
  }
}
