import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Classrooms endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let adminAuthorization: string;
  let classrooms: Array<{
    id: string;
    name: string;
    description: string | null;
    organizationId: string;
    teacherId: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }>;
  let enrollments: Array<{
    id: string;
    classroomId: string;
    studentId: string;
    enrolledAt: Date;
  }>;

  const orgId = '11111111-1111-4111-8111-111111111111';
  const teacherId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';
  const classroomId = '44444444-4444-4444-8444-444444444444';

  const publicClassroom = (classroom: (typeof classrooms)[number]) => ({
    id: classroom.id,
    name: classroom.name,
    description: classroom.description,
    organizationId: classroom.organizationId,
    teacherId: classroom.teacherId,
    createdAt: classroom.createdAt,
    _count: {
      enrollments: enrollments.filter(
        (enrollment) => enrollment.classroomId === classroom.id,
      ).length,
    },
  });

  beforeEach(async () => {
    classrooms = [
      {
        id: classroomId,
        name: 'Algebra I',
        description: null,
        organizationId: orgId,
        teacherId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    enrollments = [];

    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
      organization: {
        findFirst: jest.fn(({ where }) => {
          if (where.id === orgId && where.deletedAt === null) {
            return Promise.resolve({
              id: orgId,
              name: 'Helix Academy',
              slug: 'helix-academy',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              _count: { memberships: 0 },
            });
          }
          return Promise.resolve(null);
        }),
      },
      user: {
        findFirst: jest.fn(({ where, select }) => {
          const users = [
            {
              id: teacherId,
              email: 'teacher@example.com',
              role: Role.TEACHER,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              deletedAt: null,
              profile: null,
              passwordHash: 'hashed',
            },
            {
              id: studentId,
              email: 'student@example.com',
              role: Role.STUDENT,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              deletedAt: null,
              profile: null,
              passwordHash: 'hashed',
            },
          ];
          const user = users.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;
            return idMatches && deletedAtMatches;
          });

          if (!user) {
            return Promise.resolve(null);
          }

          const { passwordHash, ...publicUser } = user;
          return Promise.resolve(select ? publicUser : user);
        }),
      },
      classroom: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) => {
          const filtered = classrooms.filter((classroom) => {
            if (where.deletedAt !== undefined && classroom.deletedAt !== where.deletedAt) {
              return false;
            }
            if (where.teacherId !== undefined && classroom.teacherId !== where.teacherId) {
              return false;
            }
            if (where.enrollments?.some?.studentId !== undefined) {
              return enrollments.some(
                (enrollment) =>
                  enrollment.classroomId === classroom.id &&
                  enrollment.studentId === where.enrollments.some.studentId,
              );
            }
            return true;
          });

          return Promise.resolve(filtered.slice(skip, skip + take).map(publicClassroom));
        }),
        count: jest.fn(({ where }) => {
          const count = classrooms.filter((classroom) => {
            if (where.deletedAt !== undefined && classroom.deletedAt !== where.deletedAt) {
              return false;
            }
            if (where.teacherId !== undefined && classroom.teacherId !== where.teacherId) {
              return false;
            }
            if (where.enrollments?.some?.studentId !== undefined) {
              return enrollments.some(
                (enrollment) =>
                  enrollment.classroomId === classroom.id &&
                  enrollment.studentId === where.enrollments.some.studentId,
              );
            }
            return true;
          }).length;
          return Promise.resolve(count);
        }),
        findFirst: jest.fn(({ where }) => {
          const classroom = classrooms.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;
            return idMatches && deletedAtMatches;
          });
          return Promise.resolve(classroom ? publicClassroom(classroom) : null);
        }),
        create: jest.fn(({ data }) => {
          const classroom = {
            id: '55555555-5555-4555-8555-555555555555',
            name: data.name,
            description: data.description ?? null,
            organizationId: data.organizationId,
            teacherId: data.teacherId,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: null,
          };
          classrooms.push(classroom);
          return Promise.resolve(publicClassroom(classroom));
        }),
        updateMany: jest.fn(({ where, data }) => {
          const classroom = classrooms.find(
            (candidate) =>
              candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (classroom) {
            Object.assign(classroom, data, { updatedAt: new Date() });
          }
          return Promise.resolve({ count: classroom ? 1 : 0 });
        }),
      },
      enrollment: {
        create: jest.fn(({ data }) => {
          const enrollment = {
            id: '66666666-6666-4666-8666-666666666666',
            classroomId: data.classroomId,
            studentId: data.studentId,
            enrolledAt: new Date('2026-01-03T00:00:00.000Z'),
          };
          enrollments.push(enrollment);
          return Promise.resolve(enrollment);
        }),
        deleteMany: jest.fn(({ where }) => {
          const before = enrollments.length;
          enrollments = enrollments.filter(
            (enrollment) =>
              !(
                enrollment.classroomId === where.classroomId &&
                enrollment.studentId === where.studentId
              ),
          );
          return Promise.resolve({ count: before - enrollments.length });
        }),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            enrollments.filter(
              (enrollment) => enrollment.classroomId === where.classroomId,
            ),
          ),
        ),
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            enrollments.find(
              (enrollment) =>
                enrollment.classroomId === where.classroomId &&
                enrollment.studentId === where.studentId,
            ) ?? null,
          ),
        ),
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
    adminAuthorization = `Bearer ${jwtService.sign({
      sub: '77777777-7777-4777-8777-777777777777',
      email: 'admin@example.com',
      role: Role.SUPER_ADMIN,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates classrooms for teachers and rejects students', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/classrooms')
      .set('Authorization', teacherAuthorization)
      .send({ name: 'Geometry', organizationId: orgId })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          name: 'Geometry',
          teacherId,
          enrollmentCount: 0,
        });
      });

    await request(app.getHttpServer())
      .post('/api/v1/classrooms')
      .set('Authorization', studentAuthorization)
      .send({ name: 'Biology', organizationId: orgId })
      .expect(403);
  });

  it('requires authentication for classroom list', () => {
    return request(app.getHttpServer()).get('/api/v1/classrooms').expect(401);
  });

  it('enrolls students and rejects duplicate enrollment', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/classrooms/${classroomId}/enroll`)
      .set('Authorization', teacherAuthorization)
      .send({ studentId })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({ classroomId, studentId });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/classrooms/${classroomId}/enroll`)
      .set('Authorization', teacherAuthorization)
      .send({ studentId })
      .expect(409);
  });

  it('soft deletes classrooms and excludes them from list', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/classrooms/${classroomId}`)
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect({ success: true, data: null });

    await request(app.getHttpServer())
      .get('/api/v1/classrooms')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(0);
      });
  });
});
