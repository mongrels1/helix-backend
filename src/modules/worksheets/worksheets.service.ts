import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIRouterService } from '../../intelligence/ai-router/ai-router.service';
import {
  accessibleClassroomWhere,
  classroomAccessLevel,
  levelAllows,
  loadClassroomWithAccess,
} from '@common/classroom-access/classroom-access';
import {
  Letter,
  MAX_TOTAL_PAGE_BYTES,
  decodePageImage,
  isClosed,
  isLetter,
  itemAnalysis,
  normalizeAnswers,
  looksNotAD,
  normalizeQuestions,
  parseKeyText,
  studentResult,
  validateWorksheet,
} from './worksheet-logic';
import { WORKSHEET_DRAFT_SYSTEM, buildDraftPrompt, extractJsonObject } from './worksheet-prompt';
import { AssignWorksheetDto, CreateWorksheetDto, DraftWorksheetDto } from './dto/worksheet.dto';

export type Caller = { userId: string; role: Role | string };

const STAFF = new Set<string>([Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN]);

interface StoredAnswers {
  v: 1;
  answers: (Letter | null)[];
}

function readStoredAnswers(content: string | null | undefined, n: number): (Letter | null)[] {
  if (!content) return normalizeAnswers([], n);
  try {
    const parsed = JSON.parse(content) as Partial<StoredAnswers>;
    return normalizeAnswers(parsed?.answers, n);
  } catch {
    return normalizeAnswers([], n);
  }
}

@Injectable()
export class WorksheetsService {
  private readonly logger = new Logger(WorksheetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIRouterService,
    private readonly config: ConfigService,
  ) {}

  // ───────────────────────── Teacher: draft, save, assign ─────────────────────────

  /** One AI read of the upload → a draft for the teacher's check screen. Never shown to students. */
  async draft(dto: DraftWorksheetDto) {
    const pages = dto.pageImages.map(decodePageImage);
    if (pages.some((p) => !p)) throw new BadRequestException('One of the pages could not be read as a picture. Try uploading the PDF again.');
    const keyPages = (dto.keyImages ?? []).map(decodePageImage);
    if (keyPages.some((p) => !p)) throw new BadRequestException('One of the key pages could not be read as a picture.');
    const typedKey = dto.typedKey ? parseKeyText(dto.typedKey) : [];

    const images = [...pages, ...keyPages].map((p) => ({ base64: p!.bytes.toString('base64'), mediaType: p!.mime }));
    let reply = '';
    try {
      reply = await this.ai.claudeVision({
        text: buildDraftPrompt({
          worksheetText: dto.worksheetText ?? '',
          keyText: dto.keyText,
          typedKey,
          pageCount: pages.length,
          keyPageCount: keyPages.length,
        }),
        images,
        systemPrompt: WORKSHEET_DRAFT_SYSTEM,
        maxTokens: 8000,
        timeoutMs: 110_000,
        model: this.config.get<string>('WORKSHEET_VISION_MODEL') || this.config.get<string>('pushMap.visionModel') || undefined,
      });
    } catch (err) {
      this.logger.warn(`worksheet draft failed: ${String(err)}`);
      throw new BadRequestException('The worksheet could not be read just now. Try again, or type the questions in by hand.');
    }

    const parsed = extractJsonObject<{ questions?: any[]; notes?: unknown[] }>(reply);
    const rawQuestions = Array.isArray(parsed?.questions) ? parsed!.questions : [];
    const questions = normalizeQuestions(rawQuestions);
    const aiKey = rawQuestions.map((q) => (typeof q?.key === 'string' ? q.key.trim().toUpperCase() : ''));
    const key = typedKey.length ? typedKey : aiKey;
    // Feedback is only ever for wrong letters; drop any the draft wrote for the key letter.
    questions.forEach((q, i) => {
      if (isLetter(key[i])) delete q.feedback[key[i] as Letter];
    });
    const notes = (Array.isArray(parsed?.notes) ? parsed!.notes : []).filter((x): x is string => typeof x === 'string').slice(0, 10);
    const ad = looksNotAD(questions);
    return {
      questions,
      key,
      keySource: typedKey.length ? 'typed' : keyPages.length || dto.keyText ? 'key file' : 'none',
      notes,
      /** True when this upload does not look like an A–D worksheet (shown as a banner). */
      notAD: ad.notAD,
      notADCount: ad.bad,
      problems: validateWorksheet(questions, key, pages.length),
    };
  }

  /** Save a teacher-confirmed worksheet. Everything is re-checked here; the browser is not trusted. */
  async create(caller: Caller, dto: CreateWorksheetDto) {
    const questions = normalizeQuestions(dto.questions);
    const key = dto.key.map((k) => String(k ?? '').trim().toUpperCase());
    questions.forEach((q, i) => {
      if (isLetter(key[i])) delete q.feedback[key[i] as Letter];
    });
    const pages = dto.pageImages.map(decodePageImage);
    if (pages.some((p) => !p)) throw new BadRequestException('One of the pages could not be read as a picture.');
    // Every question must say where it is on the worksheet (its picture on the student's screen).
    const problems = validateWorksheet(questions, key, pages.length);
    if (problems.length) throw new BadRequestException({ message: problems[0], problems });
    const total = pages.reduce((s, p) => s + p!.bytes.length, 0);
    if (total > MAX_TOTAL_PAGE_BYTES) throw new BadRequestException('The worksheet pictures are too large. Use a PDF with fewer pages.');

    const ws = await this.prisma.worksheet.create({
      data: {
        ownerId: caller.userId,
        title: dto.title.trim(),
        standard: dto.standard?.trim() || null,
        questionCount: questions.length,
        key,
        questions: questions as unknown as Prisma.InputJsonValue,
        pages: {
          create: pages.map((p, i) => ({ pageNo: i + 1, mime: p!.mime, data: new Uint8Array(p!.bytes), size: p!.bytes.length })),
        },
      },
      select: { id: true, title: true, questionCount: true },
    });
    return ws;
  }

  /** One action → one assignment per class, all sharing the stored worksheet. */
  async assign(caller: Caller, worksheetId: string, dto: AssignWorksheetDto) {
    const ws = await this.prisma.worksheet.findUnique({ where: { id: worksheetId }, select: { id: true, ownerId: true, title: true, standard: true, questionCount: true } });
    if (!ws) throw new NotFoundException('Worksheet not found');
    if (ws.ownerId !== caller.userId && caller.role !== Role.SUPER_ADMIN) throw new ForbiddenException('You can only assign your own worksheets');

    const dueAt = new Date(dto.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestException('Choose a due date.');
    if (dueAt.getTime() <= Date.now()) throw new BadRequestException('The due date must be in the future.');

    const classroomIds = [...new Set(dto.classroomIds)];
    for (const id of classroomIds) {
      await loadClassroomWithAccess(this.prisma as any, id, caller, 'teach', { id: true });
    }
    // Chosen students must each be enrolled in one of the chosen classes.
    const chosen = [...new Set(dto.studentIds ?? [])];
    const byClass = new Map<string, string[]>();
    if (chosen.length) {
      const enr = await this.prisma.enrollment.findMany({
        where: { classroomId: { in: classroomIds }, studentId: { in: chosen } },
        select: { classroomId: true, studentId: true },
      });
      const found = new Set(enr.map((e) => e.studentId));
      if (found.size !== chosen.length) throw new BadRequestException('One of the chosen students is not in the chosen classes.');
      for (const e of enr) byClass.set(e.classroomId, [...(byClass.get(e.classroomId) ?? []), e.studentId]);
    }

    const title = (dto.title ?? ws.title).trim();
    const created = await this.prisma.$transaction(
      classroomIds
        // With students chosen, a class none of them is in gets nothing.
        .filter((cid) => !chosen.length || byClass.has(cid))
        .map((cid) =>
          this.prisma.assignment.create({
            data: {
              title,
              description: dto.instructions?.trim() || null,
              standard: ws.standard,
              dueAt,
              maxScore: ws.questionCount,
              classroomId: cid,
              worksheetId: ws.id,
              targets: chosen.length ? { create: (byClass.get(cid) ?? []).map((studentId) => ({ studentId })) } : undefined,
            },
            select: { id: true, classroomId: true, title: true, dueAt: true },
          }),
        ),
    );
    return created;
  }

  // ───────────────────────── Who may see what ─────────────────────────

  private async loadAssignment(assignmentId: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null, worksheetId: { not: null } },
      select: {
        id: true,
        title: true,
        description: true,
        dueAt: true,
        classroomId: true,
        worksheetId: true,
        classroom: { select: { id: true, name: true, teacherId: true, organizationId: true, deletedAt: true } },
        targets: { select: { studentId: true } },
      },
    });
    if (!a || !a.worksheetId || a.classroom.deletedAt) throw new NotFoundException('Assignment not found');
    return a;
  }

  /** A student may open it if enrolled in the class and (when students were chosen) chosen. */
  private async assertStudentMay(a: Awaited<ReturnType<WorksheetsService['loadAssignment']>>, studentId: string) {
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { classroomId_studentId: { classroomId: a.classroomId, studentId } },
      select: { id: true },
    });
    const targeted = a.targets.length === 0 || a.targets.some((t) => t.studentId === studentId);
    if (!enrolled || !targeted) throw new ForbiddenException('That assignment is not one of yours');
  }

  private isStudent(caller: Caller) {
    return caller.role === Role.STUDENT;
  }

  private async worksheetFor(a: { worksheetId: string | null }) {
    const ws = await this.prisma.worksheet.findUnique({
      where: { id: a.worksheetId! },
      select: { id: true, title: true, questionCount: true, key: true, questions: true, pages: { select: { id: true, pageNo: true }, orderBy: { pageNo: 'asc' } } },
    });
    if (!ws) throw new NotFoundException('Worksheet not found');
    return { ...ws, questions: normalizeQuestions(ws.questions as unknown) };
  }

  // ───────────────────────── The answer sheet ─────────────────────────

  /**
   * The answer sheet. Students get questions and options, their saved answers,
   * and (once submitted) their result. The key leaves the server only after the
   * due date. Teachers with access see everything (preview).
   */
  async sheet(caller: Caller, assignmentId: string) {
    const a = await this.loadAssignment(assignmentId);
    const ws = await this.worksheetFor(a);
    const base = {
      assignmentId: a.id,
      title: a.title,
      instructions: a.description,
      className: a.classroom.name,
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      closed: isClosed(a.dueAt),
      questionCount: ws.questionCount,
      pages: ws.pages.map((p) => p.id),
      questions: ws.questions.map((q) => ({ n: q.n, stem: q.stem, options: q.options, crop: q.crop ?? null })),
    };

    if (this.isStudent(caller)) {
      await this.assertStudentMay(a, caller.userId);
      const sub = await this.prisma.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: a.id, studentId: caller.userId } },
        select: { status: true, content: true, submittedAt: true },
      });
      const answers = readStoredAnswers(sub?.content, ws.questionCount);
      const submitted = !!sub && sub.status !== SubmissionStatus.DRAFT;
      return {
        ...base,
        role: 'student' as const,
        answers,
        submitted,
        result: submitted
          ? studentResult({ answers, key: ws.key, questions: ws.questions, dueAt: a.dueAt, submittedAt: sub!.submittedAt })
          : null,
      };
    }

    if (!STAFF.has(String(caller.role))) throw new ForbiddenException();
    const level = await classroomAccessLevel(this.prisma as any, a.classroom, caller);
    if (!levelAllows(level, 'view')) throw new ForbiddenException('You do not have access to this classroom');
    return {
      ...base,
      role: 'teacher' as const,
      key: ws.key,
      questions: ws.questions,
    };
  }

  /** Page pictures: the owner, staff on a class it is assigned to, or a student it is assigned to. */
  async page(caller: Caller, pageId: string) {
    const page = await this.prisma.worksheetPage.findUnique({
      where: { id: pageId },
      select: { mime: true, data: true, worksheet: { select: { id: true, ownerId: true } } },
    });
    if (!page) throw new NotFoundException('Page not found');
    const wsId = page.worksheet.id;
    if (page.worksheet.ownerId === caller.userId || caller.role === Role.SUPER_ADMIN) return page;

    if (this.isStudent(caller)) {
      const ok = await this.prisma.assignment.findFirst({
        where: {
          worksheetId: wsId,
          deletedAt: null,
          classroom: { deletedAt: null, enrollments: { some: { studentId: caller.userId } } },
          OR: [{ targets: { none: {} } }, { targets: { some: { studentId: caller.userId } } }],
        },
        select: { id: true },
      });
      if (ok) return page;
      throw new ForbiddenException();
    }
    if (STAFF.has(String(caller.role))) {
      const assignments = await this.prisma.assignment.findMany({
        where: { worksheetId: wsId, deletedAt: null },
        select: { classroom: { select: { id: true, teacherId: true, organizationId: true } } },
      });
      for (const x of assignments) {
        if (levelAllows(await classroomAccessLevel(this.prisma as any, x.classroom, caller), 'view')) return page;
      }
    }
    throw new ForbiddenException();
  }

  /** Autosave while the student works. Not allowed after submitting or after the due date. */
  async saveDraft(caller: Caller, assignmentId: string, rawAnswers: unknown) {
    if (!this.isStudent(caller)) throw new ForbiddenException('Only students answer worksheets');
    const a = await this.loadAssignment(assignmentId);
    await this.assertStudentMay(a, caller.userId);
    if (isClosed(a.dueAt)) throw new ForbiddenException('This assignment is closed. The due date has passed.');
    const ws = await this.worksheetFor(a);
    const answers = normalizeAnswers(rawAnswers, ws.questionCount);
    const existing = await this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId: a.id, studentId: caller.userId } },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== SubmissionStatus.DRAFT) throw new ConflictException('You already turned this in.');
    const content = JSON.stringify({ v: 1, answers } satisfies StoredAnswers);
    await this.prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: a.id, studentId: caller.userId } },
      create: { assignmentId: a.id, studentId: caller.userId, status: SubmissionStatus.DRAFT, content },
      update: { content },
    });
    return { saved: true, answers };
  }

  /**
   * Turn it in: the server scores against the stored key (one point per match)
   * and records the grade. The browser never sends a score. One attempt.
   */
  async submit(caller: Caller, assignmentId: string, rawAnswers: unknown) {
    if (!this.isStudent(caller)) throw new ForbiddenException('Only students answer worksheets');
    const a = await this.loadAssignment(assignmentId);
    await this.assertStudentMay(a, caller.userId);
    if (isClosed(a.dueAt)) throw new ForbiddenException('This assignment is closed. The due date has passed.');
    const ws = await this.worksheetFor(a);
    const answers = normalizeAnswers(rawAnswers, ws.questionCount);
    const { score } = studentResult({ answers, key: ws.key, questions: ws.questions, dueAt: a.dueAt, submittedAt: null });
    const now = new Date();
    const content = JSON.stringify({ v: 1, answers } satisfies StoredAnswers);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.submission.findUnique({
        where: { assignmentId_studentId: { assignmentId: a.id, studentId: caller.userId } },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== SubmissionStatus.DRAFT) throw new ConflictException('You already turned this in.');
      const sub = existing
        ? await tx.submission.update({ where: { id: existing.id }, data: { content, status: SubmissionStatus.GRADED, submittedAt: now } })
        : await tx.submission.create({ data: { assignmentId: a.id, studentId: caller.userId, content, status: SubmissionStatus.GRADED, submittedAt: now } });
      await tx.grade.create({
        data: { submissionId: sub.id, score, maxScore: ws.questionCount, gradedById: a.classroom.teacherId },
      });
    });

    return studentResult({ answers, key: ws.key, questions: ws.questions, dueAt: a.dueAt, submittedAt: now });
  }

  // ───────────────────────── Teacher results ─────────────────────────

  async results(caller: Caller, assignmentId: string) {
    const a = await this.loadAssignment(assignmentId);
    const level = await classroomAccessLevel(this.prisma as any, a.classroom, caller);
    if (!levelAllows(level, 'view')) throw new ForbiddenException('You do not have access to this classroom');
    const ws = await this.worksheetFor(a);

    const targeted = new Set(a.targets.map((t) => t.studentId));
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId: a.classroomId, student: { deletedAt: null, role: Role.STUDENT } },
      select: { student: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } } },
    });
    const students = enrollments
      .map((e) => e.student)
      .filter((s) => targeted.size === 0 || targeted.has(s.id));
    const subs = await this.prisma.submission.findMany({
      where: { assignmentId: a.id, studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true, status: true, content: true, submittedAt: true, grade: { select: { score: true, maxScore: true } } },
    });
    const subBy = new Map(subs.map((s) => [s.studentId, s]));

    const rows = students
      .map((s) => {
        const sub = subBy.get(s.id);
        const submitted = !!sub && sub.status !== SubmissionStatus.DRAFT;
        return {
          studentId: s.id,
          firstName: s.profile?.firstName ?? '',
          lastName: s.profile?.lastName ?? '',
          status: submitted ? 'submitted' : sub ? 'started' : 'not started',
          submittedAt: submitted && sub!.submittedAt ? sub!.submittedAt.toISOString() : null,
          score: submitted ? sub!.grade?.score ?? null : null,
          maxScore: ws.questionCount,
          answers: submitted ? readStoredAnswers(sub!.content, ws.questionCount) : null,
        };
      })
      .sort((x, y) => (x.lastName + x.firstName).localeCompare(y.lastName + y.firstName));

    const attempts = rows.filter((r) => r.answers).map((r) => r.answers!) as (Letter | null)[][];
    const scores = rows.map((r) => r.score).filter((x): x is number => x !== null);
    return {
      assignmentId: a.id,
      title: a.title,
      className: a.classroom.name,
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      questionCount: ws.questionCount,
      key: ws.key,
      questions: ws.questions,
      summary: {
        students: rows.length,
        submitted: scores.length,
        averageScore: scores.length ? Math.round((scores.reduce((p, c) => p + c, 0) / scores.length) * 10) / 10 : null,
      },
      items: itemAnalysis(ws.key, attempts),
      rows,
    };
  }

  /** Worksheets this teacher saved (to assign again later). */
  async mine(caller: Caller) {
    return this.prisma.worksheet.findMany({
      where: { ownerId: caller.userId },
      select: { id: true, title: true, standard: true, questionCount: true, createdAt: true, _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Classes this teacher can assign to, with students (for the picker). */
  async assignTargets(caller: Caller) {
    const classes = await this.prisma.classroom.findMany({
      where: { deletedAt: null, ...accessibleClassroomWhere(caller.userId, 'teach') },
      select: {
        id: true,
        name: true,
        enrollments: {
          where: { student: { deletedAt: null, role: Role.STUDENT } },
          select: { student: { select: { id: true, profile: { select: { firstName: true, lastName: true } } } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      students: c.enrollments
        .map((e) => ({ id: e.student.id, firstName: e.student.profile?.firstName ?? '', lastName: e.student.profile?.lastName ?? '' }))
        .sort((x, y) => (x.lastName + x.firstName).localeCompare(y.lastName + y.firstName)),
    }));
  }
}

