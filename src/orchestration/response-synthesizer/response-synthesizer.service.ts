import { Injectable } from '@nestjs/common';
import { AIRouterService } from '../../intelligence/ai-router/ai-router.service';
import { OrchestrationAction, WorkflowResult } from '../types/orchestration.types';

@Injectable()
export class ResponseSynthesizerService {
  constructor(private readonly aiRouterService: AIRouterService) {}

  async synthesize(result: WorkflowResult): Promise<string> {
    if (!result.success || result.action === OrchestrationAction.UNKNOWN) {
      return result.summary;
    }

    try {
      const ai = await this.aiRouterService.chat({
        prompt: `Summarize this system action result in one friendly, professional sentence
for a teacher. Action: ${result.action}. Result: ${result.summary}.
Data: ${JSON.stringify(result.data)}.`,
        maxTokens: 80,
        temperature: 0.3,
      });
      return ai.text || result.summary;
    } catch {
      return result.summary;
    }
  }
}
