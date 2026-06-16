import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, SubmissionStatus } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { MasteryEngineService } from '../src/intelligence/mastery-engine/mastery-engine.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Grades endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let masteryEngineService: { updateMastery: jest.Mock };
  let submissions: any[];
  let grades: any[];
  let histories: any[];

  const assignmentId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const submissionId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const draftSubmissionId = 'cccccccc-3333-4333-8333-cccccccccccc';
  const gradeId = 'dddddddd-4444-4444-8444-dddddddddddd';
  const studentId = 'student-1';

  const withHistory = (grade: any) => ({
    ...grade,
    history: histories
      .filter((history) => history.gradeId === grade.id)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    submission: submissions.find((submission) => submission.id === grade.submissionId),
  });

  beforeEach(async () => {
    masteryEngineService = {
      updateMastery: jest.fn().mockResolvedValue(undefined),
    };
    submissions = [
      {
        id: submissionId,
        assignmentId,
        studentId,
        status: SubmissionStatus.SUBMITTED,
        content: 'Work',
        fileUrl: null,
        submittedAt: new Date(),
        assignment: {
          id: assignmentId,
          classroomId: 'classroom-1',
          maxScore: 100,
          skillTags: ['fractions'],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: draftSubmissionId,
        assignmentId,
        studentId,
        status: SubmissionStatus.DRAFT,
        content: 'Draft',
        fileUrl: null,
        submittedAt: null,
        assignment: {
          id: assignmentId,
          classroomId: 'classroom-1',
          maxScore: 100,
          skillTags: ['fractions'],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    grades = [];
    histories = [];

    let prismaMock: any;
    prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((arg: any): Promise<any> =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock),
      ),
      submission: {
        findMany: jest.fn(() => Promise.resolve(submissions)),
        count: jest.fn(() => Promise.resolve(submissions.length)),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            submissions.find((submission) => submission.id === where.id) ?? null,
          ),
        ),
        update: jest.fn(({ where, data }) => {
          const submission = submissions.find(
            (candidate) => candidate.id === where.id,
          );
          Object.assign(submission, data, { updatedAt: new Date() });
          return Promise.resolve(submission);
        }),
      },
      grade: {
        findUnique: jest.fn(({ where }) => {
          const grade = where.id
            ? grades.find((candidate) => candidate.id === where.id)
            : grades.find(
                (candidate) => candidate.submissionId === where.submissionId,
              );
          return Promise.resolve(grade ? withHistory(grade) : null);
        }),
        findUniqueOrThrow: jest.fn(({ where }) => {
          const grade = grades.find((candidate) => candidate.id === where.id);
          if (!grade) throw new Error('Grade not found');
          return Promise.resolve(withHistory(grade));
        }),
        create: jest.fn(({ data }) => {
          const grade = {
            id: gradeId,
            submissionId: data.submissionId,
            score: data.score,
            maxScore: data.maxScore,
            feedback: data.feedback ?? null,
            gradedById: data.gradedById,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          grades.push(grade);
          return Promise.resolve(grade);
        }),
        update: jest.fn(({ where, data }) => {
          const grade = grades.find((candidate) => candidate.id === where.id);
          Object.assign(grade, {
            ...(data.score === undefined ? {} : { score: data.score }),
            ...(data.feedback === undefined ? {} : { feedback: data.feedback }),
            updatedAt: new Date(),
          });
          return Promise.resolve(grade);
        }),
      },
      gradeHistory: {
        create: jest.fn(({ data }) => {
          const history = {
            id: `history-${histories.length + 1}`,
            gradeId: data.gradeId,
            score: data.score,
            maxScore: data.maxScore,
            feedback: data.feedback ?? null,
            changedById: data.changedById,
            createdAt: new Date(Date.now() + histories.length),
          };
          histories.push(history);
          return Promise.resolve(history);
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(MasteryEngineService)
      .useValue(masteryEngineService)
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
      sub: studentId,
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a grade, marks submission graded, updates mastery, and rejects duplicates', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId, score: 87, feedback: 'Strong work' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.history).toHaveLength(1);
        expect(response.body.data.history[0]).toMatchObject({ score: 87 });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/submissions/${submissionId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe(SubmissionStatus.GRADED);
      });

    expect(masteryEngineService.updateMastery).toHaveBeenCalledWith(
      studentId,
      'fractions',
      87,
      100,
      submissionId,
      'classroom-1',
    );

    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId, score: 88 })
      .expect(409);
  });

  it('appends grade history on update without changing older entries', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId, score: 80, feedback: 'Initial' })
      .expect(201);

    const originalHistory = [...histories];

    await request(app.getHttpServer())
      .patch(`/api/v1/grades/${gradeId}`)
      .set('Authorization', teacherAuthorization)
      .send({ score: 92, feedback: 'Updated' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.history).toHaveLength(2);
        expect(response.body.data.history[0]).toMatchObject({
          score: 92,
          feedback: 'Updated',
        });
      });

    expect(histories[1]).toMatchObject({
      score: 92,
      feedback: 'Updated',
    });
    expect(histories[0]).toMatchObject({
      id: originalHistory[0].id,
      score: originalHistory[0].score,
      feedback: originalHistory[0].feedback,
    });
    expect(masteryEngineService.updateMastery).toHaveBeenCalledTimes(2);
  });

  it('returns grades by submission with history and lets students read their own grade', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId, score: 81 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/grades/submission/${submissionId}`)
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.history).toHaveLength(1);
      });
  });

  it('rejects invalid grade attempts', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId, score: 101 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', teacherAuthorization)
      .send({ submissionId: draftSubmissionId, score: 80 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/grades')
      .set('Authorization', studentAuthorization)
      .send({ submissionId, score: 80 })
      .expect(403);
  });
});
