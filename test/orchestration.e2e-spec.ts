import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { AIRouterService } from '../src/intelligence/ai-router/ai-router.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrchestrationAction } from '../src/orchestration/types/orchestration.types';

describe('Orchestration endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;

  beforeEach(async () => {
    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      enrollment: {
        findMany: jest.fn().mockResolvedValue([
          { studentId: 'student-1' },
          { studentId: 'student-2' },
        ]),
      },
      attendanceRecord: {
        groupBy: jest.fn().mockResolvedValue([]),
      },
      assignment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      submission: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const aiRouterService = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          text: JSON.stringify({
            action: OrchestrationAction.SEND_NOTIFICATION,
            confidence: 0.95,
            parameters: {
              classroomId: null,
              assignmentId: null,
              message: 'Please submit your work.',
              target: 'ALL_STUDENTS',
            },
          }),
          provider: 'openai',
          tokensUsed: 20,
          latencyMs: 10,
        })
        .mockResolvedValue({
          text: 'I sent the reminder to 2 students.',
          provider: 'openai',
          tokensUsed: 12,
          latencyMs: 8,
        }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(AIRouterService)
      .useValue(aiRouterService)
      .overrideProvider(NotificationsService)
      .useValue({ notify: jest.fn().mockResolvedValue({}) })
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
      sub: 'teacher-1',
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns supported orchestration actions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/orchestration/actions')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.actions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'SEND_NOTIFICATION' }),
            expect.objectContaining({ name: 'GET_AT_RISK_STUDENTS' }),
          ]),
        );
      });
  });

  it('runs a teacher command through the orchestration pipeline', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orchestration/command')
      .set('Authorization', teacherAuthorization)
      .send({
        command: 'Send a reminder to everyone',
        classroomId: 'classroom-1',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.intent).toMatchObject({
          action: OrchestrationAction.SEND_NOTIFICATION,
          parameters: {
            classroomId: 'classroom-1',
            message: 'Please submit your work.',
          },
        });
        expect(response.body.data.result).toMatchObject({
          success: true,
          action: OrchestrationAction.SEND_NOTIFICATION,
          data: { notified: 2 },
          summary: 'I sent the reminder to 2 students.',
        });
      });
  });
});
