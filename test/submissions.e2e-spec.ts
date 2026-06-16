import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, SubmissionStatus } from '@prisma/client';
import request = require('supertest');
import { EventsService } from '../src/events/events.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Submissions endpoints', () => {
  let app: INestApplication;
  let studentAuthorization: string;
  let teacherAuthorization: string;
  let submissions: any[];
  let eventsService: { emit: jest.Mock };

  const assignmentId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const submissionId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
  const studentId = 'student-1';

  beforeEach(async () => {
    submissions = [];
    eventsService = { emit: jest.fn().mockResolvedValue(undefined) };

    let prismaMock: any;
    prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((arg: any): Promise<any> =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock),
      ),
      assignment: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === assignmentId && where.deletedAt === null
              ? {
                  id: assignmentId,
                  title: 'Essay',
                  description: null,
                  dueAt: null,
                  maxScore: 100,
                  classroomId: 'classroom-1',
                  courseId: null,
                  rubricId: null,
                  rubric: null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  deletedAt: null,
                }
              : null,
          ),
        ),
      },
      submission: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            submissions
              .filter(
                (submission) =>
                  (!where.assignmentId ||
                    submission.assignmentId === where.assignmentId) &&
                  (!where.studentId || submission.studentId === where.studentId),
              )
              .slice(skip, skip + take),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            submissions.filter(
              (submission) =>
                (!where.assignmentId ||
                  submission.assignmentId === where.assignmentId) &&
                (!where.studentId || submission.studentId === where.studentId),
            ).length,
          ),
        ),
        findUnique: jest.fn(({ where }) => {
          if (where.id) {
            return Promise.resolve(
              submissions.find((submission) => submission.id === where.id) ?? null,
            );
          }
          if (where.assignmentId_studentId) {
            return Promise.resolve(
              submissions.find(
                (submission) =>
                  submission.assignmentId ===
                    where.assignmentId_studentId.assignmentId &&
                  submission.studentId === where.assignmentId_studentId.studentId,
              ) ?? null,
            );
          }
          return Promise.resolve(null);
        }),
        create: jest.fn(({ data }) => {
          const submission = {
            id: submissions.length === 0 ? submissionId : `submission-${submissions.length}`,
            assignmentId: data.assignmentId,
            studentId: data.studentId,
            status: SubmissionStatus.DRAFT,
            content: data.content ?? null,
            fileUrl: data.fileUrl ?? null,
            submittedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          submissions.push(submission);
          return Promise.resolve(submission);
        }),
        update: jest.fn(({ where, data }) => {
          const submission = submissions.find(
            (candidate) => candidate.id === where.id,
          );
          Object.assign(submission, data, { updatedAt: new Date() });
          return Promise.resolve(submission);
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(EventsService)
      .useValue(eventsService)
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
    teacherAuthorization = `Bearer ${jwtService.sign({
      sub: 'teacher-1',
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates draft submissions, rejects duplicates, and rejects teacher create', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/submissions')
      .set('Authorization', studentAuthorization)
      .send({ assignmentId, content: 'My work' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          assignmentId,
          studentId,
          status: SubmissionStatus.DRAFT,
        });
      });

    await request(app.getHttpServer())
      .post('/api/v1/submissions')
      .set('Authorization', studentAuthorization)
      .send({ assignmentId, content: 'Again' })
      .expect(409);

    await request(app.getHttpServer())
      .post('/api/v1/submissions')
      .set('Authorization', teacherAuthorization)
      .send({ assignmentId, content: 'Teacher work' })
      .expect(403);
  });

  it('updates own drafts and submits once with an event', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/submissions')
      .set('Authorization', studentAuthorization)
      .send({ assignmentId, content: 'Draft' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${submissionId}`)
      .set('Authorization', studentAuthorization)
      .send({ content: 'Updated draft' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.content).toBe('Updated draft');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${submissionId}/submit`)
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe(SubmissionStatus.SUBMITTED);
        expect(response.body.data.submittedAt).toBeTruthy();
      });

    expect(eventsService.emit).toHaveBeenCalledWith('submission.created', {
      submissionId,
      assignmentId,
      studentId,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${submissionId}/submit`)
      .set('Authorization', studentAuthorization)
      .expect(400);
  });
});
