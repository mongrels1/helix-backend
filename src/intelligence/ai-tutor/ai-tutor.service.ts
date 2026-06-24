import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  TutorMessage,
  TutorMessageRole,
  TutorSession,
  TutorSessionStatus,
} from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { ConversationMessage } from '../ai-router/ai-router.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AITutorRepository,
  TutorSessionWithMessages,
} from './ai-tutor.repository';

@Injectable()
export class AITutorService {
  private readonly SOCRATIC_SYSTEM_PROMPT = `You are a Socratic tutor.
Your role is to guide students to discover answers themselves.
Rules you must never break:
1. Never give the direct answer to any problem.
2. Always respond with a guiding question or a small hint.
3. Break complex problems into smaller steps through questions.
4. Keep responses to 2-3 sentences maximum.
5. If the student seems frustrated (words like "I don't know", "just tell me", "I give up"), offer one small hint and ask a follow-up question.
6. Acknowledge effort positively before asking the next question.`;

  constructor(
    private readonly repository: AITutorRepository,
    private readonly aiRouterService: AIRouterService,
    private readonly prisma: PrismaService,
  ) {}

  async startSession(
    studentId: string,
    assignmentId?: string,
    topic?: string,
  ): Promise<TutorSession> {
    const activeSessions = await this.repository.countActiveSessions(studentId);
    if (activeSessions >= 3) {
      throw new BadRequestException(
        'Maximum 3 active tutoring sessions allowed at once.',
      );
    }

    if (assignmentId) {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
      });
      if (!assignment) throw new NotFoundException('Assignment not found');
    }

    const session = await this.repository.createSession(studentId, assignmentId);

    // When launched from a diagnostic gap, seed a focused Socratic opener so the
    // AI tutor starts teaching that exact skill immediately. Stored as the first
    // message, so it shows on load and the topic carries through the context.
    const focus = topic?.trim();
    if (focus) {
      await this.repository.appendMessage(
        session.id,
        TutorMessageRole.TUTOR,
        `Let's work on **${focus}**. To start, tell me what you already know about it — or try a first example and I'll guide you from there. What feels trickiest about it?`,
      );
    }

    return session;
  }

  async sendMessage(
    sessionId: string,
    studentMessage: string,
    requestingUserId: string,
  ): Promise<TutorMessage> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) throw new NotFoundException('Tutor session not found');
    if (requestingUserId !== session.studentId) {
      throw new ForbiddenException('You can only message your own tutor session');
    }
    if (session.status === TutorSessionStatus.ENDED) {
      throw new BadRequestException('Tutor session has ended');
    }
    if (session.messages.length >= 40) {
      throw new BadRequestException(
        'Session message limit reached. Please start a new session.',
      );
    }

    await this.repository.appendMessage(
      sessionId,
      TutorMessageRole.STUDENT,
      studentMessage,
    );

    const conversationHistory = session.messages.map((message) =>
      this.toConversationMessage(message),
    );
    const contextNote = await this.getAssignmentContext(session.assignmentId);
    const aiText = await this.getTutorReply(
      studentMessage,
      conversationHistory,
      contextNote,
    );

    return this.repository.appendMessage(
      sessionId,
      TutorMessageRole.TUTOR,
      aiText,
    );
  }

  async getSession(
    sessionId: string,
    requestingUserId: string,
    requestingUserRole: string,
  ): Promise<TutorSessionWithMessages> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) throw new NotFoundException('Tutor session not found');
    if (
      requestingUserRole === Role.STUDENT &&
      requestingUserId !== session.studentId
    ) {
      throw new ForbiddenException('You can only view your own tutor session');
    }
    return session;
  }

  async getSessionsForStudent(studentId: string): Promise<TutorSession[]> {
    return this.repository.findSessionsForStudent(studentId);
  }

  async endSession(
    sessionId: string,
    requestingUserId: string,
  ): Promise<TutorSession> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) throw new NotFoundException('Tutor session not found');
    if (requestingUserId !== session.studentId) {
      throw new ForbiddenException('Only the owning student may end this session');
    }
    return this.repository.endSession(sessionId);
  }

  private async getAssignmentContext(
    assignmentId: string | null,
  ): Promise<string> {
    if (!assignmentId) return '';
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { title: true, description: true, maxScore: true },
    });
    return assignment
      ? `Assignment context: "${assignment.title}". ${assignment.description ?? ''}`
      : '';
  }

  private async getTutorReply(
    studentMessage: string,
    conversationHistory: ConversationMessage[],
    contextNote: string,
  ): Promise<string> {
    try {
      const ai = await this.aiRouterService.chat({
        prompt: studentMessage,
        messages: conversationHistory,
        systemPrompt: `${this.SOCRATIC_SYSTEM_PROMPT}\n\n${contextNote}`.trim(),
        maxTokens: 200,
        temperature: 0.6,
      });
      return ai.text;
    } catch {
      return "That's an interesting question. What do you already know about this topic?";
    }
  }

  private toConversationMessage(message: TutorMessage): ConversationMessage {
    return {
      role: message.role === TutorMessageRole.STUDENT ? 'user' : 'assistant',
      content: message.content,
    };
  }
}
