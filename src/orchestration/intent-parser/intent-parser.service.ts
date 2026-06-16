import { Injectable } from '@nestjs/common';
import { AIRouterService } from '../../intelligence/ai-router/ai-router.service';
import {
  OrchestrationAction,
  ParsedIntent,
} from '../types/orchestration.types';

type IntentContext = { classroomId?: string; assignmentId?: string };

@Injectable()
export class IntentParserService {
  constructor(private readonly aiRouterService: AIRouterService) {}

  async parse(command: string, context: IntentContext): Promise<ParsedIntent> {
    const prompt = `You are an intent parser for a school management system.
Parse the teacher's command into a structured intent.
Supported actions:
- SEND_NOTIFICATION: Send a message or reminder to students
- GET_AT_RISK_STUDENTS: Find students with attendance or mastery problems
- GET_OVERDUE_SUBMISSIONS: Find students who have not submitted an assignment
- GENERATE_INSIGHT: Generate an AI analysis for a classroom or assignment
- UNKNOWN: Command cannot be mapped to a supported action
Context provided by caller:
${context.classroomId ? `classroomId: ${context.classroomId}` : ''}
${context.assignmentId ? `assignmentId: ${context.assignmentId}` : ''}
Command: "${command}"
Respond ONLY with valid JSON, no markdown, no explanation:
{
"action": "ACTION_NAME",
"confidence": 0.0,
"parameters": {
"classroomId": "value or null",
"assignmentId": "value or null",
"message": "extracted notification text or null",
"target": "ALL_STUDENTS or AT_RISK or MISSING_SUBMISSIONS or null"
}
}`;

    try {
      const ai = await this.aiRouterService.chat({
        prompt,
        maxTokens: 200,
        temperature: 0.1,
      });
      return this.normalizeParsedIntent(
        JSON.parse(ai.text) as Partial<ParsedIntent>,
        command,
        context,
      );
    } catch {
      return this.unknownIntent(command);
    }
  }

  private normalizeParsedIntent(
    parsed: Partial<ParsedIntent>,
    rawCommand: string,
    context: IntentContext,
  ): ParsedIntent {
    const action = Object.values(OrchestrationAction).includes(
      parsed.action as OrchestrationAction,
    )
      ? (parsed.action as OrchestrationAction)
      : OrchestrationAction.UNKNOWN;
    const parameters = parsed.parameters ?? {};

    return {
      action,
      confidence:
        typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      parameters: {
        classroomId:
          context.classroomId ??
          this.nullToUndefined(parameters.classroomId as string | null),
        assignmentId:
          context.assignmentId ??
          this.nullToUndefined(parameters.assignmentId as string | null),
        studentId: this.nullToUndefined(parameters.studentId as string | null),
        message: this.nullToUndefined(parameters.message as string | null),
        target: this.nullToUndefined(
          parameters.target as ParsedIntent['parameters']['target'] | null,
        ),
      },
      rawCommand,
    };
  }

  private unknownIntent(rawCommand: string): ParsedIntent {
    return {
      action: OrchestrationAction.UNKNOWN,
      confidence: 0,
      parameters: {},
      rawCommand,
    };
  }

  private nullToUndefined<T>(value: T | null | undefined): T | undefined {
    return value === null ? undefined : value;
  }
}
