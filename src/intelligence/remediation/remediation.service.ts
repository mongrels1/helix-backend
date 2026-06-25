import { Injectable } from '@nestjs/common';
import { InstructorAssistantService } from '../instructor-assistant/instructor-assistant.service';
import { MasteryEngineService } from '../mastery-engine/mastery-engine.service';
import {
  CalibratedItem,
  DIAGNOSTIC_ITEM_BANK,
  findCalibratedItemsForKc,
} from './diagnostic-item-bank';
import { StartRemediationDto } from './dto/start-remediation.dto';
import { SubmitRecheckDto } from './dto/submit-recheck.dto';

/** Mastery threshold a re-check must clear to count a gap as resolved. */
const MASTERY_THRESHOLD = 0.6;
/** Max calibrated items to serve in one re-check. */
const RECHECK_ITEM_LIMIT = 3;

interface CheckItem {
  id: string;
  question: string;
  options: string[];
  /** AI/formative path only — bank items never leak the key to the client. */
  answer?: number;
  solution?: string;
}

export interface RemediationLesson {
  kc: string;
  lesson: unknown;
  check: {
    source: 'bank' | 'ai';
    /** True when the check is AI-generated (formative, not calibrated). */
    formative: boolean;
    items: CheckItem[];
  };
}

export interface RecheckResult {
  kc: string;
  source: 'bank' | 'ai';
  correct: number;
  total: number;
  score: number;
  resolved: boolean;
  /** Whether the result was graded against the calibrated bank (measurement-valid). */
  calibrated: boolean;
  /** Whether the mastery engine accepted the update. */
  masteryUpdated: boolean;
}

/**
 * The teach -> re-check loop. Reuses the existing course-content generator for the
 * mini-lesson and the mastery engine for the feedback rail. Bank-first: a calibrated
 * (server-graded) re-check where the 89-item bank covers the KC, AI-generated
 * (formative) otherwise.
 */
@Injectable()
export class RemediationService {
  constructor(
    private readonly instructor: InstructorAssistantService,
    private readonly mastery: MasteryEngineService,
  ) {}

  /** Build a targeted mini-lesson + the matching re-check for a single gap KC. */
  async buildLesson(dto: StartRemediationDto): Promise<RemediationLesson> {
    const kc = dto.kc.trim();
    const mini = await this.instructor.generateMiniLesson({
      kc,
      grade: dto.grade,
    });

    let lesson: unknown;
    try {
      lesson = JSON.parse(mini.lessonContent);
    } catch {
      lesson = mini.lessonContent;
    }

    // Bank-first: calibrated items keep the re-check measurement-valid.
    const calibrated = findCalibratedItemsForKc(kc, RECHECK_ITEM_LIMIT);
    if (calibrated.length > 0) {
      return {
        kc,
        lesson,
        check: {
          source: 'bank',
          formative: false,
          // Never send the correct index for the scored path.
          items: calibrated.map((item: CalibratedItem) => ({
            id: item.id,
            question: item.stem,
            options: item.options,
          })),
        },
      };
    }

    // Fallback: AI-generated check. Formative only — includes the key so the
    // lesson view can reveal the solution after the student answers.
    let quiz: Array<{
      question?: string;
      options?: string[];
      answer?: number;
      solution?: string;
    }> = [];
    try {
      const parsed = JSON.parse(mini.quizContent);
      if (Array.isArray(parsed)) quiz = parsed;
    } catch {
      quiz = [];
    }

    return {
      kc,
      lesson,
      check: {
        source: 'ai',
        formative: true,
        items: quiz
          .filter((q) => q.question && Array.isArray(q.options))
          .slice(0, RECHECK_ITEM_LIMIT)
          .map((q, index) => ({
            id: `ai-${index}`,
            question: q.question as string,
            options: q.options as string[],
            answer: typeof q.answer === 'number' ? q.answer : 0,
            solution: q.solution,
          })),
      },
    };
  }

  /**
   * Grade a submitted re-check and feed the result back into the mastery engine —
   * the same rail the diagnostic uses. Best-effort: a mastery failure never throws.
   */
  async recordRecheck(
    studentId: string,
    dto: SubmitRecheckDto,
  ): Promise<RecheckResult> {
    const kc = dto.kc.trim();
    const total = dto.responses.length;
    let correct = 0;

    if (dto.source === 'bank') {
      // Authoritative: grade against the calibrated bank by item id.
      for (const response of dto.responses) {
        const item = DIAGNOSTIC_ITEM_BANK.find((i) => i.id === response.id);
        if (item && item.correct === response.choice) correct += 1;
      }
    } else {
      // Formative: each response carries the AI key; compare against the pick.
      for (const response of dto.responses) {
        if (
          typeof response.answer === 'number' &&
          response.answer === response.choice
        ) {
          correct += 1;
        }
      }
    }

    const score = total > 0 ? correct / total : 0;

    let masteryUpdated = false;
    if (total > 0) {
      try {
        await this.mastery.updateMastery(
          studentId,
          kc,
          correct,
          total,
          undefined,
          dto.classroomId,
        );
        masteryUpdated = true;
      } catch {
        // Best-effort, exactly like the diagnostic -> mastery sync.
      }
    }

    return {
      kc,
      source: dto.source,
      correct,
      total,
      score,
      resolved: score >= MASTERY_THRESHOLD,
      calibrated: dto.source === 'bank',
      masteryUpdated,
    };
  }
}
