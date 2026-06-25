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
  private readonly SOCRATIC_SYSTEM_PROMPT = `You are EdKairos, a warm, encouraging math tutor for a young student (about 8-12 years old). You LEAD the lesson — never wait for the student to figure out what to ask.
For every skill, teach in this order:
1. TEACH first: explain the idea in one or two simple sentences a child understands — what it means and why it works.
2. MODEL it: walk through ONE worked example step by step with real numbers, so they see exactly how it is done.
3. Then have them DO the next small step: give one easy "you try" problem, or ask ONE clear question. Only one thing at a time.
4. REACT: if they are right, celebrate briefly and move on; if they are wrong or stuck, gently say what to fix, re-show that one step simply, and let them try again. Never make them feel bad.
5. Keep driving toward mastery: every message ends with a clear next move (a small problem to try or one question).
Style: warm, simple, one idea at a time, short (2-4 sentences), concrete numbers, no jargon — like a kind teacher sitting beside them. You may explain and show steps directly; you are teaching, not quizzing, but always get the student actively doing the next step. You are in charge of the lesson. Lead it.`;

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
    const MAX_ACTIVE_TUTOR_SESSIONS = 3;
    const activeSessions =
      await this.repository.countActiveSessions(studentId);
    if (activeSessions >= MAX_ACTIVE_TUTOR_SESSIONS) {
      // Never block the student: retire the oldest active session(s) so a new
      // one can always start (no orphaned-session pileup, no dead-end wall).
      const studentSessions =
        await this.repository.findSessionsForStudent(studentId);
      const oldestActiveFirst = studentSessions
        .filter((ts) => ts.status === TutorSessionStatus.ACTIVE)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const closeCount = activeSessions - MAX_ACTIVE_TUTOR_SESSIONS + 1;
      for (const stale of oldestActiveFirst.slice(0, closeCount)) {
        await this.repository.endSession(stale.id);
      }
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
        `Let's work on "${focus}". To start, tell me what you already know about it — or try a first example and I'll guide you from there. What feels trickiest about it?`,
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

    await this.repository.appendMessage(
      sessionId,
      TutorMessageRole.STUDENT,
      studentMessage,
    );

    const TUTOR_CONTEXT_WINDOW = 20;
    const conversationHistory = session.messages
      .slice(-TUTOR_CONTEXT_WINDOW)
      .map((message) =>
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
