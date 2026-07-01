import { Injectable } from '@nestjs/common';
import { MasteryHistory, MasteryScore, MasteryStatus } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { AIRouterService } from '../ai-router/ai-router.service';
import { MasteryScoreEntity } from './entities/mastery-score.entity';
import { MasteryEngineRepository } from './mastery-engine.repository';
import {
  BKT_DEFAULTS,
  CORRECT_THRESHOLD,
  RECHECK_INTERVAL_DAYS,
  bktUpdate,
  decayedPosterior,
  evaluateGate,
  GateResult,
} from './bkt';

/** Optional per-attempt evidence that feeds the breadth + rigor gate. */
export interface MasteryUpdateOptions {
  /** Authored rigor level (DOK/Bloom 1-4) of the item answered. */
  rigor?: number;
  /** Stable key identifying the application variant (e.g. item id). */
  variantKey?: string;
}

export interface MasteryGate extends GateResult {
  studentId: string;
  skillTag: string;
  pMastered: number;
  status: MasteryStatus;
}

@Injectable()
export class MasteryEngineService {
  constructor(
    private readonly repository: MasteryEngineRepository,
    private readonly eventsService: EventsService,
    private readonly aiRouterService: AIRouterService,
  ) {}

  /**
   * Growth Engine update. Converts a scored response into one Bayesian Knowledge
   * Tracing update of the skill's mastery posterior (guess/slip aware), records
   * attempt-level evidence, and recomputes the three-part mastery gate. A single
   * correct answer nudges the posterior; it cannot, on its own, lock a skill.
   */
  async updateMastery(
    studentId: string,
    skillTag: string,
    rawScore: number,
    maxScore: number,
    submissionId?: string,
    classroomId?: string,
    opts?: MasteryUpdateOptions,
  ): Promise<void> {
    const normalized = this.clampScore(maxScore > 0 ? rawScore / maxScore : 0);
    const correct = normalized >= CORRECT_THRESHOLD;

    const existing = await this.repository.getScoreForSkill(studentId, skillTag);
    const prior = existing ? existing.pMastered : BKT_DEFAULTS.pL0;
    const pMastered = bktUpdate(prior, correct, BKT_DEFAULTS);

    // Persist the new posterior + this attempt's evidence first (provisional
    // status), so the gate is evaluated over history that INCLUDES this response.
    const record = await this.repository.applyUpdate({
      studentId,
      skillTag,
      score: pMastered,
      pMastered,
      correct,
      rigor: opts?.rigor,
      variantKey: opts?.variantKey ?? submissionId,
      pAfter: pMastered,
      submissionId,
      status: MasteryStatus.EMERGING,
      masteredAt: existing?.masteredAt ?? null,
      nextRecheckAt: existing?.nextRecheckAt ?? null,
    });

    // Reconcile the stored lifecycle status with the freshly computed gate, so
    // the label never disagrees with the enforcing signal: a miss that drops the
    // posterior below threshold reopens the skill (MASTERED -> EMERGING) too.
    const gate = await this.computeGate(studentId, skillTag, pMastered);
    const finalStatus = gate.mastered
      ? MasteryStatus.MASTERED
      : MasteryStatus.EMERGING;
    const masteredAt = gate.mastered ? existing?.masteredAt ?? new Date() : null;
    const nextRecheckAt = gate.mastered
      ? existing?.nextRecheckAt ?? this.addDays(new Date(), RECHECK_INTERVAL_DAYS)
      : null;
    await this.repository.updateStatusFields(
      record.id,
      finalStatus,
      masteredAt,
      nextRecheckAt,
    );

    await this.checkAndEmitDrop(studentId, skillTag, classroomId);
  }

  /**
   * The forced-pathway gate for a student + skill: how many more correct
   * opportunities are needed to lock it, and whether it is already mastered.
   * Applies spaced-retention decay lazily on read (a due re-check reopens a
   * previously mastered skill).
   */
  async getMasteryGate(
    studentId: string,
    skillTag: string,
  ): Promise<MasteryGate> {
    let score = await this.repository.getScoreForSkill(studentId, skillTag);
    score = await this.maybeDecay(score);
    const pMastered = score ? score.pMastered : BKT_DEFAULTS.pL0;
    const gate = await this.computeGate(studentId, skillTag, pMastered);
    return {
      ...gate,
      studentId,
      skillTag,
      pMastered,
      status: score?.status ?? MasteryStatus.NOT_STARTED,
    };
  }

  /** Evaluate the three-part gate from stored correct-attempt evidence. */
  private async computeGate(
    studentId: string,
    skillTag: string,
    pMastered: number,
  ): Promise<GateResult> {
    const correctHistory = await this.repository.getCorrectHistory(
      studentId,
      skillTag,
    );
    const variantKeys = new Set<string>();
    const rigorLevels: number[] = [];
    for (const row of correctHistory) {
      if (row.variantKey?.startsWith('lock:')) continue;
      variantKeys.add(row.variantKey ?? row.id);
      if (row.rigor != null) rigorLevels.push(row.rigor);
    }
    return evaluateGate({
      pMastered,
      variantsCorrect: variantKeys.size,
      rigorLevels,
    });
  }

  /** If a mastered skill's re-check is due, decay the posterior and reopen it. */
  private async maybeDecay(
    score: MasteryScore | null,
  ): Promise<MasteryScore | null> {
    if (
      !score ||
      score.status !== MasteryStatus.MASTERED ||
      !score.nextRecheckAt ||
      score.nextRecheckAt > new Date()
    ) {
      return score;
    }
    const decayed = decayedPosterior(score.pMastered, BKT_DEFAULTS);
    return this.repository.applyDecay(
      score.id,
      decayed,
      MasteryStatus.EMERGING,
      null,
    );
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

  async getMasteryForStudent(studentId: string): Promise<MasteryScoreEntity[]> {
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

  async getClassroomOverview(
    classroomId: string,
  ): Promise<MasteryScoreEntity[]> {
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
    const sumXY = scores.reduce((sum, score, index) => sum + index * score, 0);
    const sumX2 = scores.reduce((sum, _, index) => sum + index * index, 0);
    const denominator = n * sumX2 - sumX * sumX;
    return denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
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
      pMastered: score.pMastered,
      status: score.status,
      updatedAt: score.updatedAt,
    };
  }
}
