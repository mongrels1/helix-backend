import { Injectable, NotFoundException } from '@nestjs/common';
import { PacingRecommendation, PacingTrigger, PacingType } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PacingEngineRepository } from './pacing-engine.repository';

type ParsedRecommendation = {
  type: PacingType;
  rationale: string;
  action: string;
};

@Injectable()
export class PacingEngineService {
  constructor(
    private readonly repository: PacingEngineRepository,
    private readonly aiRouterService: AIRouterService,
  ) {}

  async adjust(payload: {
    studentId: string;
    classroomId: string;
    skillTag: string;
    currentScore: number;
    slope: number;
    insight?: string;
  }): Promise<void> {
    const fallback: ParsedRecommendation = {
      type: PacingType.SLOW_DOWN,
      rationale: 'Student mastery is below threshold and declining.',
      action: 'Review recent assignment feedback with the student.',
    };
    const prompt = `You are an educational pacing advisor. A student has a mastery drop.
Skill: ${payload.skillTag}
Current score: ${(payload.currentScore * 100).toFixed(0)}%
Trend slope: ${payload.slope.toFixed(3)} (negative = declining)
Context: ${payload.insight ?? 'No additional context.'}
Respond in this exact JSON format (no markdown):
{
"type": "SLOW_DOWN" | "REMEDIATE" | "SKIP_AHEAD" | "STANDARD",
"rationale": "One sentence explaining why.",
"action": "One specific action the teacher should take."
}`;

    const recommendation = await this.generateRecommendation(prompt, fallback);
    await this.repository.createRecommendation({
      studentId: payload.studentId,
      classroomId: payload.classroomId,
      trigger: PacingTrigger.MASTERY_DROP,
      type: recommendation.type,
      rationale: recommendation.rationale,
      action: recommendation.action,
    });
  }

  async adjustLesson(payload: {
    studentId: string;
    classroomId: string;
    lessonId?: string;
  }): Promise<void> {
    const fallback: ParsedRecommendation = {
      type: PacingType.STANDARD,
      rationale: 'Student engagement has dropped.',
      action: 'Check in with the student at the start of the next lesson.',
    };
    const prompt = `A student's engagement has dropped.
Lesson: ${payload.lessonId ?? 'unknown'}
Respond in this exact JSON format (no markdown):
{
"type": "SLOW_DOWN" | "REMEDIATE" | "SKIP_AHEAD" | "STANDARD",
"rationale": "One sentence explaining why.",
"action": "One specific action the teacher should take."
}`;

    const recommendation = await this.generateRecommendation(prompt, fallback);
    await this.repository.createRecommendation({
      studentId: payload.studentId,
      classroomId: payload.classroomId,
      trigger: PacingTrigger.ENGAGEMENT_DROP,
      type: recommendation.type,
      rationale: recommendation.rationale,
      action: recommendation.action,
    });
  }

  async getRecommendationsForStudent(
    studentId: string,
  ): Promise<PacingRecommendation[]> {
    return this.repository.getActiveForStudent(studentId);
  }

  async getRecommendationsForClassroom(
    classroomId: string,
  ): Promise<PacingRecommendation[]> {
    return this.repository.getActiveForClassroom(classroomId);
  }

  async dismissRecommendation(
    id: string,
    requestingUserId: string,
  ): Promise<PacingRecommendation> {
    void requestingUserId;
    const recommendation = await this.repository.findById(id);
    if (!recommendation) throw new NotFoundException('Pacing recommendation not found');
    return this.repository.dismiss(id);
  }

  private async generateRecommendation(
    prompt: string,
    fallback: ParsedRecommendation,
  ): Promise<ParsedRecommendation> {
    try {
      const ai = await this.aiRouterService.chat({
        prompt,
        maxTokens: 150,
        temperature: 0.3,
      });
      return this.parseRecommendation(ai.text, fallback);
    } catch {
      return fallback;
    }
  }

  private parseRecommendation(
    text: string,
    fallback: ParsedRecommendation,
  ): ParsedRecommendation {
    try {
      const parsed = JSON.parse(text) as Partial<ParsedRecommendation>;
      if (
        !parsed.type ||
        !Object.values(PacingType).includes(parsed.type) ||
        !parsed.rationale ||
        !parsed.action
      ) {
        return fallback;
      }
      return {
        type: parsed.type,
        rationale: parsed.rationale,
        action: parsed.action,
      };
    } catch {
      return fallback;
    }
  }
}
