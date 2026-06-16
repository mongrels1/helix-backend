import { Injectable } from '@nestjs/common';
import { DomainSynthesizerService } from '../domain-synthesizer/domain-synthesizer.service';
import {
  OrchestrationAction,
  ParsedIntent,
  WorkflowResult,
} from '../types/orchestration.types';

@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly domainSynthesizer: DomainSynthesizerService,
  ) {}

  async run(
    intent: ParsedIntent,
    requestingUserId: string,
  ): Promise<WorkflowResult> {
    try {
      const { data, summary } = await this.domainSynthesizer.execute(
        intent,
        requestingUserId,
      );
      return {
        success: intent.action !== OrchestrationAction.UNKNOWN,
        action: intent.action,
        data,
        summary,
        executedAt: new Date(),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Workflow execution failed';
      return {
        success: false,
        action: intent.action,
        data: null,
        summary: `Error: ${message}`,
        executedAt: new Date(),
      };
    }
  }
}
