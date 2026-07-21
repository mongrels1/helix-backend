import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Message, Role, Thread } from '@prisma/client';
import { CreateThreadDto } from './dto/create-thread.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagingRepository, RecipientResult } from './messaging.repository';

@Injectable()
export class MessagingService {
  constructor(private readonly messagingRepository: MessagingRepository) {}

  async getMyThreads(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Thread[];
    meta: { page: number; limit: number; total: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [threads, total] = await this.messagingRepository.findThreadsByUser(
      userId,
      normalizedPage,
      normalizedLimit,
    );
    return {
      data: threads,
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  async getThread(threadId: string, requestingUserId: string): Promise<Thread> {
    const thread = await this.messagingRepository.findThreadById(threadId);
    if (!thread) throw new NotFoundException('Thread not found');
    const participant = await this.messagingRepository.isParticipant(
      threadId,
      requestingUserId,
    );
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this thread');
    }
    return thread;
  }

  async createThread(
    dto: CreateThreadDto,
    creatorId: string,
  ): Promise<Thread> {
    const participantIds = [...new Set([creatorId, ...dto.participantIds])];
    return this.messagingRepository.createThread(dto.subject, participantIds);
  }

  async sendMessage(
    threadId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    const participant = await this.messagingRepository.isParticipant(
      threadId,
      senderId,
    );
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this thread');
    }
    return this.messagingRepository.addMessage(threadId, senderId, dto.content);
  }

  async getMessages(
    threadId: string,
    requestingUserId: string,
    page = 1,
    limit = 50,
  ): Promise<{
    data: Message[];
    meta: { page: number; limit: number; total: number };
  }> {
    const participant = await this.messagingRepository.isParticipant(
      threadId,
      requestingUserId,
    );
    if (!participant) {
      throw new ForbiddenException('You are not a participant in this thread');
    }
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [messages, total] = await this.messagingRepository.getMessages(
      threadId,
      normalizedPage,
      normalizedLimit,
    );
    return {
      data: messages,
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  async isParticipant(threadId: string, userId: string): Promise<boolean> {
    return this.messagingRepository.isParticipant(threadId, userId);
  }

  async searchRecipients(
    user: { userId: string; role: Role },
    query: string,
  ): Promise<RecipientResult[]> {
    if (user.role === Role.TEACHER) {
      return this.messagingRepository.searchTeacherRecipients(user.userId, query);
    }
    if (user.role === Role.ORG_ADMIN || user.role === Role.SUPER_ADMIN) {
      return this.messagingRepository.searchAllRecipients(query, user.userId);
    }
    // Students/parents don't get a directory search yet.
    return [];
  }
}
