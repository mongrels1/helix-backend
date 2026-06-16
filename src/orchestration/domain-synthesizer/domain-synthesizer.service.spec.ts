import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceStatus } from '@prisma/client';
import { InstructorAssistantService } from '../../intelligence/instructor-assistant/instructor-assistant.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainSynthesizerService } from './domain-synthesizer.service';
import { OrchestrationAction, ParsedIntent } from '../types/orchestration.types';

describe('DomainSynthesizerService', () => {
  let service: DomainSynthesizerService;
  let prisma: any;
  let notificationsService: jest.Mocked<NotificationsService>;
  let instructorAssistantService: jest.Mocked<InstructorAssistantService>;

  beforeEach(async () => {
    prisma = {
      enrollment: {
        findMany: jest.fn().mockResolvedValue([
          { studentId: 'student-1' },
          { studentId: 'student-2' },
        ]),
      },
      attendanceRecord: {
        groupBy: jest.fn().mockResolvedValue([
          { studentId: 'student-1', _count: { _all: 3 } },
        ]),
      },
      assignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'assignment-1',
            title: 'Essay',
            dueAt: new Date('2026-01-01T00:00:00.000Z'),
            classroomId: 'classroom-1',
          },
        ]),
      },
      submission: {
        findMany: jest.fn().mockResolvedValue([{ studentId: 'student-1' }]),
      },
    };
    notificationsService = {
      notify: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<NotificationsService>;
    instructorAssistantService = {
      generateInsight: jest.fn().mockResolvedValue({
        id: 'content-1',
        content: 'Insight text',
      }),
    } as unknown as jest.Mocked<InstructorAssistantService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DomainSynthesizerService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: InstructorAssistantService,
          useValue: instructorAssistantService,
        },
      ],
    }).compile();

    service = module.get(DomainSynthesizerService);
  });

  it('sends notifications for enrolled students', async () => {
    const intent: ParsedIntent = {
      action: OrchestrationAction.SEND_NOTIFICATION,
      confidence: 1,
      parameters: {
        classroomId: 'classroom-1',
        message: 'Please submit your work.',
        target: 'ALL_STUDENTS',
      },
      rawCommand: 'Send reminder',
    };

    await expect(service.execute(intent, 'teacher-1')).resolves.toEqual({
      data: { notified: 2 },
      summary: 'Notification sent to 2 student(s).',
    });
    expect(notificationsService.notify).toHaveBeenCalledTimes(2);
  });

  it('returns at-risk students by absence count', async () => {
    const intent: ParsedIntent = {
      action: OrchestrationAction.GET_AT_RISK_STUDENTS,
      confidence: 1,
      parameters: { classroomId: 'classroom-1' },
      rawCommand: 'Show at risk',
    };

    await expect(service.execute(intent, 'teacher-1')).resolves.toEqual({
      data: {
        atRisk: [{ studentId: 'student-1', absenceCount: 3 }],
        total: 1,
      },
      summary: 'Found 1 at-risk student(s) in this classroom.',
    });
    expect(prisma.attendanceRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classroomId: 'classroom-1',
          status: AttendanceStatus.ABSENT,
        },
      }),
    );
  });

  it('returns graceful guidance for UNKNOWN action', async () => {
    const intent: ParsedIntent = {
      action: OrchestrationAction.UNKNOWN,
      confidence: 0,
      parameters: {},
      rawCommand: 'Dance',
    };

    await expect(service.execute(intent, 'teacher-1')).resolves.toEqual({
      data: null,
      summary:
        'Command not recognized. Try: "Send a reminder to class", "Show at-risk students", or "List overdue submissions".',
    });
  });
});
