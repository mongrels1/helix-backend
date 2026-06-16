import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, TutorMessageRole, TutorSessionStatus } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { AIRouterService } from '../src/intelligence/ai-router/ai-router.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AI Tutor endpoints', () => {
  let app: INestApplication;
  let studentAuthorization: string;
  let teacherAuthorization: string;
  let otherStudentAuthorization: string;
  let sessions: any[];
  let messages: any[];
  let aiRouterService: { chat: jest.Mock };

  const assignmentId = 'assignment-1';
  const sessionId = 'session-1';
  const studentId = 'student-1';

  const withMessages = (session: any) => ({
    ...session,
    messages: messages
      .filter((message) => message.sessionId === session.id)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
  });

  beforeEach(async () => {
    sessions = [];
    messages = [];
    aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: 'Good effort. What do you notice first?',
        provider: 'openai',
        tokensUsed: 12,
        latencyMs: 8,
      }),
    };

    let prismaMock: any;
    prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      assignment: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === assignmentId
              ? {
                  id: assignmentId,
                  title: 'Equation Practice',
                  description: 'Solve for x.',
                  maxScore: 100,
                }
              : null,
          ),
        ),
      },
      tutorSession: {
        create: jest.fn(({ data }) => {
          const session = {
            id: sessionId,
            studentId: data.studentId,
            assignmentId: data.assignmentId ?? null,
            status: TutorSessionStatus.ACTIVE,
            createdAt: new Date(),
            endedAt: null,
          };
          sessions.push(session);
          return Promise.resolve(session);
        }),
        findUnique: jest.fn(({ where }) => {
          const session =
            sessions.find((candidate) => candidate.id === where.id) ?? null;
          return Promise.resolve(session ? withMessages(session) : null);
        }),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            sessions
              .filter((session) => session.studentId === where.studentId)
              .sort(
                (left, right) =>
                  right.createdAt.getTime() - left.createdAt.getTime(),
              ),
          ),
        ),
        update: jest.fn(({ where, data }) => {
          const session = sessions.find((candidate) => candidate.id === where.id);
          Object.assign(session, data);
          return Promise.resolve(session);
        }),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            sessions.filter(
              (session) =>
                session.studentId === where.studentId &&
                session.status === where.status,
            ).length,
          ),
        ),
      },
      tutorMessage: {
        create: jest.fn(({ data }) => {
          const message = {
            id: `message-${messages.length + 1}`,
            sessionId: data.sessionId,
            role: data.role,
            content: data.content,
            createdAt: new Date(Date.now() + messages.length),
          };
          messages.push(message);
          return Promise.resolve(message);
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(AIRouterService)
      .useValue(aiRouterService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const jwtService = moduleFixture.get(JwtService);
    studentAuthorization = `Bearer ${jwtService.sign({
      sub: studentId,
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
    otherStudentAuthorization = `Bearer ${jwtService.sign({
      sub: 'student-2',
      email: 'other@example.com',
      role: Role.STUDENT,
    })}`;
    teacherAuthorization = `Bearer ${jwtService.sign({
      sub: 'teacher-1',
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('supports the full student tutor session flow', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tutor/sessions')
      .set('Authorization', studentAuthorization)
      .send({ assignmentId })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          id: sessionId,
          studentId,
          assignmentId,
          status: TutorSessionStatus.ACTIVE,
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/tutor/sessions')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/tutor/sessions/${sessionId}/messages`)
      .set('Authorization', studentAuthorization)
      .send({ content: 'How do I start?' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          role: TutorMessageRole.TUTOR,
          content: 'Good effort. What do you notice first?',
        });
      });

    expect(aiRouterService.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'How do I start?',
        messages: [],
        maxTokens: 200,
        temperature: 0.6,
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/tutor/sessions/${sessionId}`)
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.messages).toHaveLength(2);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/tutor/sessions/${sessionId}/end`)
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe(TutorSessionStatus.ENDED);
        expect(response.body.data.endedAt).toBeTruthy();
      });
  });

  it('allows teachers to list a student sessions by query parameter', async () => {
    sessions.push({
      id: sessionId,
      studentId,
      assignmentId: null,
      status: TutorSessionStatus.ACTIVE,
      createdAt: new Date(),
      endedAt: null,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/tutor/sessions?studentId=${studentId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
      });
  });

  it('blocks cross-student session access', async () => {
    sessions.push({
      id: sessionId,
      studentId,
      assignmentId: null,
      status: TutorSessionStatus.ACTIVE,
      createdAt: new Date(),
      endedAt: null,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/tutor/sessions/${sessionId}`)
      .set('Authorization', otherStudentAuthorization)
      .expect(403);
  });
});
