import { Test, TestingModule } from '@nestjs/testing';
import { DomainSynthesizerService } from '../domain-synthesizer/domain-synthesizer.service';
import { OrchestrationAction, ParsedIntent } from '../types/orchestration.types';
import { WorkflowEngineService } from './workflow-engine.service';

describe('WorkflowEngineService', () => {
  let service: WorkflowEngineService;
  let domainSynthesizer: jest.Mocked<DomainSynthesizerService>;

  beforeEach(async () => {
    domainSynthesizer = {
      execute: jest.fn().mockResolvedValue({
        data: { ok: true },
        summary: 'Done.',
      }),
    } as unknown as jest.Mocked<DomainSynthesizerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowEngineService,
        { provide: DomainSynthesizerService, useValue: domainSynthesizer },
      ],
    }).compile();

    service = module.get(WorkflowEngineService);
  });

  it('returns success false when domain execution throws', async () => {
    domainSynthesizer.execute.mockRejectedValue(new Error('Boom'));
    const intent: ParsedIntent = {
      action: OrchestrationAction.SEND_NOTIFICATION,
      confidence: 1,
      parameters: {},
      rawCommand: 'Send',
    };

    await expect(service.run(intent, 'teacher-1')).resolves.toMatchObject({
      success: false,
      action: OrchestrationAction.SEND_NOTIFICATION,
      data: null,
      summary: 'Error: Boom',
    });
  });

  it('marks UNKNOWN action as unsuccessful without throwing', async () => {
    const intent: ParsedIntent = {
      action: OrchestrationAction.UNKNOWN,
      confidence: 0,
      parameters: {},
      rawCommand: 'Unknown',
    };

    await expect(service.run(intent, 'teacher-1')).resolves.toMatchObject({
      success: false,
      action: OrchestrationAction.UNKNOWN,
      summary: 'Done.',
    });
  });
});
