import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/modules/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth endpoints', () => {
  let app: INestApplication;
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
  let refreshTokens: Array<{
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }>;
  let passwordResetTokens: Array<{
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  }>;
  let emailMock: jest.Mocked<Pick<EmailService, 'sendWelcomeEmail' | 'sendPasswordResetEmail'>>;

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
        passwordHash: await bcrypt.hash('password123', 12),
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
    refreshTokens = [
      {
        id: 'refresh-1',
        userId: 'user-1',
        token: 'valid-refresh-token',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'refresh-2',
        userId: 'user-1',
        token: 'expired-refresh-token',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    passwordResetTokens = [];
    emailMock = {
      sendWelcomeEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };

    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      user: {
        findFirst: jest.fn(({ where, select }) => {
          const user = users.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const emailMatches =
              where.email === undefined || candidate.email === where.email;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;
            return idMatches && emailMatches && deletedAtMatches;
          });

          if (!user) {
            return Promise.resolve(null);
          }

          return Promise.resolve(select ? publicUser(user) : user);
        }),
        create: jest.fn(({ data }) => {
          const user = {
            id: `user-${users.length + 1}`,
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
        update: jest.fn(({ where, data }) => {
          const user = users.find((candidate) => candidate.id === where.id);
          if (!user) throw new Error('User not found');
          user.passwordHash = data.passwordHash;
          user.updatedAt = new Date();
          return Promise.resolve(user);
        }),
      },
      refreshToken: {
        create: jest.fn(({ data }) => {
          const refreshToken = {
            id: `refresh-${refreshTokens.length + 1}`,
            userId: data.userId,
            token: data.token,
            expiresAt: data.expiresAt,
            createdAt: new Date(),
          };
          refreshTokens.push(refreshToken);
          return Promise.resolve(refreshToken);
        }),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            refreshTokens.find((token) => token.token === where.token) ?? null,
          ),
        ),
        deleteMany: jest.fn(({ where }) => {
          const before = refreshTokens.length;
          refreshTokens = refreshTokens.filter(
            (token) =>
              !(
                token.userId === where.userId &&
                (where.token === undefined || token.token === where.token)
              ),
          );
          return Promise.resolve({ count: before - refreshTokens.length });
        }),
      },
      passwordResetToken: {
        create: jest.fn(({ data }) => {
          const resetToken = {
            id: `reset-${passwordResetTokens.length + 1}`,
            userId: data.userId,
            token: data.token,
            expiresAt: data.expiresAt,
            usedAt: null,
            createdAt: new Date(),
          };
          passwordResetTokens.push(resetToken);
          return Promise.resolve(resetToken);
        }),
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            passwordResetTokens.find((token) => token.token === where.token) ??
              null,
          ),
        ),
        update: jest.fn(({ where, data }) => {
          const resetToken = passwordResetTokens.find(
            (token) => token.id === where.id,
          );
          if (!resetToken) throw new Error('Reset token not found');
          resetToken.usedAt = data.usedAt;
          return Promise.resolve(resetToken);
        }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(EmailService)
      .useValue(emailMock)
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
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers, logs in, refreshes, reads me, and logs out', async () => {
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'new@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'User',
        role: Role.STUDENT,
      })
      .expect(201);

    expect(registerResponse.body.data.accessToken).toBeDefined();
    expect(registerResponse.body.data.refreshToken).toBeDefined();
    expect(registerResponse.body.data.user.passwordHash).toBeUndefined();
    expect(emailMock.sendWelcomeEmail).toHaveBeenCalledWith(
      'new@example.com',
      'New',
    );

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.com', password: 'password123' })
      .expect(200);

    expect(loginResponse.body.data.accessToken).toBeDefined();
    expect(loginResponse.body.data.refreshToken).toBeDefined();
    expect(loginResponse.body.data.user.passwordHash).toBeUndefined();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-refresh-token' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.accessToken).toBeDefined();
      });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.email).toBe('student@example.com');
        expect(response.body.data.passwordHash).toBeUndefined();
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${loginResponse.body.data.accessToken}`)
      .send({ refreshToken: loginResponse.body.data.refreshToken })
      .expect(200)
      .expect({ success: true, data: null });
  });

  it('returns 409 for duplicate email', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'student@example.com',
        password: 'password123',
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.success).toBe(false);
      });
  });

  it('returns 401 for wrong password and invalid refresh token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.com', password: 'wrong-password' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'expired-refresh-token' })
      .expect(401);
  });

  it('sends forgot-password email and resets password with token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'student@example.com' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.message).toBe(
          'If an account exists, a password reset email has been sent',
        );
      });

    expect(passwordResetTokens).toHaveLength(1);
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith(
      'student@example.com',
      expect.stringContaining('/reset-password?token='),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        token: passwordResetTokens[0].token,
        password: 'newpassword123',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.message).toBe('Password reset successful');
      });

    const updatedUser = users.find((user) => user.id === 'user-1');
    expect(updatedUser).toBeDefined();
    await expect(
      bcrypt.compare('newpassword123', updatedUser!.passwordHash),
    ).resolves.toBe(true);
    expect(passwordResetTokens[0].usedAt).toBeInstanceOf(Date);
    expect(refreshTokens).toHaveLength(0);
  });

  it('returns neutral forgot-password response for unknown emails', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.message).toBe(
          'If an account exists, a password reset email has been sent',
        );
      });

    expect(passwordResetTokens).toHaveLength(0);
    expect(emailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
