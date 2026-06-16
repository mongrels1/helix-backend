import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { AIRouterService } from '../src/intelligence/ai-router/ai-router.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Mastery Engine endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let otherStudentAuthorization: string;

  const now = new Date('2026-06-16T12:00:00.000Z');
  const masteryScores = [
    {
      id: 'mastery-1',
      studentId: 'student-1',
      skillTag: 'fractions',
      score: 0.82,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const history = [
    {
      id: 'history-1',
      masteryScoreId: 'mastery-1',
      score: 0.82,
      submissionId: 'submission-1',
      recordedAt: now,
    },
  ];

  beforeEach(async () => {
    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      masteryScore: {
        findMany: jest.fn(({ where }) => {
          if (where?.studentId) {
            return Promise.resolve(
              masteryScores.filter((score) => score.studentId === where.studentId),
            );
          }
          if (where?.student?.enrollments?.some?.classroomId === 'classroom-1') {
            return Promise.resolve(masteryScores);
          }
          return Promise.resolve([]);
        }),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            masteryScores.find(
              (score) =>
                score.studentId === where.studentId_skillTag.studentId &&
                score.skillTag === where.studentId_skillTag.skillTag,
            ) ?? null,
          ),
        ),
      },
      masteryHistory: {
        findMany: jest.fn(() => Promise.resolve(history)),
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

  it('returns mastery scores for a student and enforces student self access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/mastery/student/student-1')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          success: true,
          data: [
            expect.objectContaining({
              id: 'mastery-1',
              skillTag: 'fractions',
              score: 0.82,
            }),
          ],
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/mastery/student/student-1')
      .set('Authorization', otherStudentAuthorization)
      .expect(403);
  });

  it('returns classroom mastery overview for teachers', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/mastery/classroom/classroom-1')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
      });
  });

  it('returns one skill detail with history', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/mastery/student/student-1/skill/fractions')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.score.skillTag).toBe('fractions');
        expect(response.body.data.history).toHaveLength(1);
      });
  });
});
