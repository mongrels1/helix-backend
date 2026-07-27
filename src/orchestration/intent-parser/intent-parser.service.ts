import { Injectable } from '@nestjs/common';
import { AIRouterService } from '../../intelligence/ai-router/ai-router.service';
import {
  OrchestrationAction,
  ParsedIntent,
} from '../types/orchestration.types';

type IntentContext = { classroomId?: string; assignmentId?: string };
type IntentTarget = ParsedIntent['parameters']['target'];

@Injectable()
export class IntentParserService {
  constructor(private readonly aiRouterService: AIRouterService) {}

  async parse(command: string, context: IntentContext): Promise<ParsedIntent> {
    // Deterministic first: the common read-only commands (and the dashboard's
    // suggestion chips) map by keyword, so they resolve instantly and never
    // depend on an AI provider being up or returning perfectly clean JSON.
    const keyword = this.keywordIntent(command, context);
    if (keyword) return keyword;

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
        preferredProvider: 'claude',
      });
      const parsed = JSON.parse(
        this.extractJson(ai.text),
      ) as Partial<ParsedIntent>;
      return this.normalizeParsedIntent(parsed, command, context);
    } catch {
      return this.unknownIntent(command);
    }
  }

  // Maps the common read-only commands (and the dashboard chips) to an intent
  // without calling the LLM. Notification/free-form commands return null and
  // fall through to the AI parser, which can extract a message.
  private keywordIntent(
    command: string,
    context: IntentContext,
  ): ParsedIntent | null {
    const c = command.toLowerCase();
    const make = (
      action: OrchestrationAction,
      target?: IntentTarget,
    ): ParsedIntent => ({
      action,
      confidence: 1,
      parameters: {
        classroomId: context.classroomId,
        assignmentId: context.assignmentId,
        ...(target ? { target } : {}),
      },
      rawCommand: command,
    });

    if (/at[\s-]?risk|struggling|falling behind|needs? help|failing/.test(c)) {
      return make(OrchestrationAction.GET_AT_RISK_STUDENTS, 'AT_RISK');
    }
    if (
      /overdue|not submitted|haven'?t submitted|hasn'?t submitted|missing submission|late submission|who .*(submit|turned in)/.test(
        c,
      )
    ) {
      return make(
        OrchestrationAction.GET_OVERDUE_SUBMISSIONS,
        'MISSING_SUBMISSIONS',
      );
    }
    if (/insight|analyt|analysis|overview|summary|snapshot/.test(c)) {
      return make(OrchestrationAction.GENERATE_INSIGHT);
    }
    return null;
  }

  // Models sometimes wrap JSON in prose or ```json fences despite the
  // instruction; pull out the first {...} block before parsing.
  private extractJson(text: string): string {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? match[0] : text;
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
