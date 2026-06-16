import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Users endpoints', () => {
  let app: INestApplication;
  let authorization: string;
  let users: Array<{
    id: string;
    email: string;
    passwordHash: string;
    role: Role;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    profile: {
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
    };
  }>;

  const publicUser = (user: (typeof users)[number]) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt,
    profile: user.profile,
  });

  beforeEach(async () => {
    users = [
      {
        id: 'user-1',
        email: 'student@example.com',
        passwordHash: 'hashed-password',
        role: Role.STUDENT,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        profile: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          avatarUrl: null,
        },
      },
    ];

    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
      user: {
        findMany: jest.fn(({ skip = 0, take = 20 }) =>
          Promise.resolve(
            users
              .filter((user) => user.deletedAt === null)
              .slice(skip, skip + take)
              .map(publicUser),
          ),
        ),
        count: jest.fn(() =>
          Promise.resolve(users.filter((user) => user.deletedAt === null).length),
        ),
        findFirst: jest.fn(({ where }) => {
          const user = users.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const emailMatches =
              where.email === undefined || candidate.email === where.email;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;

            return idMatches && emailMatches && deletedAtMatches;
          });

          return Promise.resolve(user ? publicUser(user) : null);
        }),
        create: jest.fn(({ data }) => {
          const user = {
            id: 'user-2',
            email: data.email,
            passwordHash: data.passwordHash,
            role: data.role ?? Role.STUDENT,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: null,
            profile: {
              firstName: data.profile.create.firstName,
              lastName: data.profile.create.lastName,
              avatarUrl: null,
            },
          };
          users.push(user);
          return Promise.resolve(publicUser(user));
        }),
        updateMany: jest.fn(({ where, data }) => {
          const user = users.find(
            (candidate) =>
              candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (user) {
            Object.assign(user, data, { updatedAt: new Date() });
          }
          return Promise.resolve({ count: user ? 1 : 0 });
        }),
      },
      profile: {
        updateMany: jest.fn(({ where, data }) => {
          const user = users.find(
            (candidate) =>
              candidate.id === where.userId && candidate.deletedAt === null,
          );
          if (user) {
            Object.assign(user.profile, data);
          }
          return Promise.resolve({ count: user ? 1 : 0 });
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
    await app.init();
    const jwtService = moduleFixture.get(JwtService);
    authorization = `Bearer ${jwtService.sign({
      sub: 'user-1',
      email: 'student@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists users without passwordHash', () => {
    return request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: true,
          meta: { page: 1, limit: 20, total: 1 },
        });
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].passwordHash).toBeUndefined();
      });
  });

  it('blocks users list without authorization', () => {
    return request(app.getHttpServer())
      .get('/api/v1/users')
      .expect(401)
      .expect((response) => {
        expect(response.body.success).toBe(false);
      });
  });

  it('reads, updates, and soft deletes a user', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users/user-1')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.profile.firstName).toBe('Ada');
        expect(response.body.data.passwordHash).toBeUndefined();
      });

    await request(app.getHttpServer())
      .patch('/api/v1/users/user-1')
      .set('Authorization', authorization)
      .send({ firstName: 'Grace' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.profile.firstName).toBe('Grace');
        expect(response.body.data.passwordHash).toBeUndefined();
      });

    await request(app.getHttpServer())
      .delete('/api/v1/users/user-1')
      .set('Authorization', authorization)
      .expect(200)
      .expect({ success: true, data: null });

    await request(app.getHttpServer())
      .get('/api/v1/users/user-1')
      .set('Authorization', authorization)
      .expect(404);
  });
});
