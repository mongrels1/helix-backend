import { Test, TestingModule } from '@nestjs/testing';
import { PacingTrigger, PacingType } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PacingEngineRepository } from './pacing-engine.repository';
import { PacingEngineService } from './pacing-engine.service';

describe('PacingEngineService', () => {
  let service: PacingEngineService;
  let repository: jest.Mocked<PacingEngineRepository>;
  let aiRouterService: jest.Mocked<AIRouterService>;

  beforeEach(async () => {
    repository = {
      createRecommendation: jest.fn(),
      getActiveForStudent: jest.fn(),
      getActiveForClassroom: jest.fn(),
      dismiss: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<PacingEngineRepository>;
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          type: 'REMEDIATE',
          rationale: 'The student needs targeted practice.',
          action: 'Assign a short review activity.',
        }),
        provider: 'openai',
        tokensUsed: 20,
        latencyMs: 10,
      }),
    } as unknown as jest.Mocked<AIRouterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PacingEngineService,
        { provide: PacingEngineRepository, useValue: repository },
        { provide: AIRouterService, useValue: aiRouterService },
      ],
    }).compile();

    service = module.get(PacingEngineService);
  });

  it('adjust creates a mastery-drop pacing recommendation', async () => {
    await service.adjust({
      studentId: 'student-1',
      classroomId: 'classroom-1',
      skillTag: 'fractions',
      currentScore: 0.45,
      slope: -0.1,
      insight: 'Teacher insight',
    });

    expect(repository.createRecommendation).toHaveBeenCalledWith({
      studentId: 'student-1',
      classroomId: 'classroom-1',
      trigger: PacingTrigger.MASTERY_DROP,
      type: PacingType.REMEDIATE,
      rationale: 'The student needs targeted practice.',
      action: 'Assign a short review activity.',
    });
  });

  it('adjustLesson creates an engagement-drop pacing recommendation', async () => {
    await service.adjustLesson({
      studentId: 'student-1',
      classroomId: 'classroom-1',
      lessonId: 'lesson-1',
    });

    expect(repository.createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        classroomId: 'classroom-1',
        trigger: PacingTrigger.ENGAGEMENT_DROP,
        type: PacingType.REMEDIATE,
      }),
    );
  });

  it('uses fallback values when AI returns malformed JSON', async () => {
    aiRouterService.chat.mockResolvedValue({
      text: 'not json',
      provider: 'openai',
      tokensUsed: 1,
      latencyMs: 10,
    });

    await service.adjust({
      studentId: 'student-1',
      classroomId: 'classroom-1',
      skillTag: 'fractions',
      currentScore: 0.45,
      slope: -0.1,
    });

    expect(repository.createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PacingType.SLOW_DOWN,
        rationale: 'Student mastery is below threshold and declining.',
        action: 'Review recent assignment feedback with the student.',
      }),
    );
  });
});
