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
import { ConfigService } from '@nestjs/config';
import { AIRouterService } from '../ai-router/ai-router.service';
import { ConversationMessage } from '../ai-router/ai-router.types';
import { figureIsSane } from '../item-generation/reliability-gate';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AITutorRepository,
  TutorSessionWithMessages,
} from './ai-tutor.repository';

@Injectable()
export class AITutorService {
  private readonly SOCRATIC_SYSTEM_PROMPT = `You are EdKairos, a warm, encouraging math tutor for a young student (about 8-12 years old). You LEAD the lesson — never wait for the student to figure out what to ask.
How you make the student feel (this matters as much as the math): the student must always feel safe making mistakes with you. When they are wrong, treat it as useful information — "Nice — that mistake shows us exactly what to practice" — never as failure, and never with sarcasm or a talking-down tone. Praise the specific thing they DID ("you lined the units up carefully"), not their ability ("you're so smart"). When they are stuck or frustrated, slow down, make the next step smaller, and gently remind them they can do this. Celebrate real effort and progress warmly and specifically. Many of these students have been made to feel bad at math — be the voice that changes that. But stay a warm DEMANDER: kindness never means doing the thinking for them or giving hollow praise — keep them actively working the next step, just with total patience and genuine belief in them.
For every skill, teach in this order:
1. TEACH first: explain the idea in one or two simple sentences a child understands — what it means and why it works.
2. MODEL it: walk through ONE worked example step by step with real numbers, so they see exactly how it is done.
3. Then have them DO the next small step: give one easy "you try" problem, or ask ONE clear question. Only one thing at a time.
4. REACT: if they are right, celebrate briefly and move on; if they are wrong or stuck, gently say what to fix, re-show that one step simply, and let them try again. Never make them feel bad.
5. Keep driving toward mastery: every message ends with a clear next move (a small problem to try or one question).
Style: warm, simple, one idea at a time, short (2-4 sentences), concrete numbers, no jargon — like a kind teacher sitting beside them. You may explain and show steps directly; you are teaching, not quizzing, but always get the student actively doing the next step. You are in charge of the lesson. Lead it. Write naturally in short paragraphs with at most a few **bold** words; a short bullet list is fine. When you show a worked example, walk it through the Pólya way — Understand, Plan, Solve, Check — as a short LINE-BY-LINE flow, never buried inside a sentence. Lead each of the four with its bold word on its own line, in kid-friendly language: **Understand** — one short line saying what we know and what we want; **Plan** — one short line naming the move we will make; **Solve** — put the starting equation on its own line, then each computation step on its own NEW line (one "=" per line), then the answer on its own line; **Check** — one short line that plugs the answer back in or sanity-checks it. Every equation goes on its own NEW line (real line breaks), with your warm words on separate short lines. Keep the whole thing brief — one clean pass, not a wall of text. Do NOT use ASCII-art diagrams or draw pictures using characters. IMPORTANT: whenever you model a worked example for a visual skill (rates, ratios, unit rates, fractions, percents, multiplication, division, area, perimeter, shapes, number lines, money, or comparing numbers) you MUST include exactly ONE figure so the child can SEE it, not just read it. Emit the figure block at the very START of your reply, before any words. If you ever describe a spinner, number line, fraction bar, rectangle, area, bar graph, or data set in words, you MUST also emit its figure block using those exact numbers — never describe a visual without drawing it. To do this, output a fenced code block whose info string is the single word figure, put exactly one JSON figure spec inside, then close the fence. Pick the figure by skill: ratios, rates, unit rates, proportions or scaling -> number_line (use two jump sets so both quantities advance together); fractions or parts of a whole -> fraction_bar; multiplication, area, perimeter, rectangles or arrays -> rect (label the side lengths); comparing categories -> bar_graph; probability -> spinner; triangle AREA only (one half base times height) -> triangle; angles or degrees -> angle; coordinate graphs, plotting points, slope or linear functions -> coordinate_grid; data sets, mean, median, mode or range -> dot_plot; frequency or grouped data -> histogram. More shapes: {"type":"triangle","base":8,"height":5,"unit":"cm","mode":"area"}, {"type":"angle","degrees":60}, {"type":"coordinate_grid","min":-5,"max":5,"points":[{"x":2,"y":3}],"line":{"m":1,"b":0}}, {"type":"dot_plot","min":0,"max":10,"values":[2,3,3,4,4,5]}, {"type":"histogram","bins":[{"label":"0-9","count":3}]}. The JSON looks like {"type":"number_line","min":0,"max":10,"ticks":1,"marks":[{"at":6,"label":"6"}],"altText":"number line to 10 showing 6"} or {"type":"fraction_bar","whole":4,"shaded":3,"label":"three fourths"} or {"type":"rect","w":6,"h":4,"unit":"cm","mode":"area"} (use "mode":"perimeter" for perimeter problems and "mode":"area" for multiplication or area). GEOMETRY & 3-D SOLIDS: use these EXACT deterministic figure types (each draws itself correctly from its numbers) — NEVER a geogebra figure, and never a flat triangle/rect for a 3-D solid. Right triangle / Pythagorean (a = horizontal leg, b = vertical leg, labelC = the unknown side): {"type":"right_triangle","a":4,"b":3,"labelA":"4","labelB":"3","labelC":"x"}. Rectangular prism / box volume: {"type":"rect_prism","l":5,"w":4,"h":3,"lLabel":"5 units","wLabel":"4 units","hLabel":"3 units"}. Cylinder: {"type":"cylinder","r":3,"h":10,"rLabel":"3 cm","hLabel":"10 cm"}. Cone: {"type":"cone","r":4,"h":9,"rLabel":"4 cm","hLabel":"9 cm"}. Sphere: {"type":"sphere","r":5,"rLabel":"5 cm"}. Triangular prism: {"type":"tri_prism","b":6,"h":4,"len":10,"bLabel":"6 cm","hLabel":"4 cm","lenLabel":"10 cm"}. Circle: {"type":"circle","r":5,"show":"radius","label":"5 cm"}. Always use THIS problem's numbers and include a short altText. Use at most one figure per reply, and no other code blocks or backticks. Write all other math in plain text (like 5 + 3 = 8 or 1/2).`;

  constructor(
    private readonly repository: AITutorRepository,
    private readonly aiRouterService: AIRouterService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
      const gradeLevel = await this.resolveStudentGrade(studentId);
      await this.repository.appendMessage(
        session.id,
        TutorMessageRole.TUTOR,
        await this.generateOpener(focus, gradeLevel),
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
    // Fair-use cap: monthly per-student tutoring-message limit (0 = disabled).
    const monthlyCap = this.config.get<number>('tutor.monthlyMessageCap') ?? 0;
    if (monthlyCap > 0) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const used = await this.repository.countStudentMessagesSince(session.studentId, monthStart);
      if (used >= monthlyCap) {
        throw new ForbiddenException({
          error: { code: 'tutor_limit_reached', message: 'Monthly tutoring limit reached for this plan. Resets at the start of next month.' },
        });
      }
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
    const gradeLevel = await this.resolveStudentGrade(session.studentId);
    const aiText = await this.getTutorReply(
      studentMessage,
      conversationHistory,
      contextNote,
      gradeLevel,
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

  async getUsageReport(): Promise<Array<{ studentId: string; name: string; email: string; messagesThisMonth: number; cap: number; over: boolean; pct: number | null }>> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cap = this.config.get<number>('tutor.monthlyMessageCap') ?? 0;
    const grouped = await this.prisma.tutorMessage.groupBy({ by: ['sessionId'], where: { role: TutorMessageRole.STUDENT, createdAt: { gte: monthStart } }, _count: true });
    if (!grouped.length) return [];
    const sessions = await this.prisma.tutorSession.findMany({ where: { id: { in: grouped.map((g) => g.sessionId) } }, select: { id: true, studentId: true, student: { select: { email: true, profile: { select: { firstName: true, lastName: true } } } } } });
    const byId = new Map(sessions.map((se) => [se.id, se]));
    const per = new Map<string, { studentId: string; name: string; email: string; messagesThisMonth: number }>();
    for (const g of grouped) {
      const se = byId.get(g.sessionId); if (!se) continue;
      const e = per.get(se.studentId) ?? { studentId: se.studentId, name: [se.student.profile?.firstName, se.student.profile?.lastName].filter(Boolean).join(' ') || se.student.email, email: se.student.email, messagesThisMonth: 0 };
      e.messagesThisMonth += g._count; per.set(se.studentId, e);
    }
    return [...per.values()].map((e) => ({ ...e, cap, over: cap > 0 && e.messagesThisMonth >= cap, pct: cap > 0 ? Math.round((e.messagesThisMonth / cap) * 100) : null })).sort((a, b) => b.messagesThisMonth - a.messagesThisMonth);
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

  private async generateOpener(
    focus: string,
    gradeLevel?: number,
  ): Promise<string> {
    const fallback = `Let's learn ${focus} together! I will show you one step at a time. Here is an easy example. Then you try one.`;
    try {
      const ai = await this.aiRouterService.chat({
        prompt: `Begin tutoring the skill "${focus}" right now. Teach the core idea in ONE simple sentence, then show ONE quick worked example with real numbers, then give the student one easy "you try" problem on this skill. Lead it - do NOT ask what they already know.`,
        systemPrompt: this.buildSystemPrompt(gradeLevel),
        maxTokens: 400,
        temperature: 0.6,
      });
      return this.enforceReadability(
        this.sanitizeReplyFigure(ai.text || fallback),
        gradeLevel,
      );
    } catch {
      return fallback;
    }
  }
  private async getTutorReply(
    studentMessage: string,
    conversationHistory: ConversationMessage[],
    contextNote: string,
    gradeLevel?: number,
  ): Promise<string> {
    try {
      const ai = await this.aiRouterService.chat({
        prompt: studentMessage,
        messages: conversationHistory,
        systemPrompt: this.buildSystemPrompt(gradeLevel, contextNote),
        maxTokens: 400,
        temperature: 0.6,
      });
      return this.enforceReadability(
        this.sanitizeReplyFigure(ai.text),
        gradeLevel,
      );
    } catch {
      return "Let's keep going - try this next small step and tell me what you get.";
    }
  }

  /**
   * Strip a mismatched or malformed figure from a tutor reply using the SAME
   * check the item generator uses (reliability-gate.figureIsSane) — a wrong
   * picture (e.g. a 10x6 area model on a $20 / 25%-off lesson) is worse than
   * none. Shared validator, not a parallel guard; sound figures and geogebra
   * blocks are left untouched.
   */
  private sanitizeReplyFigure(text: string): string {
    if (!text || !text.includes('```figure')) return text;
    const match = text.match(/```figure\s*([\s\S]*?)```/);
    if (!match) return text;
    const spec = match[1].trim();
    const prose = text.replace(match[0], ' ');
    // geogebra figures are deprecated for the tutor — the model can't reliably
    // author their commands (they render as garbage), so drop them. Otherwise
    // use the shared figure-sanity check.
    const isGeogebra = /"type"\s*:\s*"geogebra"/.test(spec);
    if (!isGeogebra && figureIsSane(spec, prose).ok) return text;
    return text.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Grade-aware reading-level directive prepended to the tutor system prompt.
   * Reading load is a first-class validity/usability threat for young or
   * struggling readers: text that exceeds their decoding fluency silently
   * turns a MATH interaction into a READING one (EdKairos methodology §2.5,
   * §3.7). Defaults to a low (grade 2-3) reading level when grade is unknown —
   * writing simpler never hurts a stronger reader, but writing above a weak
   * reader's level does real harm.
   */
  private readingLevelDirective(gradeLevel?: number): string {
    const g =
      typeof gradeLevel === 'number' && Number.isFinite(gradeLevel)
        ? gradeLevel
        : undefined;
    let band: string;
    let maxWords: number;
    if (g === undefined) {
      band = 'a grade 2-3';
      maxWords = 10;
    } else if (g <= 1) {
      band = 'a kindergarten-to-grade-1';
      maxWords = 7;
    } else if (g <= 3) {
      band = 'a grade 2';
      maxWords = 9;
    } else if (g <= 5) {
      band = 'a grade 3';
      maxWords = 11;
    } else {
      band = 'a grade 4';
      maxWords = 13;
    }
    return [
      `READ-ALOUD-FRIENDLY LANGUAGE (this is your most important rule). This student may not read well yet, and your words may be read aloud to them. Write EVERYTHING at ${band} reading level.`,
      `- One idea per sentence. Keep sentences short — aim for ${maxWords} words or fewer. Never write a long or many-part sentence.`,
      `- Use plain, everyday words. The FIRST time you use any math word (like "tenths", "digit", "column", "denominator"), give a tiny plain meaning right after it — e.g. "the tenths spot (the first spot after the dot)".`,
      `- Do ONE small step, then STOP and ask one short question to check they got it, before the next step. Never put two steps in one turn.`,
      `- Keep the whole reply very short. Fewer words is always better. If you are unsure how simple to make it, make it simpler.`,
      `- Prefer SHOWING with the figure over explaining in words: a picture the child can see beats a sentence they must read.`,
    ].join('\n');
  }

  /** Full system prompt = grade-aware reading-level directive + the core
   * teaching/figure prompt + any per-session context note. */
  private buildSystemPrompt(gradeLevel?: number, contextNote = ''): string {
    return [
      this.readingLevelDirective(gradeLevel),
      this.SOCRATIC_SYSTEM_PROMPT,
      contextNote,
    ]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  /** Best-effort grade signal: the grade recorded on the student's most recent
   * diagnostic session (`DiagnosticSession.grade` is a free-form string like
   * "4", "Grade 4", or "K"). Returns undefined when unknown, so callers fall
   * back to a safe low reading level. */
  private async resolveStudentGrade(
    studentId: string,
  ): Promise<number | undefined> {
    try {
      const d = await this.prisma.diagnosticSession.findFirst({
        where: { userId: studentId, grade: { not: null } },
        orderBy: { completedAt: 'desc' },
        select: { grade: true },
      });
      return this.parseGrade(d?.grade);
    } catch {
      return undefined;
    }
  }

  private parseGrade(raw?: string | null): number | undefined {
    if (!raw) return undefined;
    const s = raw.trim().toLowerCase();
    if (s.startsWith('k') || s.includes('kinder')) return 0;
    const m = s.match(/\d{1,2}/);
    if (!m) return undefined;
    const n = parseInt(m[0], 10);
    return Number.isFinite(n) && n >= 0 && n <= 12 ? n : undefined;
  }

  /**
   * Soft ceiling on reading load. If a PROSE-ONLY reply (no figure/code block)
   * runs long or contains an over-long sentence for the grade, ask the model
   * once to rewrite it shorter and simpler. Replies that already carry a
   * figure are left untouched — they are visual, not a wall of text, and we
   * never want to risk dropping the figure block. Cost is bounded: at most one
   * extra call, and only on an actual breach.
   */
  private async enforceReadability(
    text: string,
    gradeLevel?: number,
  ): Promise<string> {
    if (!text || text.includes('```')) return text;
    const g = typeof gradeLevel === 'number' ? gradeLevel : 3;
    const maxSentenceWords = g <= 1 ? 10 : g <= 3 ? 12 : g <= 5 ? 15 : 18;
    const maxTotalWords = g <= 1 ? 45 : g <= 3 ? 60 : g <= 5 ? 80 : 95;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const totalWords = text.trim().split(/\s+/).filter(Boolean).length;
    const longest = sentences.reduce(
      (m, s) => Math.max(m, s.trim().split(/\s+/).filter(Boolean).length),
      0,
    );
    if (totalWords <= maxTotalWords && longest <= maxSentenceWords) return text;
    try {
      const ai = await this.aiRouterService.chat({
        prompt: `Rewrite the tutor message below so a young, struggling reader can read it. Keep the SAME math, steps, numbers, warmth, and final question. Rules: one idea per sentence; every sentence ${maxSentenceWords} words or fewer; keep it under ${maxTotalWords} words total; plain everyday words. Return ONLY the rewritten message, nothing else.\n\nMessage:\n${text}`,
        systemPrompt:
          'You simplify a math tutor message for a young or struggling reader without changing its meaning, math, steps, or next question. Output only the rewritten message.',
        maxTokens: 300,
        temperature: 0.3,
      });
      return ai.text?.trim() || text;
    } catch {
      return text;
    }
  }

  private toConversationMessage(message: TutorMessage): ConversationMessage {
    return {
      role: message.role === TutorMessageRole.STUDENT ? 'user' : 'assistant',
      content: message.content,
    };
  }
}
