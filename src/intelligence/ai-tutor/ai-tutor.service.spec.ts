import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, TutorMessageRole, TutorSessionStatus } from '@prisma/client';
import { AIRouterService } from '../ai-router/ai-router.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AITutorRepository } from './ai-tutor.repository';
import { AITutorService } from './ai-tutor.service';

describe('AITutorService', () => {
  let service: AITutorService;
  let repository: jest.Mocked<AITutorRepository>;
  let aiRouterService: jest.Mocked<AIRouterService>;
  let prisma: any;

  const activeSession = {
    id: 'session-1',
    studentId: 'student-1',
    assignmentId: 'assignment-1',
    status: TutorSessionStatus.ACTIVE,
    createdAt: new Date(),
    endedAt: null,
    messages: [
      {
        id: 'message-1',
        sessionId: 'session-1',
        role: TutorMessageRole.STUDENT,
        content: 'I am stuck',
        createdAt: new Date(),
      },
      {
        id: 'message-2',
        sessionId: 'session-1',
        role: TutorMessageRole.TUTOR,
        content: 'What have you tried?',
        createdAt: new Date(),
      },
    ],
  };

  beforeEach(async () => {
    repository = {
      createSession: jest.fn(),
      findSessionById: jest.fn(),
      findSessionsForStudent: jest.fn(),
      appendMessage: jest.fn(),
      endSession: jest.fn(),
      countActiveSessions: jest.fn(),
    } as unknown as jest.Mocked<AITutorRepository>;
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: 'Nice effort. What is the first smaller step?',
        provider: 'openai',
        tokensUsed: 12,
        latencyMs: 8,
      }),
    } as unknown as jest.Mocked<AIRouterService>;
    prisma = {
      assignment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'assignment-1',
          title: 'Linear Equations',
          description: 'Solve for x.',
          maxScore: 100,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AITutorService,
        { provide: AITutorRepository, useValue: repository },
        { provide: AIRouterService, useValue: aiRouterService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AITutorService);
  });

  it('enforces a maximum of 3 active sessions', async () => {
    repository.countActiveSessions.mockResolvedValue(3);

    await expect(
      service.startSession('student-1', 'assignment-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects missing assignments when starting a session', async () => {
    repository.countActiveSessions.mockResolvedValue(0);
    prisma.assignment.findUnique.mockResolvedValue(null);

    await expect(
      service.startSession('student-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('appends both messages, sends history to AI, and returns tutor reply', async () => {
    repository.findSessionById.mockResolvedValue(activeSession);
    repository.appendMessage
      .mockResolvedValueOnce({
        id: 'message-3',
        sessionId: 'session-1',
        role: TutorMessageRole.STUDENT,
        content: 'How do I start?',
        createdAt: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'message-4',
        sessionId: 'session-1',
        role: TutorMessageRole.TUTOR,
        content: 'Nice effort. What is the first smaller step?',
        createdAt: new Date(),
      });

    await expect(
      service.sendMessage('session-1', 'How do I start?', 'student-1'),
    ).resolves.toMatchObject({
      role: TutorMessageRole.TUTOR,
      content: 'Nice effort. What is the first smaller step?',
    });

    expect(repository.appendMessage).toHaveBeenNthCalledWith(
      1,
      'session-1',
      TutorMessageRole.STUDENT,
      'How do I start?',
    );
    expect(repository.appendMessage).toHaveBeenNthCalledWith(
      2,
      'session-1',
      TutorMessageRole.TUTOR,
      'Nice effort. What is the first smaller step?',
    );
    expect(aiRouterService.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'How do I start?',
        messages: [
          { role: 'user', content: 'I am stuck' },
          { role: 'assistant', content: 'What have you tried?' },
        ],
        maxTokens: 200,
        temperature: 0.6,
      }),
    );
  });

  it('uses Socratic fallback when AI fails', async () => {
    repository.findSessionById.mockResolvedValue(activeSession);
    aiRouterService.chat.mockRejectedValue(new Error('No provider'));
    repository.appendMessage.mockResolvedValue({
      id: 'message-4',
      sessionId: 'session-1',
      role: TutorMessageRole.TUTOR,
      content:
        "That's an interesting question. What do you already know about this topic?",
      createdAt: new Date(),
    });

    await service.sendMessage('session-1', 'Just tell me', 'student-1');

    expect(repository.appendMessage).toHaveBeenLastCalledWith(
      'session-1',
      TutorMessageRole.TUTOR,
      "That's an interesting question. What do you already know about this topic?",
    );
  });

  it('enforces message limit', async () => {
    repository.findSessionById.mockResolvedValue({
      ...activeSession,
      messages: Array.from({ length: 40 }, (_, index) => ({
        id: `message-${index}`,
        sessionId: 'session-1',
        role: TutorMessageRole.STUDENT,
        content: 'Hello',
        createdAt: new Date(),
      })),
    });

    await expect(
      service.sendMessage('session-1', 'More help', 'student-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects messages for ended sessions', async () => {
    repository.findSessionById.mockResolvedValue({
      ...activeSession,
      status: TutorSessionStatus.ENDED,
    });

    await expect(
      service.sendMessage('session-1', 'More help', 'student-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents one student from accessing another student session', async () => {
    repository.findSessionById.mockResolvedValue(activeSession);

    await expect(
      service.getSession('session-1', 'student-2', Role.STUDENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
