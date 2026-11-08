import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanSource, Role, TutorMessageRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService, AuthTokens } from '@modules/auth/auth.service';
import { fillMissingGrades, normalizeGrade } from '@common/grade/grade';
import { PrismaService } from '../../prisma/prisma.service';
import {
  displayName,
  endOfSchoolDayMs,
  hashBackup,
  hashBadge,
  isPlausibleBadge,
  hashPersonal,
  newBadgeSecret,
  newPersonalCode,
  newClassCode,
  normalizeCode,
  parseStudentName,
  sameHash,
} from './class-pass.codes';

export type ClassPassCaller = { userId: string; role: Role | string };

/** Accounts made by Class Pass have no real email; this domain can never receive mail. */
export const CLASS_PASS_EMAIL_DOMAIN = 'classpass.edkairos.invalid';

const FAIL_WINDOW_MS = 10 * 60 * 1000;
/** Wrong codes allowed per network per 10 min (a whole school shares one network). */
const MAX_FAILS_PER_IP = 60;
/** Wrong class-code+code tries per class per 10 min. */
const MAX_FAILS_PER_CLASS = 20;
const MAX_NAMES_PER_CALL = 200;
const DEFAULT_CLASS_PASS_CAP = 150;
const DEFAULT_ACCESS_ENDS = '2027-06-30';

/** One generic message for every wrong-code case, so codes cannot be probed. */
const WRONG_CODE = 'That code did not work. Check it and try again, or ask your teacher.';
const BAD_BADGE = 'This badge is not active. Ask your teacher for a new one.';

export interface IssuedBadge {
  studentId: string;
  name: string;
  displayName: string;
  /** Path the QR encodes, e.g. /go/ABCD… (the frontend adds its own origin). */
  badgePath: string;
  /** Same value as personalCode (kept for printouts made before 8 Nov). */
  backupCode: string;
  /** 8 characters, XXXX-XXXX: typed alone at /class. */
  personalCode: string;
}

export interface ClassPassStudentRow {
  studentId: string;
  name: string;
  displayName: string;
  hasPass: boolean;
  revoked: boolean;
  issuedAt: Date | null;
  lastUsedAt: Date | null;
  locked: boolean;
  personalCode: boolean;
}

@Injectable()
export class ClassPassService {
  private readonly logger = new Logger(ClassPassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  // ── Teacher side ──────────────────────────────────────────────────────────

  /** The class owner, or an org/super admin. Returns the classroom + its org. */
  private async ownedClassroom(classroomId: string, caller: ClassPassCaller) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      select: {
        id: true,
        name: true,
        teacherId: true,
        organizationId: true,
        classPassCode: true,
        classPassOn: true,
        gradeLevel: true,
      },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    const isAdmin = caller.role === Role.ORG_ADMIN || caller.role === Role.SUPER_ADMIN;
    if (classroom.teacherId !== caller.userId && !isAdmin) {
      throw new ForbiddenException('You do not have access to this classroom');
    }
    return classroom;
  }

  /**
   * Class Pass gives every student unlimited help, which costs real money, so a
   * school must be approved first — the same super-admin switch that unlocks
   * roster uploads (`Organization.rosterEnabled`). A super-admin can always.
   */
  private async assertSchoolApproved(organizationId: string, caller: ClassPassCaller) {
    if (caller.role === Role.SUPER_ADMIN) return;
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { rosterEnabled: true },
    });
    if (!org?.rosterEnabled) {
      throw new ForbiddenException(
        'This school is not yet approved for Class Pass. Ask an EdKairos admin to enable it.',
      );
    }
  }

  async status(classroomId: string, caller: ClassPassCaller) {
    const classroom = await this.ownedClassroom(classroomId, caller);
    const [enrollments, passes] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { classroomId },
        select: {
          studentId: true,
          student: {
            select: { email: true, deletedAt: true, profile: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
      this.prisma.classPass.findMany({ where: { classroomId } }),
    ]);
    const byStudent = new Map(passes.map((p) => [p.studentId, p]));
    const now = Date.now();
    const students: ClassPassStudentRow[] = enrollments
      .filter((e) => !e.student.deletedAt)
      .map((e) => {
        const p = byStudent.get(e.studentId);
        const first = e.student.profile?.firstName ?? '';
        const last = e.student.profile?.lastName ?? '';
        return {
          studentId: e.studentId,
          name: `${first} ${last}`.trim() || e.student.email,
          displayName: displayName(first, last),
          hasPass: !!p && !p.revokedAt,
          revoked: !!p?.revokedAt,
          issuedAt: p?.issuedAt ?? null,
          lastUsedAt: p?.lastUsedAt ?? null,
          locked: !!p?.lockedUntil && p.lockedUntil.getTime() > now,
          /** True once this student's page carries an 8-character personal code. */
          personalCode: !!p && !p.revokedAt && !!p.codeHash,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      classroomId,
      classroomName: classroom.name,
      gradeLevel: classroom.gradeLevel,
      on: classroom.classPassOn,
      classCode: classroom.classPassCode,
      students,
    };
  }

  /** Turn Class Pass on (creating the class code the first time) or off. */
  async setOn(classroomId: string, caller: ClassPassCaller, on: boolean) {
    const classroom = await this.ownedClassroom(classroomId, caller);
    if (on) await this.assertSchoolApproved(classroom.organizationId, caller);
    const classPassCode = classroom.classPassCode ?? (await this.uniqueClassCode());
    await this.prisma.classroom.update({
      where: { id: classroomId },
      data: { classPassOn: on, classPassCode },
    });
    return this.status(classroomId, caller);
  }

  /** New class code (e.g. it was posted somewhere public). Badges are unaffected. */
  async rotateClassCode(classroomId: string, caller: ClassPassCaller) {
    await this.ownedClassroom(classroomId, caller);
    await this.prisma.classroom.update({
      where: { id: classroomId },
      data: { classPassCode: await this.uniqueClassCode() },
    });
    return this.status(classroomId, caller);
  }

  private async uniqueClassCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = newClassCode();
      const taken = await this.prisma.classroom.findUnique({
        where: { classPassCode: code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('Could not allocate a class code');
  }

  /**
   * Add students by name only: no email, no password. Each becomes a STUDENT
   * account in the class's school, enrolled in this class, with institutional
   * access (no prices, no free-tier meter) until CLASS_PASS_ACCESS_ENDS.
   * A name already in this class is skipped, never duplicated.
   */
  async addStudents(
    classroomId: string,
    caller: ClassPassCaller,
    names: string[],
    grade?: string,
  ) {
    const classroom = await this.ownedClassroom(classroomId, caller);
    await this.assertSchoolApproved(classroom.organizationId, caller);
    if (!Array.isArray(names) || names.length === 0) {
      throw new BadRequestException('Add at least one name.');
    }
    if (names.length > MAX_NAMES_PER_CALL) {
      throw new BadRequestException(`Add up to ${MAX_NAMES_PER_CALL} names at a time.`);
    }
    // Every student gets a grade: the one chosen, else the class's. With
    // neither, refuse, so a missed dropdown can't leave a class without grades.
    const chosen = normalizeGrade(grade);
    const studentGrade = chosen ?? normalizeGrade(classroom.gradeLevel);
    if (!studentGrade) {
      throw new BadRequestException('Choose the grade for this class first.');
    }
    if (chosen && !normalizeGrade(classroom.gradeLevel)) {
      await this.prisma.classroom.update({ where: { id: classroomId }, data: { gradeLevel: chosen } });
    }

    const [teacher, org, existingInTeacherClasses, inThisClass] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: classroom.teacherId }, select: { maxStudents: true } }),
      this.prisma.organization.findUnique({
        where: { id: classroom.organizationId },
        select: { perTeacherCap: true },
      }),
      this.prisma.enrollment.findMany({
        where: { classroom: { teacherId: classroom.teacherId, deletedAt: null } },
        select: { studentId: true },
        distinct: ['studentId'],
      }),
      this.prisma.enrollment.findMany({
        where: { classroomId },
        select: { student: { select: { profile: { select: { firstName: true, lastName: true } } } } },
      }),
    ]);
    const envCap = Number(this.config.get<string>('CLASS_PASS_MAX_STUDENTS_PER_TEACHER'));
    const cap =
      teacher?.maxStudents ?? org?.perTeacherCap ?? (Number.isFinite(envCap) && envCap > 0 ? envCap : DEFAULT_CLASS_PASS_CAP);
    let total = existingInTeacherClasses.length;

    const key = (f: string, l: string) => `${f.toLowerCase()}|${l.toLowerCase()}`;
    const seen = new Set(
      inThisClass.map((e) => key(e.student.profile?.firstName ?? '', e.student.profile?.lastName ?? '')),
    );

    const accessEnds = this.accessEndsAt();
    const added: { studentId: string; name: string }[] = [];
    const skipped: { name: string; reason: string }[] = [];

    for (const raw of names) {
      const parsed = parseStudentName(String(raw ?? ''));
      if (!parsed) continue;
      const name = `${parsed.firstName} ${parsed.lastName}`.trim();
      if (parsed.firstName.length > 60 || parsed.lastName.length > 60) {
        skipped.push({ name: name.slice(0, 60), reason: 'name too long' });
        continue;
      }
      const k = key(parsed.firstName, parsed.lastName);
      if (seen.has(k)) {
        skipped.push({ name, reason: 'already in this class' });
        continue;
      }
      if (total >= cap) {
        skipped.push({ name, reason: `student limit reached (${cap})` });
        continue;
      }
      const passwordHash = await bcrypt.hash(randomBytes(24).toString('hex'), 10);
      const student = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: `cp.${randomUUID()}@${CLASS_PASS_EMAIL_DOMAIN}`,
            passwordHash,
            role: Role.STUDENT,
            planSource: PlanSource.INSTITUTIONAL,
            planStatus: 'active',
            planRenewsAt: accessEnds,
            profile: {
              create: {
                firstName: parsed.firstName,
                lastName: parsed.lastName,
                grade: studentGrade,
              },
            },
          },
          select: { id: true },
        });
        await tx.membership.create({
          data: { userId: u.id, organizationId: classroom.organizationId, role: Role.STUDENT },
        });
        await tx.enrollment.create({ data: { classroomId, studentId: u.id } });
        return u;
      });
      seen.add(k);
      total++;
      added.push({ studentId: student.id, name });
    }
    // Students already in the class without a grade (e.g. added before this rule) get it too.
    await fillMissingGrades(this.prisma, classroomId, normalizeGrade(classroom.gradeLevel) ?? studentGrade);
    this.logger.log(`[class-pass] classroom=${classroomId} added=${added.length} skipped=${skipped.length}`);
    return { added, skipped, cap, total };
  }

  private accessEndsAt(): Date {
    const raw = this.config.get<string>('CLASS_PASS_ACCESS_ENDS') ?? DEFAULT_ACCESS_ENDS;
    const d = new Date(`${raw}T23:59:59-05:00`);
    return Number.isNaN(d.getTime()) ? new Date(`${DEFAULT_ACCESS_ENDS}T23:59:59-05:00`) : d;
  }

  /**
   * Make (or re-make) badges. Returns the QR path and backup code IN PLAIN TEXT,
   * once — only hashes are stored, so this response is the only time they exist.
   * Re-issuing replaces the old badge: the old card stops working immediately.
   * `studentIds` empty/omitted = every enrolled student who has no active badge.
   */
  async issue(classroomId: string, caller: ClassPassCaller, studentIds?: string[]) {
    const classroom = await this.ownedClassroom(classroomId, caller);
    await this.assertSchoolApproved(classroom.organizationId, caller);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId, student: { deletedAt: null, role: Role.STUDENT } },
      select: {
        studentId: true,
        student: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    const passes = await this.prisma.classPass.findMany({
      where: { classroomId },
      select: { studentId: true, revokedAt: true },
    });
    const active = new Set(passes.filter((p) => !p.revokedAt).map((p) => p.studentId));
    const wanted = studentIds && studentIds.length > 0 ? new Set(studentIds) : null;
    const targets = enrollments.filter((e) => (wanted ? wanted.has(e.studentId) : !active.has(e.studentId)));
    if (wanted && targets.length !== wanted.size) {
      throw new BadRequestException('Some of those students are not in this class.');
    }

    const issued: IssuedBadge[] = [];
    for (const e of targets) {
      const secret = newBadgeSecret();
      // One personal code per student. It works typed alone (codeHash, unique
      // across the platform) and with a class code (backupHash), so nothing a
      // student types ever needs a name list.
      const personal = await this.uniquePersonalCode();
      const data = {
        badgeHash: hashBadge(secret),
        backupHash: hashBackup(e.studentId, personal),
        codeHash: hashPersonal(personal),
        failedAttempts: 0,
        lockedUntil: null,
        revokedAt: null,
        issuedAt: new Date(),
      };
      await this.prisma.classPass.upsert({
        where: { classroomId_studentId: { classroomId, studentId: e.studentId } },
        create: { classroomId, studentId: e.studentId, ...data },
        update: data,
      });
      const first = e.student.profile?.firstName ?? '';
      const last = e.student.profile?.lastName ?? '';
      issued.push({
        studentId: e.studentId,
        name: `${first} ${last}`.trim(),
        displayName: displayName(first, last),
        badgePath: `/go/${secret}`,
        backupCode: personal,
        personalCode: personal,
      });
    }
    issued.sort((a, b) => a.name.localeCompare(b.name));
    this.logger.log(`[class-pass] classroom=${classroomId} issued=${issued.length}`);
    return { classroomName: classroom.name, classCode: classroom.classPassCode, issued };
  }

  private async uniquePersonalCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = newPersonalCode();
      const taken = await this.prisma.classPass.findUnique({ where: { codeHash: hashPersonal(code) }, select: { id: true } });
      if (!taken) return code;
    }
    throw new Error('Could not allocate a personal code');
  }

  /** Stop one student's badge and backup code at once (lost card). */
  async revoke(classroomId: string, caller: ClassPassCaller, studentId: string) {
    await this.ownedClassroom(classroomId, caller);
    await this.prisma.classPass.updateMany({
      where: { classroomId, studentId },
      data: { revokedAt: new Date() },
    });
    return this.status(classroomId, caller);
  }

  /** Clear a lockout after too many wrong backup codes. */
  async unlock(classroomId: string, caller: ClassPassCaller, studentId: string) {
    await this.ownedClassroom(classroomId, caller);
    await this.prisma.classPass.updateMany({
      where: { classroomId, studentId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    return this.status(classroomId, caller);
  }

  /**
   * "Where students got stuck": every help conversation this class's students
   * started in the last `days` days, newest first, with the student's own
   * questions (not the coach's replies) so the teacher can scan them quickly.
   */
  async helpActivity(classroomId: string, caller: ClassPassCaller, days = 14) {
    await this.ownedClassroom(classroomId, caller);
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 60) * 86_400_000);
    const enrolled = await this.prisma.enrollment.findMany({
      where: { classroomId },
      select: {
        studentId: true,
        student: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    const names = new Map(
      enrolled.map((e) => [
        e.studentId,
        `${e.student.profile?.firstName ?? ''} ${e.student.profile?.lastName ?? ''}`.trim() || 'Student',
      ]),
    );
    if (names.size === 0) return { since, byAssignment: [], sessions: [] };

    const sessions = await this.prisma.tutorSession.findMany({
      where: { studentId: { in: [...names.keys()] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        studentId: true,
        assignmentId: true,
        createdAt: true,
        messages: {
          where: { role: TutorMessageRole.STUDENT },
          orderBy: { createdAt: 'asc' },
          select: { content: true, createdAt: true },
        },
      },
    });
    const withQuestions = sessions.filter((s) => s.messages.length > 0);
    const assignmentIds = [...new Set(withQuestions.map((s) => s.assignmentId).filter((x): x is string => !!x))];
    const assignments = assignmentIds.length
      ? await this.prisma.assignment.findMany({
          where: { id: { in: assignmentIds } },
          select: { id: true, title: true },
        })
      : [];
    const titles = new Map(assignments.map((a) => [a.id, a.title]));

    const counts = new Map<string, { assignmentId: string | null; title: string; students: Set<string>; questions: number }>();
    for (const s of withQuestions) {
      const k = s.assignmentId ?? 'none';
      const row = counts.get(k) ?? {
        assignmentId: s.assignmentId,
        title: s.assignmentId ? titles.get(s.assignmentId) ?? 'Assignment' : 'General help',
        students: new Set<string>(),
        questions: 0,
      };
      row.students.add(s.studentId);
      row.questions += s.messages.length;
      counts.set(k, row);
    }
    return {
      since,
      byAssignment: [...counts.values()]
        .map((r) => ({ assignmentId: r.assignmentId, title: r.title, students: r.students.size, questions: r.questions }))
        .sort((a, b) => b.questions - a.questions),
      sessions: withQuestions.map((s) => ({
        id: s.id,
        studentId: s.studentId,
        studentName: names.get(s.studentId) ?? 'Student',
        assignmentId: s.assignmentId,
        assignmentTitle: s.assignmentId ? titles.get(s.assignmentId) ?? 'Assignment' : null,
        startedAt: s.createdAt,
        questions: s.messages.map((m) => m.content.slice(0, 500)),
      })),
    };
  }

  // ── Student side (public endpoints) ───────────────────────────────────────

  /** The QR badge: the secret alone proves who the student is. */
  async signInWithBadge(secret: string): Promise<AuthTokens & { classroomId: string }> {
    if (!isPlausibleBadge(secret)) throw new UnauthorizedException(BAD_BADGE);
    const pass = await this.prisma.classPass.findUnique({
      where: { badgeHash: hashBadge(secret) },
      select: {
        id: true,
        studentId: true,
        classroomId: true,
        revokedAt: true,
        classroom: { select: { classPassOn: true, deletedAt: true } },
      },
    });
    if (!pass || pass.revokedAt || !pass.classroom.classPassOn || pass.classroom.deletedAt) {
      throw new UnauthorizedException(BAD_BADGE);
    }
    await this.assertStillEnrolled(pass.classroomId, pass.studentId, BAD_BADGE);
    const tokens = await this.auth.issueSessionFor(pass.studentId, endOfSchoolDayMs());
    await this.prisma.classPass.update({ where: { id: pass.id }, data: { lastUsedAt: new Date() } });
    return { ...tokens, classroomId: pass.classroomId };
  }

  /**
   * The personal code typed alone at /class: like a bank card, it opens one
   * account and nothing else. No name list, no class code. Guessing is blocked
   * by ~40 bits per code plus a per-network limit on wrong tries.
   */
  async signInWithPersonalCode(code: string, ip: string): Promise<AuthTokens & { classroomId: string }> {
    this.assertNotThrottled(`ip:${ip}`, MAX_FAILS_PER_IP);
    const n = normalizeCode(code);
    const pass = n.length === 8
      ? await this.prisma.classPass.findUnique({
          where: { codeHash: hashPersonal(n) },
          select: { id: true, studentId: true, classroomId: true, revokedAt: true, classroom: { select: { classPassOn: true, deletedAt: true } } },
        })
      : null;
    if (!pass || pass.revokedAt || !pass.classroom.classPassOn || pass.classroom.deletedAt) {
      this.noteFailure(`ip:${ip}`);
      throw new UnauthorizedException(WRONG_CODE);
    }
    await this.assertStillEnrolled(pass.classroomId, pass.studentId, WRONG_CODE);
    const tokens = await this.auth.issueSessionFor(pass.studentId, endOfSchoolDayMs());
    await this.prisma.classPass.update({ where: { id: pass.id }, data: { lastUsedAt: new Date(), failedAttempts: 0, lockedUntil: null } });
    return { ...tokens, classroomId: pass.classroomId };
  }

  /**
   * For pages printed before personal codes (class code + 6-character code):
   * the student types both; the server finds the match itself. No names shown.
   */
  async signInWithClassAndCode(classCode: string, code: string, ip: string): Promise<AuthTokens & { classroomId: string }> {
    this.assertNotThrottled(`ip:${ip}`, MAX_FAILS_PER_IP);
    const cc = normalizeCode(classCode);
    const classroom = cc.length === 6
      ? await this.prisma.classroom.findFirst({ where: { classPassCode: cc, classPassOn: true, deletedAt: null }, select: { id: true } })
      : null;
    if (classroom) this.assertNotThrottled(`class:${classroom.id}`, MAX_FAILS_PER_CLASS);
    const passes = classroom
      ? await this.prisma.classPass.findMany({ where: { classroomId: classroom.id, revokedAt: null }, select: { id: true, studentId: true, backupHash: true } })
      : [];
    const match = passes.find((p) => sameHash(hashBackup(p.studentId, code ?? ''), p.backupHash));
    if (!classroom || !match) {
      this.noteFailure(`ip:${ip}`);
      if (classroom) this.noteFailure(`class:${classroom.id}`);
      throw new UnauthorizedException(WRONG_CODE);
    }
    await this.assertStillEnrolled(classroom.id, match.studentId, WRONG_CODE);
    const tokens = await this.auth.issueSessionFor(match.studentId, endOfSchoolDayMs());
    await this.prisma.classPass.update({ where: { id: match.id }, data: { lastUsedAt: new Date(), failedAttempts: 0, lockedUntil: null } });
    return { ...tokens, classroomId: classroom.id };
  }

  // Wrong-code throttle: per network (a school shares one) and per class.
  private readonly failures = new Map<string, number[]>();
  private noteFailure(key: string) {
    const now = Date.now();
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    list.push(now);
    this.failures.set(key, list);
    if (this.failures.size > 10_000) this.failures.clear();
  }
  private assertNotThrottled(key: string, max: number) {
    const now = Date.now();
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < FAIL_WINDOW_MS);
    if (recent.length >= max) {
      throw new HttpException('Too many wrong codes. Wait 10 minutes, or scan the QR code on your page.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async assertStillEnrolled(classroomId: string, studentId: string, message: string) {
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { classroomId_studentId: { classroomId, studentId } },
      select: { id: true, student: { select: { role: true, deletedAt: true } } },
    });
    if (!enrolled || enrolled.student.deletedAt || enrolled.student.role !== Role.STUDENT) {
      throw new UnauthorizedException(message);
    }
  }
}
