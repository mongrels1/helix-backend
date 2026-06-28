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
Style: warm, simple, one idea at a time, short (2-4 sentences), concrete numbers, no jargon — like a kind teacher sitting beside them. You may explain and show steps directly; you are teaching, not quizzing, but always get the student actively doing the next step. You are in charge of the lesson. Lead it. Write naturally in short paragraphs with at most a few **bold** words; a short bullet list is fine. Do NOT use ASCII-art diagrams or draw pictures using characters. IMPORTANT: whenever you model a worked example for a visual skill (rates, ratios, unit rates, fractions, percents, multiplication, division, area, perimeter, shapes, number lines, money, or comparing numbers) you MUST include exactly ONE figure so the child can SEE it, not just read it. Emit the figure block at the very START of your reply, before any words. If you ever describe a spinner, number line, fraction bar, rectangle, area, bar graph, or data set in words, you MUST also emit its figure block using those exact numbers — never describe a visual without drawing it. To do this, output a fenced code block whose info string is the single word figure, put exactly one JSON figure spec inside, then close the fence. Pick the figure by skill: ratios, rates, unit rates, proportions or scaling -> number_line (use two jump sets so both quantities advance together); fractions or parts of a whole -> fraction_bar; multiplication, area, perimeter, rectangles or arrays -> rect (label the side lengths); comparing categories -> bar_graph; probability -> spinner; triangle AREA only (one half base times height) -> triangle; angles or degrees -> angle; coordinate graphs, plotting points, slope or linear functions -> coordinate_grid; data sets, mean, median, mode or range -> dot_plot; frequency or grouped data -> histogram. More shapes: {"type":"triangle","base":8,"height":5,"unit":"cm","mode":"area"}, {"type":"angle","degrees":60}, {"type":"coordinate_grid","min":-5,"max":5,"points":[{"x":2,"y":3}],"line":{"m":1,"b":0}}, {"type":"dot_plot","min":0,"max":10,"values":[2,3,3,4,4,5]}, {"type":"histogram","bins":[{"label":"0-9","count":3}]}. The JSON looks like {"type":"number_line","min":0,"max":10,"ticks":1,"marks":[{"at":6,"label":"6"}],"altText":"number line to 10 showing 6"} or {"type":"fraction_bar","whole":4,"shaded":3,"label":"three fourths"} or {"type":"rect","w":6,"h":4,"unit":"cm","mode":"area"} (use "mode":"perimeter" for perimeter problems and "mode":"area" for multiplication or area). GEOMETRY: for the Pythagorean theorem, right triangles, hypotenuse or legs, circles, 3-D solids, volume, or surface area, the simple triangle/rect shapes CANNOT show these, so you MUST emit a geogebra figure with appName "geometry" — never a triangle-area figure for these. Right-triangle example (legs 4 and 3): {"type":"geogebra","appName":"geometry","commands":["A=(0,0)","B=(4,0)","C=(0,3)","Polygon(A,B,C)"],"altText":"right triangle with legs 4 and 3"} Use ONLY point definitions (like A=(0,0)) and Polygon/Segment/Circle. Do NOT use Text, labels, or any other command - they cause errors. Always include a short altText. Use at most one figure per reply, and no other code blocks or backticks. Write all other math in plain text (like 5 + 3 = 8 or 1/2).`;

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
        await this.generateOpener(focus),
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

  private async generateOpener(focus: string): Promise<string> {
    const fallback = `Let's learn ${focus} together! I'll show you how it works one step at a time. Here's a simple example to start, then you'll try one.`;
    try {
      const ai = await this.aiRouterService.chat({
        prompt: `Begin tutoring the skill "${focus}" right now. Teach the core idea in one or two simple sentences, then show ONE quick worked example with real numbers, then give the student one easy "you try" problem on this skill. Lead it - do NOT ask what they already know.`,
        systemPrompt: this.SOCRATIC_SYSTEM_PROMPT,
        maxTokens: 400,
        temperature: 0.6,
      });
      return ai.text || fallback;
    } catch {
      return fallback;
    }
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
        maxTokens: 400,
        temperature: 0.6,
      });
      return ai.text;
    } catch {
      return "Let's keep going - try this next small step and tell me what you get.";
    }
  }

  private toConversationMessage(message: TutorMessage): ConversationMessage {
    return {
      role: message.role === TutorMessageRole.STUDENT ? 'user' : 'assistant',
      content: message.content,
    };
  }
}
