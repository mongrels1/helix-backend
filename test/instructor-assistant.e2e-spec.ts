import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { InstructorContentType, Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { AIRouterService } from '../src/intelligence/ai-router/ai-router.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Instructor Assistant endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let content: any[];

  const teacherId = 'teacher-1';
  const assignmentId = 'assignment-1';
  const classroomId = 'classroom-1';
  const submissionId = 'submission-1';

  beforeEach(async () => {
    content = [];
    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      assignment: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === assignmentId
              ? {
                  title: 'Essay',
                  dueAt: new Date('2026-06-16T12:00:00.000Z'),
                  maxScore: 100,
                }
              : null,
          ),
        ),
      },
      submission: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === submissionId
              ? {
                  id: submissionId,
                  assignmentId,
                  assignment: { title: 'Essay', maxScore: 100 },
                  grade: { score: 86 },
                }
              : null,
          ),
        ),
      },
      instructorContent: {
        create: jest.fn(({ data }) => {
          const item = {
            id: `content-${content.length + 1}`,
            teacherId: data.teacherId ?? null,
            classroomId: data.classroomId ?? null,
            assignmentId: data.assignmentId ?? null,
            type: data.type,
            content: data.content,
            metadata: data.metadata ?? null,
            dismissed: false,
            dismissedAt: null,
            createdAt: new Date(Date.now() + content.length),
          };
          content.push(item);
          return Promise.resolve(item);
        }),
        findMany: jest.fn(({ where, take }) =>
          Promise.resolve(
            content
              .filter(
                (item) =>
                  item.teacherId === where.teacherId &&
                  item.dismissed === where.dismissed,
              )
              .slice(0, take),
          ),
        ),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(content.find((item) => item.id === where.id) ?? null),
        ),
        update: jest.fn(({ where, data }) => {
          const item = content.find((candidate) => candidate.id === where.id);
          Object.assign(item, data);
          return Promise.resolve(item);
        }),
      },
    };
    const aiRouterService = {
      chat: jest.fn().mockResolvedValue({
        text: 'Generated teacher content',
        provider: 'openai',
        tokensUsed: 20,
        latencyMs: 10,
      }),
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
    teacherAuthorization = `Bearer ${jwtService.sign({
      sub: teacherId,
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
    studentAuthorization = `Bearer ${jwtService.sign({
      sub: 'student-1',
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds for all instructor generation and content routes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/instructor/insights')
      .set('Authorization', teacherAuthorization)
      .send({ assignmentId, classroomId })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.type).toBe(InstructorContentType.INSIGHT);
      });

    await request(app.getHttpServer())
      .post('/api/v1/instructor/warmups')
      .set('Authorization', teacherAuthorization)
      .send({ classroomId, lessonId: 'lesson-1' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.type).toBe(InstructorContentType.WARM_UP);
      });

    await request(app.getHttpServer())
      .post('/api/v1/instructor/rubrics')
      .set('Authorization', teacherAuthorization)
      .send({ assignmentTitle: 'Essay', description: 'Argument', maxScore: 100 })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.type).toBe(
          InstructorContentType.RUBRIC_DRAFT,
        );
      });

    await request(app.getHttpServer())
      .post('/api/v1/instructor/feedback')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.type).toBe(
          InstructorContentType.FEEDBACK_DRAFT,
        );
      });

    await request(app.getHttpServer())
      .get('/api/v1/instructor/content')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(4);
      });

    await request(app.getHttpServer())
      .patch('/api/v1/instructor/content/content-1/dismiss')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.dismissed).toBe(true);
        expect(response.body.data.dismissedAt).toBeTruthy();
      });
  });

  it('blocks students from instructor endpoints', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/instructor/warmups')
      .set('Authorization', studentAuthorization)
      .send({ classroomId })
      .expect(403);
  });
});
