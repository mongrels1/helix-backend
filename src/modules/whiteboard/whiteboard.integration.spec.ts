/**
 * Real-database + real-socket test of the live whiteboard (18 Nov 2026 classroom report:
 * students could not see the teacher, invite links were not clickable, nothing showed
 * while the pen was down). Skipped unless INTEGRATION_DATABASE_URL is set; needs
 * socket.io-client (set SOCKET_IO_CLIENT to its path if it is not installed here).
 */
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { WhiteboardService } from './whiteboard.service';
import { WhiteboardGateway } from './whiteboard.gateway';
import { TUTOR_COLOR } from './whiteboard.logic';

const URL = process.env.INTEGRATION_DATABASE_URL;
function clientPath(): string | null {
  try {
    return require.resolve(process.env.SOCKET_IO_CLIENT ?? 'socket.io-client');
  } catch {
    return null;
  }
}
const CLIENT = clientPath();
// Needs a test database and the socket client; skipped (never failed) without them.
const run = URL && CLIENT ? describe : describe.skip;
const SECRET = 'wb-integration-secret';

type Sock = {
  on: (e: string, cb: (d: any) => void) => void;
  off: (e: string) => void;
  emit: (...a: any[]) => void;
  emitWithAck: (...a: any[]) => Promise<any>;
  disconnect: () => void;
  connected: boolean;
};

function next(sock: Sock, event: string, ms = 3000, match: (d: any) => boolean = () => true): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event} within ${ms} ms`)), ms);
    sock.on(event, (d: any) => {
      if (!match(d)) return;
      clearTimeout(t);
      resolve(d);
    });
  });
}
function none(sock: Sock, event: string, ms = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let got = false;
    sock.on(event, () => (got = true));
    setTimeout(() => resolve(!got), ms);
  });
}

run('Live whiteboard (real DB + sockets)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: WhiteboardService;
  let base: string;
  let io: (url: string, opts: any) => Sock;
  const sfx = randomUUID().slice(0, 8);
  let T: string, A: string, B: string;
  let sessionId: string, code: string, groupId: string;
  const socks: Sock[] = [];
  const jwt = new JwtService({ secret: SECRET });
  const connect = async (userId: string): Promise<Sock> => {
    const s = io(`${base}/whiteboard`, { auth: { token: jwt.sign({ sub: userId }) }, transports: ['websocket'], forceNew: true });
    socks.push(s);
    await new Promise<void>((r) => s.on('connect', () => r()));
    return s;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    io = require(CLIENT as string).io;
    const mod = await Test.createTestingModule({
      providers: [PrismaService, WhiteboardService, WhiteboardGateway, { provide: JwtService, useValue: jwt }],
    }).compile();
    app = mod.createNestApplication();
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    svc = app.get(WhiteboardService);
    const org = await prisma.organization.create({ data: { name: `WB ${sfx}`, slug: `wb-${sfx}` } });
    const mk = async (local: string, role: string) =>
      (await prisma.user.create({ data: { email: `${local}-${sfx}@example.org`, passwordHash: 'x', role: role as any, profile: { create: { firstName: local, lastName: 'T' } } } })).id;
    T = await mk('teacher', 'TEACHER');
    A = await mk('amy', 'STUDENT');
    B = await mk('ben', 'STUDENT');
    const c = await prisma.classroom.create({ data: { name: 'P4', organizationId: org.id, teacherId: T } });
    await prisma.enrollment.create({ data: { classroomId: c.id, studentId: A } });
  });
  afterAll(async () => {
    for (const s of socks) s.disconnect();
    if (sessionId) await svc.endSession(sessionId, T).catch(() => undefined);
    await app?.close();
  });

  it('a quick session starts, and Let students write is on by default', async () => {
    const v = await svc.startSession(T, { title: 'Quick', question: { stem: 'Q1' } });
    sessionId = v.id;
    code = v.joinCode as string;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(v.groupWrite).toBe(true);
  });

  it('an invited student is offered the session with its code (Join now banner); others are not', async () => {
    await svc.invite(sessionId, T, [A]);
    const a = await svc.activeForStudent(A);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: sessionId, joined: false, joinCode: code });
    expect(await svc.activeForStudent(B)).toHaveLength(0);
  });

  it('after joining, the banner opens the session (no code needed)', async () => {
    await svc.joinByCode(A, code);
    const a = await svc.activeForStudent(A);
    expect(a[0]).toMatchObject({ joined: true, joinCode: null });
  });

  let tutor: Sock, amy: Sock;
  it('teacher and student connect; in group mode the student sees the teacher\'s board', async () => {
    tutor = await connect(T);
    amy = await connect(A);
    const tj = await tutor.emitWithAck('wb:join', { sessionId });
    const aj = await amy.emitWithAck('wb:join', { sessionId });
    expect(tj.ok).toBe(true);
    expect(aj.ok).toBe(true);
    groupId = aj.data.boards.find((b: any) => b.kind === 'GROUP').id;
    const access = next(amy, 'wb:access', 3000, (d) => d[groupId] === true);
    expect((await tutor.emitWithAck('wb:control', { action: 'mode', mode: 'GROUP' })).ok).toBe(true);
    await access;
  });

  it('the student sees the teacher\'s line while the pen is still down, in teacher green', async () => {
    const got = next(amy, 'wb:ink');
    tutor.emit('wb:ink', { boardId: groupId, stroke: { id: 'live1', layer: 'p:page1', tool: 'pen', color: '#ff0000', width: 4, points: [10, 10, 40, 40] } });
    const d = await got;
    expect(d).toMatchObject({ boardId: groupId, by: T, stroke: { id: 'live1', color: TUTOR_COLOR } });
  });

  it('the finished teacher stroke reaches the student and is saved', async () => {
    const got = next(amy, 'wb:op');
    const res = await tutor.emitWithAck('wb:op', {
      boardId: groupId,
      op: { type: 'add', stroke: { id: 'done1', layer: 'p:page1', tool: 'pen', color: TUTOR_COLOR, width: 4, points: [10, 10, 40, 40] } },
    });
    expect(res.ok).toBe(true);
    expect((await got).op.stroke.id).toBe('done1');
    await svc.flushAll();
    const row = await prisma.whiteboardBoard.findUnique({ where: { id: groupId } });
    expect(JSON.stringify(row?.pages)).toContain('done1');
  });

  it('Let students write off: the student can only watch, and the setting is saved', async () => {
    const access = next(amy, 'wb:access', 3000, (d) => d[groupId] === false);
    expect((await tutor.emitWithAck('wb:control', { action: 'groupWrite', on: false })).ok).toBe(true);
    await access;
    const write = await amy.emitWithAck('wb:op', {
      boardId: groupId,
      op: { type: 'add', stroke: { id: 'amy1', layer: 'p:page1', tool: 'pen', color: '#1d4ed8', width: 4, points: [1, 1, 2, 2] } },
    });
    expect(write).toEqual({ ok: false, error: 'not allowed' });
    const quiet = none(tutor, 'wb:ink');
    amy.emit('wb:ink', { boardId: groupId, stroke: { id: 'amy2', layer: 'p:page1', tool: 'pen', width: 4, points: [1, 1, 2, 2] } });
    expect(await quiet).toBe(true);
    const row = await prisma.whiteboardSession.findUnique({ where: { id: sessionId } });
    expect(row?.groupWrite).toBe(false);
  });

  it('Let students write on again: the student writes in her own color', async () => {
    const access = next(amy, 'wb:access', 3000, (d) => d[groupId] === true);
    await tutor.emitWithAck('wb:control', { action: 'groupWrite', on: true });
    await access;
    const got = next(tutor, 'wb:ink');
    amy.emit('wb:ink', { boardId: groupId, stroke: { id: 'amy3', layer: 'p:page1', tool: 'pen', color: TUTOR_COLOR, width: 4, points: [1, 1, 2, 2] } });
    const d = await got;
    expect(d.by).toBe(A);
    expect(d.stroke.color).not.toBe(TUTOR_COLOR);
  });

  it('a student who is not in the session never receives its ink', async () => {
    const ben = await connect(B);
    const j = await ben.emitWithAck('wb:join', { sessionId });
    expect(j.ok).toBe(false);
    const quiet = none(ben, 'wb:ink');
    tutor.emit('wb:ink', { boardId: groupId, stroke: { id: 'live2', layer: 'p:page1', tool: 'pen', width: 4, points: [5, 5, 6, 6] } });
    expect(await quiet).toBe(true);
  });
});
