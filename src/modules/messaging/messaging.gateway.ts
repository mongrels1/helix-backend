import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { MessagingService } from './messaging.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class MessagingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly classSessions = new Map<
    string,
    { active: boolean; blockId: string; teacherName: string }
  >();

  constructor(
    private readonly messagingService: MessagingService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string;
      const payload = this.jwtService.verify<{ sub: string }>(token);
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    void client;
    setTimeout(() => {
      for (const [classroomId, session] of this.classSessions.entries()) {
        this.emitClassSession(classroomId, session);
      }
    }, 0);
  }

  @SubscribeMessage('joinThread')
  async handleJoinThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ): Promise<void> {
    const isParticipant = await this.messagingService.isParticipant(
      data.threadId,
      client.data.userId,
    );
    if (isParticipant) {
      await client.join(`thread:${data.threadId}`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string; content: string },
  ): Promise<void> {
    const message = await this.messagingService.sendMessage(
      data.threadId,
      client.data.userId,
      { content: data.content },
    );
    this.server.to(`thread:${data.threadId}`).emit('message.received', message);
  }

  @SubscribeMessage('class:join')
  async handleClassJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { classroomId: string },
  ): Promise<void> {
    await client.join(`class:${data.classroomId}`);
    const existing = this.classSessions.get(data.classroomId);
    if (existing) {
      this.emitClassSession(data.classroomId, existing);
    } else {
      client.emit('class:session', {
        active: false,
        blockId: null,
        teacherName: null,
        attendees: 0,
      });
    }
  }

  @SubscribeMessage('class:start')
  handleClassStart(
    @ConnectedSocket() _client: Socket,
    @MessageBody()
    data: { classroomId: string; blockId: string; teacherName: string },
  ): void {
    const sessionData = {
      active: true,
      blockId: data.blockId,
      teacherName: data.teacherName,
    };
    this.classSessions.set(data.classroomId, sessionData);
    this.emitClassSession(data.classroomId, sessionData);
  }

  @SubscribeMessage('class:navigate')
  handleClassNavigate(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { classroomId: string; blockId: string },
  ): void {
    const existing = this.classSessions.get(data.classroomId);
    if (!existing?.active) return;
    const updated = { ...existing, blockId: data.blockId };
    this.classSessions.set(data.classroomId, updated);
    this.emitClassSession(data.classroomId, updated);
  }

  @SubscribeMessage('class:end')
  handleClassEnd(
    @ConnectedSocket() _client: Socket,
    @MessageBody() data: { classroomId: string },
  ): void {
    this.classSessions.delete(data.classroomId);
    this.server.to(`class:${data.classroomId}`).emit('class:session', {
      active: false,
      blockId: null,
      teacherName: null,
      attendees: 0,
    });
  }

  private emitClassSession(
    classroomId: string,
    session: { active: boolean; blockId: string; teacherName: string },
  ): void {
    const attendees =
      this.server.sockets.adapter.rooms.get(`class:${classroomId}`)?.size ?? 0;
    this.server
      .to(`class:${classroomId}`)
      .emit('class:session', { ...session, attendees });
  }
}
