import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InstructorContentType } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InstructorAssistantRepository } from './instructor-assistant.repository';
import { InstructorAssistantService } from './instructor-assistant.service';

describe('InstructorAssistantService', () => {
  let service: InstructorAssistantService;
  let repository: jest.Mocked<InstructorAssistantRepository>;
  let aiRouterService: jest.Mocked<AIRouterService>;
  let prisma: any;

  beforeEach(async () => {
    repository = {
      create: jest.fn((data) =>
        Promise.resolve({
          id: 'content-1',
          teacherId: data.teacherId ?? null,
          classroomId: data.classroomId ?? null,
          assignmentId: data.assignmentId ?? null,
          type: data.type,
          content: data.content,
          metadata: data.metadata ?? null,
          dismissed: false,
          dismissedAt: null,
          createdAt: new Date(),
        }),
      ),
      findForTeacher: jest.fn(),
      findById: jest.fn(),
      dismiss: jest.fn(),
    } as unknown as jest.Mocked<InstructorAssistantRepository>;
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: 'Generated teacher content',
        provider: 'openai',
        tokensUsed: 20,
        latencyMs: 10,
      }),
    } as unknown as jest.Mocked<AIRouterService>;
    prisma = {
      assignment: {
        findUnique: jest.fn().mockResolvedValue({
          title: 'Essay',
          dueAt: new Date('2026-06-16T12:00:00.000Z'),
          maxScore: 100,
        }),
      },
      submission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission-1',
          assignmentId: 'assignment-1',
          assignment: { title: 'Essay', maxScore: 100 },
          grade: { score: 86 },
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstructorAssistantService,
        { provide: InstructorAssistantRepository, useValue: repository },
        { provide: AIRouterService, useValue: aiRouterService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(InstructorAssistantService);
  });

  it('generates and persists insight content', async () => {
    await service.generateInsight({
      classroomId: 'classroom-1',
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InstructorContentType.INSIGHT,
        content: 'Generated teacher content',
        teacherId: 'teacher-1',
        classroomId: 'classroom-1',
        assignmentId: 'assignment-1',
      }),
    );
  });

  it('generates and persists warm-up content', async () => {
    await service.generateWarmUp({
      classroomId: 'classroom-1',
      lessonId: 'lesson-1',
      teacherId: 'teacher-1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InstructorContentType.WARM_UP,
        content: 'Generated teacher content',
        classroomId: 'classroom-1',
      }),
    );
  });

  it('generates and persists rubric draft content', async () => {
    await service.generateRubric({
      assignmentTitle: 'Essay',
      description: 'Write an argument.',
      maxScore: 100,
      teacherId: 'teacher-1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InstructorContentType.RUBRIC_DRAFT,
        content: 'Generated teacher content',
        teacherId: 'teacher-1',
      }),
    );
  });

  it('generates and persists feedback draft content', async () => {
    await service.generateFeedback({
      submissionId: 'submission-1',
      teacherId: 'teacher-1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InstructorContentType.FEEDBACK_DRAFT,
        content: 'Generated teacher content',
        teacherId: 'teacher-1',
        assignmentId: 'assignment-1',
      }),
    );
  });

  it('uses fallback content when AI is unavailable', async () => {
    aiRouterService.chat.mockRejectedValue(new Error('No provider'));

    await service.generateRubric({
      assignmentTitle: 'Essay',
      maxScore: 100,
      teacherId: 'teacher-1',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Unable to generate rubric at this time. Please try again shortly.',
      }),
    );
  });

  it('throws when feedback submission is missing', async () => {
    prisma.submission.findUnique.mockResolvedValue(null);

    await expect(
      service.generateFeedback({
        submissionId: 'missing',
        teacherId: 'teacher-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents teachers from dismissing another teacher content', async () => {
    repository.findById.mockResolvedValue({
      id: 'content-1',
      teacherId: 'teacher-2',
      classroomId: null,
      assignmentId: null,
      type: InstructorContentType.INSIGHT,
      content: 'Content',
      metadata: null,
      dismissed: false,
      dismissedAt: null,
      createdAt: new Date(),
    });

    await expect(
      service.dismissContent('content-1', 'teacher-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
