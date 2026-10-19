import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { OpError, RateLimiter } from './whiteboard.logic';
import { WhiteboardService } from './whiteboard.service';

/** Same allowlist idea as main.ts, kept local so a socket can't be opened from any site. */
const SOCKET_ORIGINS = [
  'https://app.edkairos.com',
  'https://helix-frontend-sigma.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
];

interface SocketData {
  userId?: string;
  role?: string;
  sessionId?: string;
  ops?: RateLimiter;
  cursors?: RateLimiter;
  expiry?: NodeJS.Timeout;
  /** Resolves once the connection's user has been checked against the database. */
  ready?: Promise<void>;
}

/** How often idle sessions are saved and dropped from memory. */
const SWEEP_MS = 5 * 60 * 1000;

const sRoom = (sid: string) => `s:${sid}`;
const tRoom = (sid: string) => `t:${sid}`;
const bRoom = (bid: string) => `b:${bid}`;

/**
 * Live whiteboard socket. Namespace /whiteboard, separate from the existing
 * messaging socket so nothing in live tutoring or messaging changes.
 *
 * Rooms: s:<session> everyone in the session, t:<session> the tutor,
 * b:<board> everyone allowed to see that board. A student is only ever in the
 * rooms of boards they may see, so a private board's strokes never reach
 * another student's browser.
 */
@WebSocketGateway({
  namespace: '/whiteboard',
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) =>
      cb(null, !origin || SOCKET_ORIGINS.includes(origin)),
    credentials: true,
  },
  maxHttpBufferSize: 1_000_000,
})
export class WhiteboardGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhiteboardGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly service: WhiteboardService,
    private readonly jwt: JwtService,
  ) {}

  private sweepTimer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    // Save and drop sessions nobody is connected to (e.g. a tutor who closed the tab).
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async handleConnection(client: Socket): Promise<void> {
    const data = client.data as SocketData;
    data.ready = this.authenticate(client, data);
    await data.ready;
  }

  private async authenticate(client: Socket, data: SocketData): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = this.jwt.verify<{ sub: string; exp?: number }>(token);
      // The token proves who it is; the database says whether they may still use the app.
      const role = await this.service.activeUser(payload.sub);
      if (!role) throw new Error('inactive');
      data.userId = payload.sub;
      data.role = role;
      data.ops = new RateLimiter(60, 300);
      data.cursors = new RateLimiter(25, 50);
      if (payload.exp) {
        // Access tokens are short-lived: when it lapses, drop the socket. The client
        // reconnects with a fresh token and rejoins without losing anything.
        const ms = payload.exp * 1000 - Date.now();
        data.expiry = setTimeout(() => client.disconnect(true), Math.max(0, ms));
      }
    } catch {
      client.emit('wb:error', { error: 'Please sign in again.' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const data = client.data as SocketData;
    if (data.expiry) clearTimeout(data.expiry);
    const { sessionId } = data;
    if (!sessionId) return;
    const remaining = (await this.server.in(sRoom(sessionId)).fetchSockets()).length;
    if (remaining === 0) {
      await this.service.release(sessionId, () => this.isEmpty(sessionId));
      return;
    }
    await this.broadcastSession(sessionId);
  }

  @SubscribeMessage('wb:join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string }
  ) {
    const data = client.data as SocketData;
    await data.ready;
    try {
      if (!data.userId || typeof body?.sessionId !== 'string') throw new OpError('bad request');
      const s = await this.service.joinCheck(body.sessionId, data.userId);
      // One session per socket: leave anything joined before.
      for (const room of client.rooms) if (room !== client.id) await client.leave(room);
      data.sessionId = s.id;
      await client.join(sRoom(s.id));
      if (s.state.tutorId === data.userId) await client.join(tRoom(s.id));
      const boards = this.service.boardsFor(s, data.userId);
      for (const b of boards) await client.join(bRoom(b.id));
      const result = { me: data.userId, session: this.service.sessionView(s), boards, online: [] as string[] };
      result.online = await this.online(s.id);
      await this.broadcastSession(s.id);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  @SubscribeMessage('wb:op')
  async op(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: string; op?: unknown }
  ) {
    const data = client.data as SocketData;
    await data.ready;
    try {
      if (!data.ops?.take()) throw new OpError('Slow down a little — too many changes at once.');
      const s = await this.liveFor(data);
      if (typeof body?.boardId !== 'string') throw new OpError('bad board');
      const res = this.service.applyBoardOp(s, data.userId as string, body.boardId, body.op);
      if (res) {
        client
          .to(bRoom(body.boardId))
          .emit('wb:op', { boardId: body.boardId, op: res.op, version: res.version, by: data.userId });
      }
      return { ok: true, data: { version: res?.version ?? null } };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  @SubscribeMessage('wb:cursor')
  cursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { boardId?: string; layer?: string; x?: number; y?: number },
  ) {
    const data = client.data as SocketData;
    if (!data.sessionId || typeof body?.boardId !== 'string') return;
    if (!data.cursors?.take()) return;
    const s = this.service.getLive(data.sessionId);
    if (!s || s.state.status !== 'ACTIVE') return;
    if (!client.rooms.has(bRoom(body.boardId))) return;
    if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) return;
    client.volatile.to(bRoom(body.boardId)).emit('wb:cursor', {
      boardId: body.boardId,
      layer: typeof body.layer === 'string' ? body.layer.slice(0, 70) : 'q',
      x: Math.round(body.x as number),
      y: Math.round(body.y as number),
      by: data.userId,
    });
  }

  @SubscribeMessage('wb:hand')
  async hand(@ConnectedSocket() client: Socket, @MessageBody() body: { up?: boolean }) {
    const data = client.data as SocketData;
    await data.ready;
    try {
      if (!data.ops?.take()) throw new OpError('Slow down a little.');
      const s = await this.liveFor(data);
      this.service.setHand(s, data.userId as string, !!body?.up);
      await this.broadcastSession(s.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  @SubscribeMessage('wb:control')
  async control(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { action?: string; studentId?: string; boardId?: string; mode?: string; question?: unknown }
  ) {
    const data = client.data as SocketData;
    await data.ready;
    let sessionId: string | null = null;
    try {
      const s = await this.liveFor(data);
      sessionId = s.id;
      const res = await this.service.control(s, data.userId as string, String(body?.action ?? ''), body ?? {});
      if (res.boardIds) {
        // A new question: send the fresh board to everyone who can see it.
        for (const id of res.boardIds) {
          const sockets = await this.server.in(bRoom(id)).fetchSockets();
          for (const sock of sockets) {
            const uid = (sock.data as SocketData).userId as string;
            const view = this.service.boardsFor(s, uid).find((b) => b.id === id);
            if (view) sock.emit('wb:board', view);
          }
        }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    } finally {
      // Always re-apply who may see what from the in-memory state, even if saving
      // the change failed — that state is what the server enforces.
      if (sessionId) await this.resyncRooms(sessionId);
    }
  }

  /** New questions on some boards: send fresh copies to everyone who can see them. */
  async questionsChanged(sessionId: string, boardIds: string[]): Promise<void> {
    const s = this.service.getLive(sessionId);
    if (!s) return;
    for (const id of boardIds) {
      const sockets = await this.server.in(bRoom(id)).fetchSockets();
      for (const sock of sockets) {
        const view = this.service.boardsFor(s, (sock.data as SocketData).userId as string).find((b) => b.id === id);
        if (view) sock.emit('wb:board', view);
      }
    }
  }

  /** A student joined by code: give the tutor their new board and refresh everyone. */
  async studentAdded(sessionId: string): Promise<void> {
    await this.resyncRooms(sessionId);
  }

  /** Called by the controller when the tutor ends the session over REST. */
  async sessionEnded(sessionId: string, session: unknown): Promise<void> {
    const sockets = await this.server.in(sRoom(sessionId)).fetchSockets();
    for (const sock of sockets) {
      sock.emit('wb:ended', session);
      for (const room of sock.rooms) if (room !== sock.id) sock.leave(room);
      (sock.data as SocketData).sessionId = undefined;
    }
  }

  // ---------------------------------------------------------------------------

  private async liveFor(data: SocketData) {
    if (!data.userId || !data.sessionId) throw new OpError('join a session first');
    const s = await this.service.liveOrLoad(data.sessionId);
    if (!s || s.state.status !== 'ACTIVE') throw new OpError('This session has ended');
    return s;
  }

  private async isEmpty(sessionId: string): Promise<boolean> {
    return (await this.server.in(sRoom(sessionId)).fetchSockets()).length === 0;
  }

  private async sweep(): Promise<void> {
    for (const id of this.service.liveSessionIds()) {
      if (await this.isEmpty(id)) await this.service.release(id, () => this.isEmpty(id));
    }
  }

  private async online(sessionId: string): Promise<string[]> {
    const sockets = await this.server.in(sRoom(sessionId)).fetchSockets();
    return [...new Set(sockets.map((x) => (x.data as SocketData).userId as string))];
  }

  private async broadcastSession(sessionId: string): Promise<void> {
    const s = this.service.getLive(sessionId);
    if (!s) return;
    this.server
      .to(sRoom(sessionId))
      .emit('wb:session', { session: this.service.sessionView(s), online: await this.online(sessionId) });
  }

  /**
   * After a control change (mode, lock, present), give each socket exactly the
   * boards it may now see, with fresh write access, and send full copies of any
   * board that has just become visible (e.g. a classmate's work being presented).
   */
  private async resyncRooms(sessionId: string): Promise<void> {
    const s = this.service.getLive(sessionId);
    if (!s) return;
    const sockets = await this.server.in(sRoom(sessionId)).fetchSockets();
    for (const sock of sockets) {
      const uid = (sock.data as SocketData).userId as string;
      const views = this.service.boardsFor(s, uid);
      const visible = new Set(views.map((v) => bRoom(v.id)));
      for (const room of sock.rooms) {
        if (room.startsWith('b:') && !visible.has(room)) {
          sock.leave(room);
          sock.emit('wb:hide', { boardId: room.slice(2) });
        }
      }
      for (const v of views) {
        if (!sock.rooms.has(bRoom(v.id))) {
          sock.join(bRoom(v.id));
          sock.emit('wb:board', v);
        }
      }
      sock.emit('wb:access', Object.fromEntries(views.map((v) => [v.id, v.canWrite])));
    }
    await this.broadcastSession(sessionId);
  }
}

function message(err: unknown): string {
  if (err instanceof OpError) return err.message;
  const e = err as { message?: string; status?: number };
  if (e?.status === 403) return e.message || 'Not allowed';
  if (e?.status === 404) return e.message || 'Not found';
  return 'Something went wrong. Please try again.';
}
