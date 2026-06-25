import { Injectable } from '@nestjs/common';
import { MasteryHistory, MasteryScore } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { AIRouterService } from '../ai-router/ai-router.service';
import { MasteryScoreEntity } from './entities/mastery-score.entity';
import { MasteryEngineRepository } from './mastery-engine.repository';

@Injectable()
export class MasteryEngineService {
  constructor(
    private readonly repository: MasteryEngineRepository,
    private readonly eventsService: EventsService,
    private readonly aiRouterService: AIRouterService,
  ) {}

  async updateMastery(
    studentId: string,
    skillTag: string,
    rawScore: number,
    maxScore: number,
    submissionId?: string,
    classroomId?: string,
  ): Promise<void> {
    const normalizedScore = this.clampScore(maxScore > 0 ? rawScore / maxScore : 0);
    await this.repository.upsertScore(
      studentId,
      skillTag,
      normalizedScore,
      submissionId,
    );
    await this.checkAndEmitDrop(studentId, skillTag, classroomId);
  }

  /**
   * Directly flag a skill gap to the pacing / teacher-alert pipeline, bypassing
   * the declining-trend gate in checkAndEmitDrop. Used by the post-diagnostic
   * zero-touch trigger so a single diagnostic gap reaches the teacher's pacing
   * alerts immediately. Emits the same event shape the trend detector uses.
   */
  async flagGapForPacing(params: {
    studentId: string;
    skillTag: string;
    currentScore: number;
    classroomId?: string;
  }): Promise<void> {
    await this.eventsService.emit('mastery.drop.detected', {
      studentId: params.studentId,
      classroomId: params.classroomId,
      skillTag: params.skillTag,
      currentScore: params.currentScore,
      slope: -1,
      insight: `A diagnostic identified a gap in ${params.skillTag}.`,
    });
  }

  async getMasteryForStudent(
    studentId: string,
  ): Promise<MasteryScoreEntity[]> {
    const scores = await this.repository.getAllScoresForStudent(studentId);
    return scores.map((score) => this.toEntity(score));
  }

  async getMasteryDetail(
    studentId: string,
    skillTag: string,
  ): Promise<{ score: MasteryScoreEntity; history: MasteryHistory[] } | null> {
    const score = await this.repository.getScoreForSkill(studentId, skillTag);
    if (!score) return null;

    const history = await this.repository.getRecentHistory(
      studentId,
      skillTag,
      20,
    );
    return { score: this.toEntity(score), history };
  }

  async getClassroomOverview(classroomId: string): Promise<MasteryScoreEntity[]> {
    const scores = await this.repository.getClassroomMastery(classroomId);
    return scores.map((score) => this.toEntity(score));
  }

  private async checkAndEmitDrop(
    studentId: string,
    skillTag: string,
    classroomId?: string,
  ): Promise<void> {
    const history = await this.repository.getRecentHistory(studentId, skillTag, 5);
    if (history.length < 3) return;

    const scores = history.map((item) => item.score);
    const slope = this.calculateSlope([...scores].reverse());
    const currentScore = scores[0];
    if (currentScore >= 0.6 || slope >= -0.05) return;

    let insight = 'Student is showing a declining mastery trend in this skill.';
    try {
      const response = await this.aiRouterService.chat({
        prompt: `Student mastery analysis. Skill: ${skillTag}.
Recent scores (newest first): ${scores.join(', ')}.
Current score: ${currentScore.toFixed(2)}.
Provide a one-sentence insight for the teacher.`,
        maxTokens: 100,
        temperature: 0.3,
      });
      insight = response.text || insight;
    } catch {
      // Fall back to deterministic teacher-facing copy if AI is unavailable.
    }

    await this.eventsService.emit('mastery.drop.detected', {
      studentId,
      classroomId,
      skillTag,
      currentScore,
      slope,
      insight,
    });
  }

  private calculateSlope(scores: number[]): number {
    const n = scores.length;
    const sumX = scores.reduce((sum, _, index) => sum + index, 0);
    const sumY = scores.reduce((sum, score) => sum + score, 0);
    const sumXY = scores.reduce(
      (sum, score, index) => sum + index * score,
      0,
    );
    const sumX2 = scores.reduce((sum, _, index) => sum + index * index, 0);
    const denominator = n * sumX2 - sumX * sumX;
    return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  }

  private clampScore(score: number): number {
    return Math.min(Math.max(score, 0), 1);
  }

  private toEntity(score: MasteryScore): MasteryScoreEntity {
    return {
      id: score.id,
      studentId: score.studentId,
      skillTag: score.skillTag,
      score: score.score,
      updatedAt: score.updatedAt,
    };
  }
}
