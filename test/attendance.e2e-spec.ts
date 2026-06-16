import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceStatus, Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { EventsService } from '../src/events/events.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Attendance endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let eventsService: { emit: jest.Mock };
  let attendanceRecords: any[];

  const classroomId = '44444444-4444-4444-8444-444444444444';
  const studentOneId = '11111111-1111-4111-8111-111111111111';
  const studentTwoId = '22222222-2222-4222-8222-222222222222';
  const studentThreeId = '33333333-3333-4333-8333-333333333333';

  const dateOnly = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const sameDate = (left: Date, right: Date) =>
    left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);

  beforeEach(async () => {
    eventsService = { emit: jest.fn().mockResolvedValue(undefined) };
    attendanceRecords = [];

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
      attendanceRecord: {
        upsert: jest.fn(({ where, create, update }) => {
          const key = where.classroomId_studentId_date;
          const existing = attendanceRecords.find(
            (record) =>
              record.classroomId === key.classroomId &&
              record.studentId === key.studentId &&
              sameDate(record.date, key.date),
          );
          if (existing) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }
          const record = {
            id: `attendance-${attendanceRecords.length + 1}`,
            ...create,
            createdAt: new Date(),
          };
          attendanceRecords.push(record);
          return Promise.resolve(record);
        }),
        findMany: jest.fn(({ where, skip = 0, take, orderBy }) => {
          let records = attendanceRecords.filter(
            (record) =>
              (!where.classroomId || record.classroomId === where.classroomId) &&
              (!where.studentId || record.studentId === where.studentId) &&
              (!where.date || sameDate(record.date, where.date)),
          );
          if (orderBy?.date === 'desc') {
            records = records.sort((left, right) => right.date.getTime() - left.date.getTime());
          }
          if (orderBy?.studentId === 'asc') {
            records = records.sort((left, right) =>
              left.studentId.localeCompare(right.studentId),
            );
          }
          return Promise.resolve(records.slice(skip, take ? skip + take : undefined));
        }),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            attendanceRecords.filter(
              (record) =>
                (!where.studentId || record.studentId === where.studentId),
            ).length,
          ),
        ),
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
    teacherAuthorization = `Bearer ${jwtService.sign({
      sub: 'teacher-1',
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
    studentAuthorization = `Bearer ${jwtService.sign({
      sub: studentOneId,
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('bulk upserts attendance and returns records for a classroom date', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/attendance')
      .set('Authorization', teacherAuthorization)
      .send({
        classroomId,
        date: '2026-06-16',
        entries: [
          { studentId: studentOneId, status: AttendanceStatus.PRESENT },
          { studentId: studentTwoId, status: AttendanceStatus.ABSENT },
          { studentId: studentThreeId, status: AttendanceStatus.LATE, note: 'Traffic' },
        ],
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toHaveLength(3);
      });

    await request(app.getHttpServer())
      .post('/api/v1/attendance')
      .set('Authorization', teacherAuthorization)
      .send({
        classroomId,
        date: '2026-06-16',
        entries: [
          { studentId: studentOneId, status: AttendanceStatus.ABSENT },
        ],
      })
      .expect(201);

    expect(attendanceRecords).toHaveLength(3);
    expect(
      attendanceRecords.find((record) => record.studentId === studentOneId)
        ?.status,
    ).toBe(AttendanceStatus.ABSENT);

    await request(app.getHttpServer())
      .get(`/api/v1/attendance?classroomId=${classroomId}&date=2026-06-16`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(3);
      });
  });

  it('returns paginated student history and rejects student writes', async () => {
    attendanceRecords.push(
      {
        id: 'history-1',
        classroomId,
        studentId: studentOneId,
        date: dateOnly('2026-06-15'),
        status: AttendanceStatus.PRESENT,
        note: null,
        recordedById: 'teacher-1',
        createdAt: new Date(),
      },
      {
        id: 'history-2',
        classroomId,
        studentId: studentOneId,
        date: dateOnly('2026-06-16'),
        status: AttendanceStatus.ABSENT,
        note: null,
        recordedById: 'teacher-1',
        createdAt: new Date(),
      },
    );

    await request(app.getHttpServer())
      .get(`/api/v1/attendance/student/${studentOneId}?page=1&limit=1`)
      .set('Authorization', studentAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
        expect(response.body.meta.total).toBe(2);
      });

    await request(app.getHttpServer())
      .post('/api/v1/attendance')
      .set('Authorization', studentAuthorization)
      .send({
        classroomId,
        date: '2026-06-16',
        entries: [{ studentId: studentOneId, status: AttendanceStatus.PRESENT }],
      })
      .expect(403);
  });

  it('emits an alert on three consecutive absences', async () => {
    for (const date of ['2026-06-14', '2026-06-15', '2026-06-16']) {
      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', teacherAuthorization)
        .send({
          classroomId,
          date,
          entries: [{ studentId: studentOneId, status: AttendanceStatus.ABSENT }],
        })
        .expect(201);
    }

    expect(eventsService.emit).toHaveBeenCalledWith(
      'attendance.risk.detected',
      {
        studentId: studentOneId,
        classroomId,
      },
    );
  });

  it('does not emit an alert when recent records include present', async () => {
    for (const [date, status] of [
      ['2026-06-14', AttendanceStatus.ABSENT],
      ['2026-06-15', AttendanceStatus.PRESENT],
      ['2026-06-16', AttendanceStatus.ABSENT],
    ] as const) {
      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', teacherAuthorization)
        .send({
          classroomId,
          date,
          entries: [{ studentId: studentOneId, status }],
        })
        .expect(201);
    }

    expect(eventsService.emit).not.toHaveBeenCalled();
  });
});
