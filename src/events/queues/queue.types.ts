export interface SubmissionCreatedJob {
  submissionId: string;
  assignmentId: string;
  studentId: string;
  classroomId: string;
  score?: number;
}

export interface AssignmentOverdueJob {
  assignmentId: string;
  classroomId: string;
}

export interface MasteryDropJob {
  studentId: string;
  classroomId: string;
  skillTag: string;
  currentScore: number;
  slope: number;
  insight: string;
}

export interface AttendanceRiskJob {
  studentId: string;
  classroomId: string;
}

export interface EngagementDropJob {
  studentId: string;
  classroomId: string;
  lessonId?: string;
}
