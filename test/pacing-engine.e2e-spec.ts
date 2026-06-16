import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PacingTrigger, PacingType, Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { AIRouterService } from '../src/intelligence/ai-router/ai-router.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Pacing Engine endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let otherStudentAuthorization: string;
  let recommendations: any[];

  const now = new Date('2026-06-16T13:00:00.000Z');

  beforeEach(async () => {
    recommendations = [
      {
        id: 'pacing-1',
        studentId: 'student-1',
        classroomId: 'classroom-1',
        trigger: PacingTrigger.MASTERY_DROP,
        type: PacingType.REMEDIATE,
        rationale: 'Needs targeted review.',
        action: 'Assign a short practice set.',
        dismissed: false,
        dismissedAt: null,
        createdAt: now,
      },
    ];
    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      pacingRecommendation: {
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            recommendations.filter(
              (recommendation) =>
                recommendation.dismissed === where.dismissed &&
                (!where.studentId ||
                  recommendation.studentId === where.studentId) &&
                (!where.classroomId ||
                  recommendation.classroomId === where.classroomId),
            ),
          ),
        ),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            recommendations.find(
              (recommendation) => recommendation.id === where.id,
            ) ?? null,
          ),
        ),
        update: jest.fn(({ where, data }) => {
          const recommendation = recommendations.find(
            (candidate) => candidate.id === where.id,
          );
          Object.assign(recommendation, data);
          return Promise.resolve(recommendation);
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(AIRouterService)
      .useValue({ chat: jest.fn() })
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
    studentAuthorization = `Bearer ${jwtService.sign({
      sub: 'student-1',
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
    otherStudentAuthorization = `Bearer ${jwtService.sign({
      sub: 'student-2',
      email: 'other@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns active recommendations for a student and enforces self access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/pacing/student/student-1')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.recommendations).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .get('/api/v1/pacing/student/student-1')
      .set('Authorization', otherStudentAuthorization)
      .expect(403);
  });

  it('returns active classroom recommendations for teachers', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/pacing/classroom/classroom-1')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.recommendations[0]).toMatchObject({
          id: 'pacing-1',
          studentId: 'student-1',
        });
      });
  });

  it('dismisses recommendations for teachers', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/pacing/pacing-1/dismiss')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.dismissed).toBe(true);
        expect(response.body.data.dismissedAt).toBeTruthy();
      });
  });
});
