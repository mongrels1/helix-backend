import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceStatus, NotificationChannel } from '@prisma/client';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OrchestrationAction,
  ParsedIntent,
} from '../types/orchestration.types';

@Injectable()
export class DomainSynthesizerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly instructorAssistantService: InstructorAssistantService,
  ) {}

  async execute(
    intent: ParsedIntent,
    requestingUserId: string,
  ): Promise<{ data: unknown; summary: string }> {
    switch (intent.action) {
      case OrchestrationAction.SEND_NOTIFICATION:
        return this.sendNotification(intent);
      case OrchestrationAction.GET_AT_RISK_STUDENTS:
        return this.getAtRiskStudents(intent);
      case OrchestrationAction.GET_OVERDUE_SUBMISSIONS:
        return this.getOverdueSubmissions(intent);
      case OrchestrationAction.GENERATE_INSIGHT:
        return this.generateInsight(intent, requestingUserId);
      case OrchestrationAction.UNKNOWN:
        return {
          data: null,
          summary:
            'Command not recognized. Try: "Send a reminder to class", "Show at-risk students", or "List overdue submissions".',
        };
    }
  }

  private async sendNotification(
    intent: ParsedIntent,
  ): Promise<{ data: unknown; summary: string }> {
    const { classroomId, message } = intent.parameters;
    if (!classroomId || !message) {
      throw new BadRequestException('classroomId and message required');
    }

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classroomId },
      select: { studentId: true },
    });
    const studentIds = enrollments.map((enrollment) => enrollment.studentId);

    for (const studentId of studentIds) {
      await this.notificationsService.notify({
        userId: studentId,
        title: 'Teacher Message',
        body: message,
        channel: NotificationChannel.IN_APP,
        metadata: { source: 'orchestration', classroomId },
      });
    }

    return {
      data: { notified: studentIds.length },
      summary: `Notification sent to ${studentIds.length} student(s).`,
    };
  }

  private async getAtRiskStudents(
    intent: ParsedIntent,
  ): Promise<{ data: unknown; summary: string }> {
    const { classroomId } = intent.parameters;
    if (!classroomId) throw new BadRequestException('classroomId required');

    const absences = await this.prisma.attendanceRecord.groupBy({
      by: ['studentId'],
      where: { classroomId, status: AttendanceStatus.ABSENT },
      _count: { _all: true },
      having: { studentId: { _count: { gte: 3 } } },
    });
    const atRisk = absences.map((absence) => ({
      studentId: absence.studentId,
      absenceCount: absence._count._all,
    }));

    return {
      data: { atRisk, total: atRisk.length },
      summary: `Found ${atRisk.length} at-risk student(s) in this classroom.`,
    };
  }

  private async getOverdueSubmissions(
    intent: ParsedIntent,
  ): Promise<{ data: unknown; summary: string }> {
    const { assignmentId, classroomId } = intent.parameters;
    if (!assignmentId && !classroomId) {
      throw new BadRequestException('assignmentId or classroomId required');
    }

    const assignments = await this.prisma.assignment.findMany({
      where: {
        ...(assignmentId ? { id: assignmentId } : { classroomId }),
        dueAt: { lt: new Date() },
        deletedAt: null,
      },
      select: { id: true, title: true, dueAt: true, classroomId: true },
    });

    const assignmentResults = [];
    for (const assignment of assignments) {
      const enrolled = await this.prisma.enrollment.findMany({
        where: { classroomId: assignment.classroomId },
        select: { studentId: true },
      });
      const submitted = await this.prisma.submission.findMany({
        where: { assignmentId: assignment.id },
        select: { studentId: true },
      });
      const submittedIds = new Set(submitted.map((item) => item.studentId));
      const missing = enrolled.filter(
        (enrollment) => !submittedIds.has(enrollment.studentId),
      );
      assignmentResults.push({
        assignment,
        missingCount: missing.length,
      });
    }

    return {
      data: { assignments: assignmentResults },
      summary: `Found overdue submissions across ${assignments.length} assignment(s).`,
    };
  }

  private async generateInsight(
    intent: ParsedIntent,
    requestingUserId: string,
  ): Promise<{ data: unknown; summary: string }> {
    const { classroomId, assignmentId } = intent.parameters;
    if (!classroomId || !assignmentId) {
      throw new BadRequestException('classroomId and assignmentId required');
    }

    const content = await this.instructorAssistantService.generateInsight({
      classroomId,
      assignmentId,
      teacherId: requestingUserId,
    });

    return {
      data: { contentId: content.id, insight: content.content },
      summary: 'AI insight generated and saved to your Instructor content.',
    };
  }
}
