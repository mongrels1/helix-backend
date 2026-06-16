import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AttendanceStatus,
  Role,
  SubmissionStatus,
  TutorSessionStatus,
} from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Experience endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let parentAuthorization: string;
  let adminAuthorization: string;

  const teacherId = 'teacher-1';
  const studentId = 'student-1';
  const parentId = 'parent-1';
  const classroomId = 'classroom-1';
  const assignmentId = 'assignment-1';

  beforeEach(async () => {
    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $queryRaw: jest.fn(() => Promise.resolve([{ '?column?': 1 }])),
      $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
      user: {
        findUnique: jest.fn(({ where }) => {
          if (where.id === 'parent-to-link') {
            return Promise.resolve({ id: 'parent-to-link', role: Role.PARENT });
          }
          if (where.id === 'student-to-link') {
            return Promise.resolve({ id: 'student-to-link', role: Role.STUDENT });
          }
          return Promise.resolve({ id: where.id, role: Role.STUDENT });
        }),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: studentId,
              email: 'student@example.com',
              role: Role.STUDENT,
              createdAt: new Date('2026-06-01T12:00:00.000Z'),
              deletedAt: null,
              profile: { firstName: 'Ada', lastName: 'Lovelace' },
            },
          ]),
        ),
        count: jest.fn(() => Promise.resolve(10)),
      },
      parentStudentLink: {
        findUnique: jest.fn(({ where }) => {
          const { parentId: requestedParentId, studentId: requestedStudentId } =
            where.parentId_studentId;
          if (requestedParentId === parentId && requestedStudentId === studentId) {
            return Promise.resolve({ id: 'link-1' });
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              createdAt: new Date('2026-06-01T12:00:00.000Z'),
              student: {
                id: studentId,
                email: 'student@example.com',
                profile: { firstName: 'Ada', lastName: 'Lovelace' },
              },
            },
          ]),
        ),
        create: jest.fn(({ data }) =>
          Promise.resolve({
            id: 'link-created',
            ...data,
            createdAt: new Date('2026-06-13T12:00:00.000Z'),
          }),
        ),
      },
      classroom: {
        findMany: jest.fn(({ where, select }) => {
          if (select?._count) {
            return Promise.resolve([
              {
                id: classroomId,
                name: 'Algebra',
                _count: { enrollments: 2 },
              },
            ]);
          }
          return Promise.resolve([{ id: classroomId }]);
        }),
        findFirst: jest.fn(() =>
          Promise.resolve({ id: classroomId, name: 'Algebra' }),
        ),
        count: jest.fn(() => Promise.resolve(1)),
      },
      organization: {
        count: jest.fn(() => Promise.resolve(1)),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              id: 'org-1',
              name: 'Helix Academy',
              slug: 'helix-academy',
              createdAt: new Date('2026-06-01T12:00:00.000Z'),
              _count: { memberships: 3 },
            },
          ]),
        ),
      },
      course: {
        count: jest.fn(() => Promise.resolve(2)),
      },
      submission: {
        count: jest.fn(() => Promise.resolve(3)),
        findMany: jest.fn((args) => {
          if (args.include?.assignment) {
            return Promise.resolve([
              {
                id: 'submission-1',
                studentId,
                assignmentId,
                status: SubmissionStatus.SUBMITTED,
                submittedAt: new Date('2026-06-10T12:00:00.000Z'),
                assignment: { title: 'Essay', classroomId },
              },
            ]);
          }
          return Promise.resolve([
            {
              id: 'submission-1',
              studentId,
              assignmentId,
              status: SubmissionStatus.SUBMITTED,
              submittedAt: new Date('2026-06-10T12:00:00.000Z'),
            },
          ]);
        }),
      },
      assignment: {
        findMany: jest.fn((args) => {
          if (args.include?.submissions) {
            return Promise.resolve([
              {
                id: assignmentId,
                title: 'Essay',
                dueAt: new Date('2026-06-20T12:00:00.000Z'),
                maxScore: 100,
                classroomId,
                submissions: [
                  {
                    id: 'submission-1',
                    status: SubmissionStatus.SUBMITTED,
                    submittedAt: new Date('2026-06-10T12:00:00.000Z'),
                  },
                ],
              },
            ]);
          }
          return Promise.resolve([
            {
              id: assignmentId,
              title: 'Essay',
              dueAt: new Date('2026-06-20T12:00:00.000Z'),
              classroomId,
            },
          ]);
        }),
        count: jest.fn(() => Promise.resolve(1)),
      },
      attendanceRecord: {
        count: jest.fn(() => Promise.resolve(3)),
        findMany: jest.fn(() =>
          Promise.resolve([
            {
              date: new Date('2026-06-10T00:00:00.000Z'),
              status: AttendanceStatus.PRESENT,
              classroomId,
            },
            {
              date: new Date('2026-06-11T00:00:00.000Z'),
              status: AttendanceStatus.ABSENT,
              classroomId,
            },
            {
              date: new Date('2026-06-12T00:00:00.000Z'),
              status: AttendanceStatus.LATE,
              classroomId,
            },
          ]),
        ),
        groupBy: jest.fn((args) => {
          if (args.by.includes('status')) {
            return Promise.resolve([
              { status: AttendanceStatus.PRESENT, _count: { _all: 8 } },
              { status: AttendanceStatus.ABSENT, _count: { _all: 2 } },
              { status: AttendanceStatus.LATE, _count: { _all: 1 } },
            ]);
          }
          return Promise.resolve([
            { studentId: 'student-absence', _count: { _all: 3 } },
          ]);
        }),
      },
      notification: {
        count: jest.fn(() => Promise.resolve(4)),
      },
      enrollment: {
        count: jest.fn(() => Promise.resolve(2)),
        findMany: jest.fn(() =>
          Promise.resolve([{ classroomId, studentId }, { classroomId, studentId: 'student-2' }]),
        ),
      },
      grade: {
        count: jest.fn(() => Promise.resolve(1)),
        findMany: jest.fn((args) => {
          if (args.select) {
            return Promise.resolve([
              { score: 80, maxScore: 100 },
              { score: 90, maxScore: 100 },
            ]);
          }
          return Promise.resolve([
            {
              id: 'grade-1',
              score: 90,
              maxScore: 100,
              createdAt: new Date('2026-06-11T12:00:00.000Z'),
              submission: {
                assignment: { title: 'Essay', classroomId },
              },
            },
          ]);
        }),
      },
      masteryScore: {
        findMany: jest.fn((args) => {
          if (args.where?.score) {
            return Promise.resolve([
              {
                studentId: 'student-mastery',
                skillTag: 'fractions',
                score: 0.42,
                updatedAt: new Date('2026-06-12T12:00:00.000Z'),
              },
            ]);
          }
          if (args.include?.history) {
            return Promise.resolve([
              {
                skillTag: 'fractions',
                score: 0.72,
                updatedAt: new Date('2026-06-12T12:00:00.000Z'),
                history: [
                  { score: 0.72 },
                  { score: 0.62 },
                  { score: 0.52 },
                ],
              },
            ]);
          }
          return Promise.resolve([]);
        }),
        count: jest.fn(() => Promise.resolve(5)),
      },
      tutorSession: {
        count: jest.fn((args = {}) =>
          Promise.resolve(args.where?.status === TutorSessionStatus.ACTIVE ? 1 : 2),
        ),
      },
      pacingRecommendation: {
        count: jest.fn((args = {}) => Promise.resolve(args.where?.dismissed ? 1 : 4)),
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
      sub: teacherId,
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
    studentAuthorization = `Bearer ${jwtService.sign({
      sub: studentId,
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
    parentAuthorization = `Bearer ${jwtService.sign({
      sub: parentId,
      email: 'parent@example.com',
      role: Role.PARENT,
    })}`;
    adminAuthorization = `Bearer ${jwtService.sign({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: Role.SUPER_ADMIN,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns teacher dashboard structure', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/teacher/dashboard')
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          classrooms: [{ id: classroomId, name: 'Algebra', enrollmentCount: 2 }],
          pendingGrades: 3,
          atRiskCount: 1,
          activeNotifications: 4,
        });
        expect(response.body.data.upcomingAssignments).toHaveLength(1);
      });
  });

  it('returns teacher classroom overview', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/experience/teacher/classroom/${classroomId}/overview`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.classroom).toEqual({
          id: classroomId,
          name: 'Algebra',
        });
        expect(response.body.data.attendance.rate).toBe(72.7);
        expect(response.body.data.grades.averageScore).toBe(85);
      });
  });

  it('returns at-risk students from absences and low mastery', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/experience/teacher/classroom/${classroomId}/at-risk`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(2);
        expect(response.body.data.atRisk).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ studentId: 'student-absence' }),
            expect.objectContaining({ studentId: 'student-mastery' }),
          ]),
        );
      });
  });

  it('returns grading queue and accepts classroom filter', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/experience/teacher/grading-queue?classroomId=${classroomId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(response.body.data.queue[0]).toMatchObject({
          submissionId: 'submission-1',
          assignmentTitle: 'Essay',
          classroomId,
        });
      });
  });

  it('returns student dashboard and handles zero mastery scores', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/student/dashboard')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.masterySnapshot).toEqual({
          averageScore: 0,
          skillCount: 0,
          belowThreshold: 0,
        });
        expect(response.body.data.activeTutorSessions).toBe(1);
      });
  });

  it('returns student assignments, grades, and mastery', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/student/assignments?page=1&limit=20')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(1);
        expect(response.body.data.assignments[0].submission.status).toBe(
          SubmissionStatus.SUBMITTED,
        );
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/student/grades')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.summary).toMatchObject({
          averagePercentage: 90,
          highestScore: 90,
          totalGraded: 1,
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/student/mastery')
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.skills[0]).toMatchObject({
          skillTag: 'fractions',
          trend: 'IMPROVING',
        });
      });
  });

  it('blocks a student from accessing another student data', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/student/dashboard?studentId=student-2')
      .set('Authorization', studentAuthorization)
      .expect(403);
  });

  it('lets an admin link a parent to a student', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/experience/parent/link')
      .set('Authorization', adminAuthorization)
      .send({ parentId: 'parent-to-link', studentId: 'student-to-link' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          id: 'link-created',
          parentId: 'parent-to-link',
          studentId: 'student-to-link',
        });
      });
  });

  it('returns parent child data for linked students', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/parent/children')
      .set('Authorization', parentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.children[0]).toMatchObject({
          studentId,
          firstName: 'Ada',
          lastName: 'Lovelace',
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/experience/parent/child/${studentId}/attendance`)
      .set('Authorization', parentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.summary).toMatchObject({
          present: 1,
          absent: 1,
          late: 1,
          attendanceRate: 33.3,
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/experience/parent/child/${studentId}/grades`)
      .set('Authorization', parentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.summary.totalGraded).toBe(1);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/experience/parent/child/${studentId}/alerts`)
      .set('Authorization', parentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.total).toBe(2);
        expect(response.body.data.alerts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'ATTENDANCE', severity: 'MEDIUM' }),
            expect.objectContaining({ type: 'MASTERY', severity: 'MEDIUM' }),
          ]),
        );
      });
  });

  it('blocks parent access to an unlinked student', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/experience/parent/child/student-2/grades')
      .set('Authorization', parentAuthorization)
      .expect(403);
  });

  it('returns admin dashboard, users, organizations, health, and metrics', async () => {
    const oldRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    await request(app.getHttpServer())
      .get('/api/v1/experience/admin/dashboard')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.counts.users).toBe(10);
        expect(response.body.data.atRiskStudents).toBe(1);
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/admin/users?page=1&limit=20&role=STUDENT&search=ada')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.users[0]).toMatchObject({
          id: studentId,
          firstName: 'Ada',
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/admin/organizations')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.organizations[0]).toMatchObject({
          name: 'Helix Academy',
          memberCount: 3,
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/admin/health')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.database.status).toBe('ok');
        expect(response.body.data.redis.status).toBe('unconfigured');
      });

    await request(app.getHttpServer())
      .get('/api/v1/experience/admin/metrics')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.submissions.total).toBe(3);
        expect(response.body.data.masteryScores.total).toBe(5);
      });

    if (oldRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = oldRedisUrl;
    }
  });
});
