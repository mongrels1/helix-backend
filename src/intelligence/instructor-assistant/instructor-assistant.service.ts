import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InstructorContent, InstructorContentType } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InstructorAssistantRepository } from './instructor-assistant.repository';

@Injectable()
export class InstructorAssistantService {
  constructor(
    private readonly repository: InstructorAssistantRepository,
    private readonly aiRouterService: AIRouterService,
    private readonly prisma: PrismaService,
  ) {}

  async generateInsight(params: {
    classroomId: string;
    assignmentId: string;
    teacherId?: string;
  }): Promise<InstructorContent> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: params.assignmentId },
      select: { title: true, dueAt: true, maxScore: true },
    });
    const prompt = `You are an educational analyst helping a teacher understand why students
may have missed a deadline.
Assignment: "${assignment?.title ?? 'Unknown'}"
Due: ${assignment?.dueAt?.toISOString() ?? 'unknown'}
Max score: ${assignment?.maxScore ?? 'unknown'}
Write 2-3 sentences: likely reasons students missed this deadline,
and one specific actionable suggestion for the teacher.`;
    const content = await this.generateText(
      prompt,
      150,
      0.4,
      'Students may need a deadline reminder. Consider sending a follow-up message with the submission link.',
    );

    return this.repository.create({
      type: InstructorContentType.INSIGHT,
      content,
      teacherId: params.teacherId,
      classroomId: params.classroomId,
      assignmentId: params.assignmentId,
      metadata: { source: 'assignment.overdue' },
    });
  }

  async generateWarmUp(params: {
    classroomId: string;
    lessonId?: string;
    teacherId?: string;
  }): Promise<InstructorContent> {
    const prompt = `You are a curriculum designer.
Generate a 5-minute no-materials warm-up activity for a classroom.
${params.lessonId ? `Lesson context ID: ${params.lessonId}` : ''}
The activity should engage students immediately and activate prior knowledge.
Format: a short title, then 3-4 step instructions.`;
    const content = await this.generateText(
      prompt,
      200,
      0.7,
      'Think-Pair-Share: Ask students to spend 2 minutes writing one thing they remember from last class, then share with a partner.',
    );

    return this.repository.create({
      type: InstructorContentType.WARM_UP,
      content,
      teacherId: params.teacherId,
      classroomId: params.classroomId,
      metadata: { source: 'engagement.drop', lessonId: params.lessonId },
    });
  }

  async generateRubric(params: {
    assignmentTitle: string;
    description?: string;
    maxScore: number;
    teacherId: string;
    assignmentId?: string;
  }): Promise<InstructorContent> {
    const prompt = `You are a curriculum designer creating a grading rubric.
Assignment: "${params.assignmentTitle}"
${params.description ? `Description: ${params.description}` : ''}
Total points: ${params.maxScore}
Create 3-5 rubric criteria. For each criterion provide:
- Criterion name
- Points allocated
- Excellent performance description (1 sentence)
- Needs improvement description (1 sentence)
Format as a numbered list. Keep it concise and practical.`;
    const content = await this.generateText(
      prompt,
      400,
      0.4,
      'Unable to generate rubric at this time. Please try again shortly.',
    );

    return this.repository.create({
      type: InstructorContentType.RUBRIC_DRAFT,
      content,
      teacherId: params.teacherId,
      assignmentId: params.assignmentId,
      metadata: {
        assignmentTitle: params.assignmentTitle,
        maxScore: params.maxScore,
      },
    });
  }

  async generateFeedback(params: {
    submissionId: string;
    teacherId: string;
  }): Promise<InstructorContent> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: params.submissionId },
      include: {
        assignment: { select: { title: true, maxScore: true } },
        grade: { select: { score: true } },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    const prompt = `You are a teacher writing constructive feedback for a student.
Assignment: "${submission.assignment.title}"
Score: ${submission.grade?.score ?? 'not yet graded'} / ${submission.assignment.maxScore}
Write 3-4 sentences of encouraging, specific, actionable feedback.
Do not mention the numeric score. Focus on effort, strengths, and
one concrete improvement suggestion.`;
    const content = await this.generateText(
      prompt,
      180,
      0.5,
      'Good effort on this assignment. Review the assignment criteria and consider where you could strengthen your response.',
    );

    return this.repository.create({
      type: InstructorContentType.FEEDBACK_DRAFT,
      content,
      teacherId: params.teacherId,
      assignmentId: submission.assignmentId,
      metadata: { submissionId: params.submissionId },
    });
  }

  async getContentForTeacher(teacherId: string): Promise<InstructorContent[]> {
    return this.repository.findForTeacher(teacherId);
  }

  async dismissContent(
    id: string,
    requestingUserId: string,
  ): Promise<InstructorContent> {
    const item = await this.repository.findById(id);
    if (!item) throw new NotFoundException('Content not found');
    if (item.teacherId && item.teacherId !== requestingUserId) {
      throw new ForbiddenException();
    }
    return this.repository.dismiss(id);
  }

  private async generateText(
    prompt: string,
    maxTokens: number,
    temperature: number,
    fallback: string,
  ): Promise<string> {
    try {
      const ai = await this.aiRouterService.chat({
        prompt,
        maxTokens,
        temperature,
      });
      return ai.text || fallback;
    } catch {
      return fallback;
    }
  }
}
