import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  applyOp,
  BOARD_KIND,
  BoardDoc,
  BoardOp,
  BoardQuestion,
  BoardRef,
  canView,
  canWrite,
  emptyDoc,
  isTutor,
  LIMITS,
  normalizeDoc,
  OpError,
  sanitizeOp,
  sanitizeQuestion,
  SESSION_MODE,
  SessionState,
  STUDENT_COLORS,
  TUTOR_COLOR,
} from './whiteboard.logic';

export interface Participant {
  userId: string;
  name: string;
  role: 'TUTOR' | 'STUDENT';
  color: string;
}

interface LiveBoard {
  ref: BoardRef;
  doc: BoardDoc;
  /** Running total of point numbers on the board (memory and storage budget). */
  points: number;
  question: BoardQuestion | null;
  version: number;
  dirty: boolean;
}

interface LiveSession {
  id: string;
  classroomId: string | null;
  joinCode: string | null;
  title: string;
  startedAt: Date;
  state: SessionState;
  participants: Participant[];
  boards: Map<string, LiveBoard>;
  hands: Set<string>;
}

export interface BoardView {
  id: string;
  kind: string;
  ownerId: string | null;
  question: BoardQuestion | null;
  doc: BoardDoc;
  version: number;
  canWrite: boolean;
}

export interface SessionView {
  id: string;
  classroomId: string | null;
  joinCode: string | null;
  title: string;
  status: string;
  mode: string;
  focusStudentId: string | null;
  presentedBoardId: string | null;
  lockedStudentIds: string[];
  hands: string[];
  startedAt: Date;
  participants: Participant[];
}

/** Students one session can hold. A group of four is the model; this is the safety cap. */
const MAX_STUDENTS = 30;
/** A session older than this is closed (work kept) instead of resumed. */
const STALE_MS = 12 * 60 * 60 * 1000;

export type Requester = { userId: string; role: string; orgId?: string };
const FLUSH_MS = 2000;
/** Where students open a shared link. */
const APP_URL = (process.env.APP_URL ?? 'https://app.edkairos.com').replace(/\/$/, '');

/** No 0/O, 1/I/L: easy to read aloud and to type from a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeJoinCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export function normalizeJoinCode(raw: string): string | null {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

@Injectable()
export class WhiteboardService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhiteboardService.name);
  private readonly live = new Map<string, LiveSession>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      void this.flushAll();
    }, FLUSH_MS);
    this.flushTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushAll();
  }

  // ---------------------------------------------------------------------------
  // Sessions (REST)
  // ---------------------------------------------------------------------------

  /**
   * Start a session, or return the one already running.
   * With a classroomId: every enrolled student gets a board up front.
   * Without one (a quick session): the session starts with only the group board and
   * students join with the code; their boards are added as they arrive.
   */
  async startSession(
    tutorId: string,
    input: { classroomId?: string; title?: string; question?: unknown; questions?: Record<string, unknown> },
  ): Promise<SessionView> {
    let classroomId: string | null = null;
    let studentIds: string[] = [];
    if (input.classroomId) {
      const classroom = await this.prisma.classroom.findFirst({
        where: { id: input.classroomId, deletedAt: null },
        select: { id: true, teacherId: true },
      });
      if (!classroom) throw new NotFoundException('Classroom not found');
      if (classroom.teacherId !== tutorId) {
        throw new ForbiddenException('Only the classroom teacher can start a live session');
      }
      classroomId = classroom.id;
    }

    const existing = await this.findRunning(tutorId, classroomId);
    if (existing) {
      // A session left running from an earlier day is closed (work kept) rather than resumed.
      const stale = Date.now() - existing.startedAt.getTime() > STALE_MS;
      if (!stale) return this.sessionView(await this.ensureLive(existing.id));
      await this.endSession(existing.id, existing.tutorId === tutorId ? tutorId : existing.tutorId);
    }

    if (classroomId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: { classroomId, student: { deletedAt: null } },
        select: { studentId: true },
        orderBy: { enrolledAt: 'asc' },
        take: MAX_STUDENTS,
      });
      studentIds = enrollments.map((e) => e.studentId);
      if (studentIds.length === 0) {
        throw new BadRequestException(
          'Add students to this classroom first, or start a quick whiteboard from your dashboard and share the code.',
        );
      }
    }

    let common: BoardQuestion | null;
    const perStudent = new Map<string, BoardQuestion | null>();
    try {
      common = sanitizeQuestion(input.question);
      const enrolled = new Set(studentIds);
      for (const [studentId, q] of Object.entries(input.questions ?? {})) {
        if (enrolled.has(studentId)) perStudent.set(studentId, sanitizeQuestion(q));
      }
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const empty = emptyDoc() as unknown as Prisma.InputJsonValue;
    const asJson = (q: BoardQuestion | null) =>
      q ? (q as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const session = await this.prisma.whiteboardSession.create({
          data: {
            classroomId,
            tutorId,
            joinCode: makeJoinCode(),
            title: (input.title ?? '').trim().slice(0, 120) || (classroomId ? 'Live session' : 'Quick session'),
            boards: {
              create: [
                { kind: BOARD_KIND.GROUP, ownerId: null, question: asJson(common), pages: empty },
                ...studentIds.map((id) => ({
                  kind: BOARD_KIND.PRIVATE,
                  ownerId: id,
                  question: asJson(perStudent.get(id) ?? common),
                  pages: empty,
                })),
              ],
            },
          },
          select: { id: true },
        });
        return this.sessionView(await this.ensureLive(session.id));
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        // Another start won the race (one ACTIVE per classroom / per tutor), or the
        // random code collided with a live one: resume the winner, or try a new code.
        const winner = await this.findRunning(tutorId, classroomId);
        if (winner) return this.sessionView(await this.ensureLive(winner.id));
      }
    }
    throw new BadRequestException('Could not start the session. Please try again.');
  }

  private findRunning(tutorId: string, classroomId: string | null) {
    return this.prisma.whiteboardSession.findFirst({
      where: classroomId
        ? { classroomId, status: 'ACTIVE' }
        : { tutorId, classroomId: null, status: 'ACTIVE' },
      select: { id: true, startedAt: true, tutorId: true },
    });
  }

  /**
   * A student joins with a code (typed, or from a shared link). They get their own
   * board at once, with the group question on it, and the tutor's screen updates live.
   */
  async joinByCode(studentId: string, rawCode: string): Promise<{ sessionId: string; added: BoardView | null }> {
    const code = normalizeJoinCode(rawCode);
    if (!code) throw new BadRequestException('That code is not right. Check it with your tutor.');
    const row = await this.prisma.whiteboardSession.findFirst({
      where: { joinCode: code, status: 'ACTIVE' },
      select: { id: true, classroomId: true, tutorId: true },
    });
    if (!row) throw new NotFoundException('No live session with that code. It may have ended — check with your tutor.');
    if (row.tutorId === studentId) throw new BadRequestException('This is your own session.');
    if (row.classroomId) {
      // Classroom sessions stay with the class roster.
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { classroomId: row.classroomId, studentId },
        select: { id: true },
      });
      if (!enrolled) throw new ForbiddenException('This session is for a class you are not in.');
    }

    const s = await this.ensureLive(row.id);
    if (s.participants.some((p) => p.userId === studentId)) return { sessionId: row.id, added: null };
    const students = s.participants.filter((p) => p.role === 'STUDENT').length;
    if (students >= MAX_STUDENTS) throw new BadRequestException('This session is full.');

    const group = [...s.boards.values()].find((b) => b.ref.kind === BOARD_KIND.GROUP);
    const question = group?.question ?? null;
    const created = await this.prisma.whiteboardBoard.create({
      data: {
        sessionId: row.id,
        kind: BOARD_KIND.PRIVATE,
        ownerId: studentId,
        question: question ? (question as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        pages: emptyDoc() as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    // Two quick taps could add the student twice; keep the first board.
    if (s.participants.some((p) => p.userId === studentId)) {
      await this.prisma.whiteboardBoard.delete({ where: { id: created.id } });
      return { sessionId: row.id, added: null };
    }
    const names = await this.names([studentId]);
    s.participants.push({
      userId: studentId,
      name: names.get(studentId) ?? 'Student',
      role: 'STUDENT',
      color: STUDENT_COLORS[students % STUDENT_COLORS.length],
    });
    const board: LiveBoard = {
      ref: { id: created.id, kind: BOARD_KIND.PRIVATE, ownerId: studentId },
      doc: emptyDoc(),
      points: 0,
      question,
      version: 0,
      dirty: false,
    };
    s.boards.set(created.id, board);
    const view = this.boardsFor(s, s.state.tutorId).find((b) => b.id === created.id) ?? null;
    return { sessionId: row.id, added: view };
  }

  /** The tutor's own students: anyone in their classes or in their past sessions. */
  async myStudents(tutorId: string, query: string) {
    const [enrolled, past] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { classroom: { teacherId: tutorId, deletedAt: null } },
        select: { studentId: true },
      }),
      this.prisma.whiteboardBoard.findMany({
        where: { kind: BOARD_KIND.PRIVATE, ownerId: { not: null }, session: { tutorId } },
        select: { ownerId: true },
        distinct: ['ownerId'],
        take: 500,
      }),
    ]);
    const ids = [...new Set([...enrolled.map((e) => e.studentId), ...past.map((b) => b.ownerId as string)])];
    if (ids.length === 0) return [];
    const q = query.trim().slice(0, 60);
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        role: 'STUDENT',
        ...(q
          ? {
              OR: [
                { profile: { firstName: { startsWith: q, mode: 'insensitive' as const } } },
                { profile: { lastName: { startsWith: q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      select: { id: true, profile: { select: { firstName: true, lastName: true } } },
      orderBy: { profile: { firstName: 'asc' } },
      take: 25,
    });
    return users.map((u) => ({
      id: u.id,
      name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}`.trim() : 'Student',
    }));
  }

  /**
   * Send the join link to some of the tutor's own students through EdKairos Messages.
   * Reuses one "Live whiteboard" thread per tutor-student pair so inboxes stay tidy.
   */
  async invite(sessionId: string, tutorId: string, studentIds: string[]): Promise<{ sent: number }> {
    const row = await this.prisma.whiteboardSession.findUnique({
      where: { id: sessionId },
      select: { tutorId: true, status: true, joinCode: true, title: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    if (row.tutorId !== tutorId) throw new ForbiddenException();
    if (row.status !== 'ACTIVE' || !row.joinCode) throw new BadRequestException('This session has ended.');
    const allowed = new Set((await this.myStudents(tutorId, '')).map((s) => s.id));
    // myStudents caps at 25 for the picker; check the rest directly.
    const wanted = [...new Set(studentIds)].slice(0, MAX_STUDENTS);
    const permitted: string[] = [];
    for (const id of wanted) {
      if (allowed.has(id) || (await this.isMyStudent(tutorId, id))) permitted.push(id);
    }
    if (permitted.length === 0) throw new BadRequestException('Choose students from your classes or past sessions.');

    const tutorName = (await this.names([tutorId])).get(tutorId) ?? 'Your tutor';
    const link = `${APP_URL}/live/${row.joinCode}`;
    const content = `${tutorName} invited you to a live whiteboard: ${link}\nOr open Live session and type the code ${row.joinCode}.`;
    const subject = 'Live whiteboard';
    for (const studentId of permitted) {
      let thread = await this.prisma.thread.findFirst({
        where: {
          subject,
          AND: [{ participants: { some: { userId: tutorId } } }, { participants: { some: { userId: studentId } } }],
        },
        select: { id: true },
      });
      if (!thread) {
        thread = await this.prisma.thread.create({
          data: { subject, participants: { create: [{ userId: tutorId }, { userId: studentId }] } },
          select: { id: true },
        });
      }
      await this.prisma.message.create({ data: { threadId: thread.id, senderId: tutorId, content } });
    }
    return { sent: permitted.length };
  }

  private async isMyStudent(tutorId: string, studentId: string): Promise<boolean> {
    const [enr, board] = await Promise.all([
      this.prisma.enrollment.findFirst({
        where: { studentId, classroom: { teacherId: tutorId, deletedAt: null } },
        select: { id: true },
      }),
      this.prisma.whiteboardBoard.findFirst({
        where: { ownerId: studentId, session: { tutorId } },
        select: { id: true },
      }),
    ]);
    return !!(enr || board);
  }

  /** The tutor's own sessions, newest first (quick and classroom). */
  async listMine(tutorId: string) {
    return this.prisma.whiteboardSession.findMany({
      where: { tutorId },
      select: { id: true, title: true, status: true, startedAt: true, endedAt: true, classroomId: true, joinCode: true },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  /** Active sessions in classrooms this student is enrolled in. */
  async activeForStudent(studentId: string) {
    const rows = await this.prisma.whiteboardSession.findMany({
      where: {
        status: 'ACTIVE',
        boards: { some: { ownerId: studentId } },
      },
      select: { id: true, classroomId: true, title: true, startedAt: true, tutorId: true },
      orderBy: { startedAt: 'desc' },
    });
    const names = await this.names(rows.map((r) => r.tutorId));
    return rows.map((r) => ({ ...r, tutorName: names.get(r.tutorId) ?? 'Your tutor' }));
  }

  /** Session history for a classroom (tutor) — newest first. */
  async listForClassroom(classroomId: string, user: Requester) {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId },
      select: { teacherId: true, organizationId: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (classroom.teacherId !== user.userId && !this.isAdminOf(user, classroom.organizationId)) {
      throw new ForbiddenException();
    }
    return this.prisma.whiteboardSession.findMany({
      where: { classroomId },
      select: {
        id: true,
        title: true,
        status: true,
        startedAt: true,
        endedAt: true,
        _count: { select: { boards: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  /** Read a session (live or ended) with the boards this user may see. Used for review. */
  async readForUser(sessionId: string, user: Requester) {
    const userId = user.userId;
    const row = await this.prisma.whiteboardSession.findUnique({
      where: { id: sessionId },
      include: { boards: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!row) throw new NotFoundException('Session not found');
    let admin = false;
    if (user.role === 'SUPER_ADMIN') admin = true;
    else if (user.role === 'ORG_ADMIN' && row.classroomId) {
      const classroom = await this.prisma.classroom.findFirst({
        where: { id: row.classroomId },
        select: { organizationId: true },
      });
      admin = !!classroom && this.isAdminOf(user, classroom.organizationId);
    }
    const state = this.stateOf(row);
    // A presentation only shares a board while the session is live.
    if (state.status !== 'ACTIVE') state.presentedBoardId = null;
    const visible = row.boards.filter(
      (b) => admin || canView(userId, state, { id: b.id, kind: b.kind, ownerId: b.ownerId }),
    );
    if (!admin && !isTutor(userId, state) && !visible.some((b) => b.ownerId === userId)) {
      throw new ForbiddenException();
    }
    const live = this.live.get(sessionId);
    return {
      session: this.sessionView(live ?? (await this.ensureLive(sessionId, false))),
      boards: visible.map((b) => {
        const lb = live?.boards.get(b.id);
        return {
          id: b.id,
          kind: b.kind,
          ownerId: b.ownerId,
          question: (lb?.question ?? b.question) as BoardQuestion | null,
          doc: lb?.doc ?? normalizeDoc(b.pages),
          version: lb?.version ?? b.version,
          canWrite: false,
        };
      }),
    };
  }

  async endSession(sessionId: string, userId: string): Promise<SessionView> {
    const row = await this.prisma.whiteboardSession.findUnique({
      where: { id: sessionId },
      select: { tutorId: true, status: true },
    });
    if (!row) throw new NotFoundException('Session not found');
    if (row.tutorId !== userId) throw new ForbiddenException();
    const s = await this.ensureLive(sessionId, false);
    if (row.status !== 'ACTIVE') return this.sessionView(s);
    s.state.status = 'ENDED'; // stops new ops at once; then save what is in memory
    s.state.presentedBoardId = null;
    s.state.mode = SESSION_MODE.MONITOR;
    s.state.focusStudentId = null;
    s.hands.clear();
    await this.flushSession(s);
    await this.prisma.whiteboardSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date(), presentedBoardId: null, mode: SESSION_MODE.MONITOR, focusStudentId: null },
    });
    this.live.delete(sessionId);
    return this.sessionView(s);
  }

  // ---------------------------------------------------------------------------
  // Live (sockets)
  // ---------------------------------------------------------------------------

  /** Load a session (and all its boards) into memory if it isn't already. */
  async ensureLive(sessionId: string, cache = true): Promise<LiveSession> {
    const cached = this.live.get(sessionId);
    if (cached) return cached;
    const row = await this.prisma.whiteboardSession.findUnique({
      where: { id: sessionId },
      include: { boards: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!row) throw new NotFoundException('Session not found');

    const studentIds = row.boards
      .filter((b) => b.kind === BOARD_KIND.PRIVATE && b.ownerId)
      .map((b) => b.ownerId as string);
    const names = await this.names([row.tutorId, ...studentIds]);
    const participants: Participant[] = [
      { userId: row.tutorId, name: names.get(row.tutorId) ?? 'Tutor', role: 'TUTOR', color: TUTOR_COLOR },
      ...studentIds.map((id, i) => ({
        userId: id,
        name: names.get(id) ?? 'Student',
        role: 'STUDENT' as const,
        color: STUDENT_COLORS[i % STUDENT_COLORS.length],
      })),
    ];

    const live: LiveSession = {
      id: row.id,
      classroomId: row.classroomId,
      joinCode: row.joinCode,
      title: row.title,
      startedAt: row.startedAt,
      state: this.stateOf(row),
      participants,
      hands: new Set(),
      boards: new Map(
        row.boards.map((b) => [
          b.id,
          {
            ref: { id: b.id, kind: b.kind, ownerId: b.ownerId },
            doc: normalizeDoc(b.pages),
            points: normalizeDoc(b.pages).strokes.reduce((n, x) => n + (x.points?.length ?? 0), 0),
            question: (b.question as BoardQuestion | null) ?? null,
            version: b.version,
            dirty: false,
          },
        ]),
      ),
    };
    // Another request may have loaded it while we awaited; keep the first copy.
    const raced = this.live.get(sessionId);
    if (raced) return raced;
    if (cache && live.state.status === 'ACTIVE') this.live.set(sessionId, live);
    return live;
  }

  /** Who may join the live room: the tutor, or a student with a board in it. */
  async joinCheck(sessionId: string, userId: string): Promise<LiveSession> {
    const s = await this.ensureLive(sessionId);
    if (s.state.status !== 'ACTIVE') throw new ForbiddenException('This session has ended');
    const me = s.participants.find((p) => p.userId === userId);
    if (!me) throw new ForbiddenException();
    if (me.role === 'STUDENT' && s.classroomId) {
      // Still enrolled? A student removed from the class mid-session loses access.
      const enrolled = await this.prisma.enrollment.findFirst({
        where: { classroomId: s.classroomId, studentId: userId },
        select: { id: true },
      });
      if (!enrolled) throw new ForbiddenException();
    }
    return s;
  }

  /** Is this user active (not deleted or suspended)? Returns their current role. */
  async activeUser(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, deletedAt: true, suspendedAt: true },
    });
    if (!u || u.deletedAt || u.suspendedAt) return null;
    return u.role;
  }

  /** The live copy, reloading it if it was released from memory a moment ago. */
  async liveOrLoad(sessionId: string): Promise<LiveSession | undefined> {
    const cached = this.live.get(sessionId);
    if (cached) return cached;
    try {
      const s = await this.ensureLive(sessionId);
      return s.state.status === 'ACTIVE' ? s : undefined;
    } catch {
      return undefined;
    }
  }

  liveSessionIds(): string[] {
    return [...this.live.keys()];
  }

  getLive(sessionId: string): LiveSession | undefined {
    return this.live.get(sessionId);
  }

  boardsFor(s: LiveSession, userId: string): BoardView[] {
    const out: BoardView[] = [];
    for (const b of s.boards.values()) {
      if (!canView(userId, s.state, b.ref)) continue;
      out.push({
        id: b.ref.id,
        kind: b.ref.kind,
        ownerId: b.ref.ownerId,
        question: b.question,
        doc: b.doc,
        version: b.version,
        canWrite: canWrite(userId, s.state, b.ref),
      });
    }
    return out;
  }

  /** Validate and apply a drawing op. Returns what to broadcast, or null for a no-op. */
  applyBoardOp(
    s: LiveSession,
    userId: string,
    boardId: string,
    rawOp: unknown,
  ): { op: BoardOp; version: number } | null {
    const board = s.boards.get(boardId);
    if (!board) throw new OpError('no such board');
    if (!canWrite(userId, s.state, board.ref)) throw new OpError('not allowed');
    const op = sanitizeOp(rawOp, userId);
    if (op.type === 'add') {
      // Ink color is identity: everyone's marks are always in their own color.
      const me = s.participants.find((p) => p.userId === userId);
      if (me) op.stroke.color = me.color;
    }
    if (op.type === 'add' && board.points + op.stroke.points.length > LIMITS.maxPointsPerBoard) {
      throw new OpError('This board is full. Add a page or clear some work.');
    }
    const result = applyOp(board.doc, op, userId, isTutor(userId, s.state));
    board.points = board.doc.strokes.reduce((n, x) => n + x.points.length, 0);
    if (!result.changed || !result.applied) return null;
    board.version += 1;
    board.dirty = true;
    return { op: result.applied, version: board.version };
  }

  /** Tutor controls. Returns true if anything changed. */
  async control(
    s: LiveSession,
    userId: string,
    action: string,
    payload: { studentId?: string; boardId?: string; mode?: string; question?: unknown },
  ): Promise<{ changed: boolean; boardIds?: string[] }> {
    if (!isTutor(userId, s.state)) throw new OpError('tutor only');
    const st = s.state;
    const students = s.participants.filter((p) => p.role === 'STUDENT').map((p) => p.userId);
    const isStudent = (id?: string): id is string => !!id && students.includes(id);

    switch (action) {
      case 'mode': {
        const mode = payload.mode;
        if (mode !== SESSION_MODE.MONITOR && mode !== SESSION_MODE.GROUP && mode !== SESSION_MODE.ONE_ON_ONE) {
          throw new OpError('bad mode');
        }
        st.mode = mode;
        if (mode === SESSION_MODE.ONE_ON_ONE && isStudent(payload.studentId)) st.focusStudentId = payload.studentId;
        if (mode !== SESSION_MODE.ONE_ON_ONE) st.focusStudentId = null;
        // Leaving the group screen ends any presentation, so private work is private again.
        if (mode !== SESSION_MODE.GROUP) st.presentedBoardId = null;
        break;
      }
      case 'lock':
        if (!isStudent(payload.studentId)) throw new OpError('bad student');
        if (!st.lockedStudentIds.includes(payload.studentId)) st.lockedStudentIds.push(payload.studentId);
        break;
      case 'unlock':
        if (!isStudent(payload.studentId)) throw new OpError('bad student');
        st.lockedStudentIds = st.lockedStudentIds.filter((id) => id !== payload.studentId);
        break;
      case 'lockAll':
        st.lockedStudentIds = [...students];
        break;
      case 'unlockAll':
        st.lockedStudentIds = [];
        break;
      case 'present': {
        const b = payload.boardId ? s.boards.get(payload.boardId) : undefined;
        if (!b) throw new OpError('no such board');
        st.presentedBoardId = b.ref.kind === BOARD_KIND.GROUP ? null : b.ref.id;
        st.mode = SESSION_MODE.GROUP;
        st.focusStudentId = null;
        break;
      }
      case 'unpresent':
        st.presentedBoardId = null;
        break;
      case 'question': {
        let q: BoardQuestion | null;
        try {
          q = sanitizeQuestion(payload.question);
        } catch (e) {
          throw new OpError((e as Error).message);
        }
        const targets = payload.boardId
          ? [s.boards.get(payload.boardId)].filter((b): b is LiveBoard => !!b)
          : [...s.boards.values()];
        if (targets.length === 0) throw new OpError('no such board');
        for (const b of targets) {
          b.question = q;
          // Ink drawn on the old question no longer lines up with anything: clear it.
          b.doc.strokes = b.doc.strokes.filter((x) => x.layer !== 'q');
          b.points = b.doc.strokes.reduce((n, x) => n + x.points.length, 0);
          b.version += 1;
        }
        await this.prisma.$transaction(
          targets.map((b) =>
            this.prisma.whiteboardBoard.update({
              where: { id: b.ref.id },
              data: {
                question: q ? (q as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
                pages: b.doc as unknown as Prisma.InputJsonValue,
                version: b.version,
              },
            }),
          ),
        );
        for (const b of targets) b.dirty = false;
        return { changed: true, boardIds: targets.map((b) => b.ref.id) };
      }
      case 'clearHand':
        if (payload.studentId) s.hands.delete(payload.studentId);
        return { changed: true };
      default:
        throw new OpError('unknown action');
    }

    await this.prisma.whiteboardSession.update({
      where: { id: s.id },
      data: {
        mode: st.mode,
        focusStudentId: st.focusStudentId,
        presentedBoardId: st.presentedBoardId,
        lockedStudentIds: st.lockedStudentIds,
      },
    });
    return { changed: true };
  }

  setHand(s: LiveSession, userId: string, up: boolean): void {
    if (isTutor(userId, s.state)) return;
    if (up) s.hands.add(userId);
    else s.hands.delete(userId);
  }

  sessionView(s: LiveSession): SessionView {
    return {
      id: s.id,
      classroomId: s.classroomId,
      joinCode: s.state.status === 'ACTIVE' ? s.joinCode : null,
      title: s.title,
      status: s.state.status,
      mode: s.state.mode,
      focusStudentId: s.state.focusStudentId,
      presentedBoardId: s.state.presentedBoardId,
      lockedStudentIds: [...s.state.lockedStudentIds],
      hands: [...s.hands],
      startedAt: s.startedAt,
      participants: s.participants,
    };
  }

  /** Drop an idle session from memory after saving it (no one connected). */
  async release(sessionId: string, stillEmpty: () => Promise<boolean>): Promise<void> {
    const s = this.live.get(sessionId);
    if (!s) return;
    await this.flushSession(s);
    // Someone may have joined while we were saving: keep the session in memory then.
    if (!(await stillEmpty())) return;
    if (s.boards.size && [...s.boards.values()].some((b) => b.dirty)) await this.flushSession(s);
    if (this.live.get(sessionId) === s) this.live.delete(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private flushing = false;

  async flushAll(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const s of this.live.values()) await this.flushSession(s);
    } finally {
      this.flushing = false;
    }
  }

  private async flushSession(s: LiveSession): Promise<void> {
    for (const b of s.boards.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      const version = b.version;
      try {
        await this.prisma.whiteboardBoard.update({
          where: { id: b.ref.id },
          data: { pages: b.doc as unknown as Prisma.InputJsonValue, version },
        });
      } catch (err) {
        b.dirty = true; // retry on the next tick; the in-memory copy is the truth
        this.logger.error(`whiteboard save failed for board ${b.ref.id}: ${(err as Error).message}`);
      }
    }
  }

  private stateOf(row: {
    tutorId: string;
    status: string;
    mode: string;
    focusStudentId: string | null;
    presentedBoardId: string | null;
    lockedStudentIds: string[];
  }): SessionState {
    return {
      tutorId: row.tutorId,
      status: row.status,
      mode: row.mode,
      focusStudentId: row.focusStudentId,
      presentedBoardId: row.presentedBoardId,
      lockedStudentIds: [...(row.lockedStudentIds ?? [])],
    };
  }

  private isAdminOf(user: Requester, organizationId: string): boolean {
    if (user.role === 'SUPER_ADMIN') return true;
    return user.role === 'ORG_ADMIN' && !!user.orgId && user.orgId === organizationId;
  }

  private async names(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const profiles = await this.prisma.profile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, firstName: true, lastName: true },
    });
    return new Map(
      profiles.map((p) => [
        p.userId,
        `${p.firstName}${p.lastName ? ` ${p.lastName.charAt(0)}.` : ''}`.trim(),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Question bank (published items only)
  // ---------------------------------------------------------------------------

  async searchQuestions(q: { grade?: number; text?: string; take?: number }) {
    const take = Math.min(Math.max(q.take ?? 30, 1), 60);
    const items = await this.prisma.diagnosticItem.findMany({
      where: {
        status: 'published',
        ...(q.grade ? { grade: q.grade } : {}),
        ...(q.text ? { stem: { contains: q.text, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, grade: true, strand: true, standard: true, stem: true, options: true, figure: true },
      orderBy: [{ grade: 'asc' }, { strand: 'asc' }],
      take,
    });
    return items;
  }
}
