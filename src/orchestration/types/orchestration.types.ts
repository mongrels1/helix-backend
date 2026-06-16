export enum OrchestrationAction {
  SEND_NOTIFICATION = 'SEND_NOTIFICATION',
  GET_AT_RISK_STUDENTS = 'GET_AT_RISK_STUDENTS',
  GET_OVERDUE_SUBMISSIONS = 'GET_OVERDUE_SUBMISSIONS',
  GENERATE_INSIGHT = 'GENERATE_INSIGHT',
  UNKNOWN = 'UNKNOWN',
}

export interface ParsedIntent {
  action: OrchestrationAction;
  confidence: number;
  parameters: {
    classroomId?: string;
    assignmentId?: string;
    studentId?: string;
    message?: string;
    target?: 'ALL_STUDENTS' | 'AT_RISK' | 'MISSING_SUBMISSIONS';
  };
  rawCommand: string;
}

export interface WorkflowResult {
  success: boolean;
  action: OrchestrationAction;
  data: unknown;
  summary: string;
  executedAt: Date;
}

export interface OrchestratorResponse {
  intent: ParsedIntent;
  result: WorkflowResult;
}
