import { Test, TestingModule } from '@nestjs/testing';
import { AIRouterService } from '../../intelligence/ai-router/ai-router.service';
import { IntentParserService } from './intent-parser.service';
import { OrchestrationAction } from '../types/orchestration.types';

describe('IntentParserService', () => {
  let service: IntentParserService;
  let aiRouterService: jest.Mocked<AIRouterService>;

  beforeEach(async () => {
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          action: 'SEND_NOTIFICATION',
          confidence: 0.9,
          parameters: {
            classroomId: null,
            assignmentId: null,
            message: 'Please submit your work.',
            target: 'ALL_STUDENTS',
          },
        }),
        provider: 'openai',
        tokensUsed: 12,
        latencyMs: 10,
      }),
    } as unknown as jest.Mocked<AIRouterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentParserService,
        { provide: AIRouterService, useValue: aiRouterService },
      ],
    }).compile();

    service = module.get(IntentParserService);
  });

  it('parses intent and merges caller context', async () => {
    await expect(
      service.parse('Send a reminder', { classroomId: 'classroom-1' }),
    ).resolves.toEqual({
      action: OrchestrationAction.SEND_NOTIFICATION,
      confidence: 0.9,
      parameters: {
        classroomId: 'classroom-1',
        assignmentId: undefined,
        studentId: undefined,
        message: 'Please submit your work.',
        target: 'ALL_STUDENTS',
      },
      rawCommand: 'Send a reminder',
    });
  });

  it('falls back to UNKNOWN when AI parse fails', async () => {
    aiRouterService.chat.mockRejectedValue(new Error('AI unavailable'));

    await expect(service.parse('???', {})).resolves.toEqual({
      action: OrchestrationAction.UNKNOWN,
      confidence: 0,
      parameters: {},
      rawCommand: '???',
    });
  });
});
