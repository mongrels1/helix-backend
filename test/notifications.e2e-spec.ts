import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AttendanceStatus,
  NotificationChannel,
  NotificationStatus,
  Role,
} from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Notifications endpoints', () => {
  let app: INestApplication;
  let userAuthorization: string;
  let otherAuthorization: string;
  let teacherAuthorization: string;
  let notifications: any[];
  let preferences: any[];
  let attendanceRecords: any[];

  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const classroomId = '44444444-4444-4444-8444-444444444444';

  const dateOnly = (value: string) =>
    new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const sameDate = (left: Date, right: Date) =>
    left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);

  beforeEach(async () => {
    notifications = [];
    preferences = [];
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
            records = records.sort(
              (left, right) => right.date.getTime() - left.date.getTime(),
            );
          }
          return Promise.resolve(records.slice(skip, take ? skip + take : undefined));
        }),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            attendanceRecords.filter(
              (record) => !where.studentId || record.studentId === where.studentId,
            ).length,
          ),
        ),
      },
      notification: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            notifications
              .filter(
                (notification) =>
                  notification.userId === where.userId &&
                  notification.deletedAt === where.deletedAt,
              )
              .sort(
                (left, right) =>
                  right.createdAt.getTime() - left.createdAt.getTime(),
              )
              .slice(skip, skip + take),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            notifications.filter(
              (notification) =>
                (!where.userId || notification.userId === where.userId) &&
                (!where.status || notification.status === where.status) &&
                notification.deletedAt === where.deletedAt,
            ).length,
          ),
        ),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            notifications.find((notification) => notification.id === where.id) ??
              null,
          ),
        ),
        create: jest.fn(({ data }) => {
          const notification = {
            id: `notification-${notifications.length + 1}`,
            userId: data.userId,
            title: data.title,
            body: data.body,
            channel: data.channel ?? NotificationChannel.IN_APP,
            status: NotificationStatus.UNREAD,
            metadata: data.metadata ?? null,
            createdAt: new Date(Date.now() + notifications.length),
            readAt: null,
            deletedAt: null,
          };
          notifications.push(notification);
          return Promise.resolve(notification);
        }),
        update: jest.fn(({ where, data }) => {
          const notification = notifications.find(
            (candidate) => candidate.id === where.id,
          );
          Object.assign(notification, data);
          return Promise.resolve(notification);
        }),
      },
      notificationPreference: {
        upsert: jest.fn(({ where, create, update }) => {
          let preference = preferences.find(
            (candidate) => candidate.userId === where.userId,
          );
          if (!preference) {
            preference = {
              id: `preference-${preferences.length + 1}`,
              userId: create.userId,
              email: create.email ?? true,
              push: create.push ?? false,
              inApp: create.inApp ?? true,
              updatedAt: new Date(),
            };
            preferences.push(preference);
          } else {
            Object.assign(preference, update, { updatedAt: new Date() });
          }
          return Promise.resolve(preference);
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
    userAuthorization = `Bearer ${jwtService.sign({
      sub: userId,
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
    otherAuthorization = `Bearer ${jwtService.sign({
      sub: otherUserId,
      email: 'other@example.com',
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

  it('returns empty notifications for a new user and upserts default preferences', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', userAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual([]);
        expect(response.body.meta.unreadCount).toBe(0);
      });

    await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .set('Authorization', userAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          userId,
          email: true,
          push: false,
          inApp: true,
        });
      });
  });

  it('updates preferences', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences')
      .set('Authorization', userAuthorization)
      .send({ email: false, push: true })
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          userId,
          email: false,
          push: true,
        });
      });
  });

  it('marks owned notifications read and blocks wrong users', async () => {
    notifications.push({
      id: 'notification-1',
      userId,
      title: 'Alert',
      body: 'Body',
      channel: NotificationChannel.IN_APP,
      status: NotificationStatus.UNREAD,
      metadata: null,
      createdAt: new Date(),
      readAt: null,
      deletedAt: null,
    });

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/notification-1/read')
      .set('Authorization', otherAuthorization)
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/v1/notifications/notification-1/read')
      .set('Authorization', userAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe(NotificationStatus.READ);
        expect(response.body.data.readAt).toBeTruthy();
      });
  });

  it('soft deletes notifications and excludes them from subsequent lists', async () => {
    notifications.push({
      id: 'notification-1',
      userId,
      title: 'Alert',
      body: 'Body',
      channel: NotificationChannel.IN_APP,
      status: NotificationStatus.UNREAD,
      metadata: null,
      createdAt: new Date(),
      readAt: null,
      deletedAt: null,
    });

    await request(app.getHttpServer())
      .delete('/api/v1/notifications/notification-1')
      .set('Authorization', userAuthorization)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', userAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual([]);
      });
  });

  it('queues attendance.risk.detected without crashing when Redis is unavailable', async () => {
    for (const date of ['2026-06-14', '2026-06-15', '2026-06-16']) {
      await request(app.getHttpServer())
        .post('/api/v1/attendance')
        .set('Authorization', teacherAuthorization)
        .send({
          classroomId,
          date,
          entries: [{ studentId: userId, status: AttendanceStatus.ABSENT }],
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', userAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual([]);
      });
  });
});
