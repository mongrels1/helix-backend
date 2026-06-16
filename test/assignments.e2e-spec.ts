import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Assignments endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let assignments: any[];
  let rubrics: any[];
  let criteria: any[];

  const classroomId = '44444444-4444-4444-8444-444444444444';
  const assignmentId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

  const withRubric = (assignment: any) => ({
    ...assignment,
    rubric: assignment.rubricId
      ? {
          ...rubrics.find((rubric) => rubric.id === assignment.rubricId),
          criteria: criteria.filter((item) => item.rubricId === assignment.rubricId),
        }
      : null,
  });

  beforeEach(async () => {
    assignments = [
      {
        id: assignmentId,
        title: 'Essay',
        description: null,
        dueAt: null,
        maxScore: 100,
        classroomId,
        courseId: null,
        rubricId: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    rubrics = [];
    criteria = [];

    let prismaMock: any;
    prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((arg: any): Promise<any> =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock),
      ),
      classroom: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === classroomId && where.deletedAt === null
              ? {
                  id: classroomId,
                  name: 'Algebra Room',
                  description: null,
                  organizationId: 'org-1',
                  teacherId: 'teacher-1',
                  createdAt: new Date(),
                  _count: { enrollments: 0 },
                }
              : null,
          ),
        ),
      },
      course: {
        findFirst: jest.fn(() => Promise.resolve(null)),
      },
      assignment: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            assignments
              .filter(
                (assignment) =>
                  assignment.classroomId === where.classroomId &&
                  assignment.deletedAt === where.deletedAt,
              )
              .slice(skip, skip + take)
              .map(withRubric),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            assignments.filter(
              (assignment) =>
                assignment.classroomId === where.classroomId &&
                assignment.deletedAt === where.deletedAt,
            ).length,
          ),
        ),
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            assignments
              .filter(
                (assignment) =>
                  assignment.id === where.id &&
                  assignment.deletedAt === where.deletedAt,
              )
              .map(withRubric)[0] ?? null,
          ),
        ),
        findManyOverdue: jest.fn(),
        create: jest.fn(({ data }) => {
          const assignment = {
            id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
            title: data.title,
            description: data.description ?? null,
            dueAt: data.dueAt ?? null,
            maxScore: data.maxScore ?? 100,
            classroomId: data.classroomId,
            courseId: data.courseId ?? null,
            rubricId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          assignments.push(assignment);
          return Promise.resolve(withRubric(assignment));
        }),
        updateMany: jest.fn(({ where, data }) => {
          const assignment = assignments.find(
            (candidate) =>
              candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (assignment) Object.assign(assignment, data, { updatedAt: new Date() });
          return Promise.resolve({ count: assignment ? 1 : 0 });
        }),
        update: jest.fn(({ where, data }) => {
          const assignment = assignments.find((candidate) => candidate.id === where.id);
          Object.assign(assignment, data, { updatedAt: new Date() });
          return Promise.resolve(withRubric(assignment));
        }),
      },
      rubric: {
        create: jest.fn(({ data }) => {
          const rubric = {
            id: 'cccccccc-3333-4333-8333-cccccccccccc',
            title: data.title,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rubrics.push(rubric);
          criteria.push(
            ...data.criteria.create.map((item: any, index: number) => ({
              id: `criteria-${index}`,
              rubricId: rubric.id,
              ...item,
            })),
          );
          return Promise.resolve({
            ...rubric,
            criteria: criteria.filter((item) => item.rubricId === rubric.id),
          });
        }),
        update: jest.fn(({ where, data }) => {
          const rubric = rubrics.find((candidate) => candidate.id === where.id);
          Object.assign(rubric, { title: data.title, updatedAt: new Date() });
          criteria = criteria.filter((item) => item.rubricId !== where.id);
          criteria.push(
            ...data.criteria.create.map((item: any, index: number) => ({
              id: `updated-criteria-${index}`,
              rubricId: where.id,
              ...item,
            })),
          );
          return Promise.resolve({
            ...rubric,
            criteria: criteria.filter((item) => item.rubricId === where.id),
          });
        }),
        delete: jest.fn(({ where }) => {
          rubrics = rubrics.filter((rubric) => rubric.id !== where.id);
          return Promise.resolve({});
        }),
      },
      rubricCriteria: {
        deleteMany: jest.fn(({ where }) => {
          criteria = criteria.filter((item) => item.rubricId !== where.rubricId);
          return Promise.resolve({ count: 1 });
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
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
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates assignments and rejects invalid classroom or student writer', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/assignments')
      .set('Authorization', teacherAuthorization)
      .send({ title: 'Lab Report', classroomId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/assignments')
      .set('Authorization', teacherAuthorization)
      .send({
        title: 'Missing',
        classroomId: '11111111-1111-4111-8111-111111111111',
      })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/assignments')
      .set('Authorization', studentAuthorization)
      .send({ title: 'Nope', classroomId })
      .expect(403);
  });

  it('creates a rubric, returns it on assignment detail, and rejects duplicate rubric', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${assignmentId}/rubric`)
      .set('Authorization', teacherAuthorization)
      .send({
        title: 'Essay Rubric',
        criteria: [{ title: 'Clarity', maxScore: 10, order: 0 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.rubric.criteria[0]).toMatchObject({
          title: 'Clarity',
          maxScore: 10,
        });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/assignments/${assignmentId}/rubric`)
      .set('Authorization', teacherAuthorization)
      .send({
        title: 'Duplicate',
        criteria: [{ title: 'Depth', maxScore: 10, order: 0 }],
      })
      .expect(409);
  });

  it('soft deletes assignments and excludes them from lists', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/assignments/${assignmentId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/assignments?classroomId=${classroomId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(0);
      });
  });
});
