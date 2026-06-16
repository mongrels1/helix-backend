import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Messaging endpoints', () => {
  let app: INestApplication;
  let creatorAuthorization: string;
  let participantAuthorization: string;
  let outsiderAuthorization: string;
  let threads: any[];
  let participants: any[];
  let messages: any[];

  const creatorId = '11111111-1111-4111-8111-111111111111';
  const participantId = '22222222-2222-4222-8222-222222222222';
  const outsiderId = '33333333-3333-4333-8333-333333333333';
  const threadId = '44444444-4444-4444-8444-444444444444';

  const threadDetail = (thread: any) => ({
    ...thread,
    participants: participants.filter((item) => item.threadId === thread.id),
    messages: messages
      .filter((message) => message.threadId === thread.id)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 50),
  });

  beforeEach(async () => {
    threads = [];
    participants = [];
    messages = [];

    let prismaMock: any;
    prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((arg: any): Promise<any> =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock),
      ),
      thread: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            threads
              .filter((thread) =>
                participants.some(
                  (participant) =>
                    participant.threadId === thread.id &&
                    participant.userId === where.participants.some.userId,
                ),
              )
              .slice(skip, skip + take)
              .map((thread) => ({
                ...thread,
                messages: messages
                  .filter((message) => message.threadId === thread.id)
                  .sort(
                    (left, right) =>
                      right.createdAt.getTime() - left.createdAt.getTime(),
                  )
                  .slice(0, 1),
                _count: {
                  participants: participants.filter(
                    (participant) => participant.threadId === thread.id,
                  ).length,
                },
              })),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            threads.filter((thread) =>
              participants.some(
                (participant) =>
                  participant.threadId === thread.id &&
                  participant.userId === where.participants.some.userId,
              ),
            ).length,
          ),
        ),
        findUnique: jest.fn(({ where }) => {
          const thread = threads.find((candidate) => candidate.id === where.id);
          return Promise.resolve(thread ? threadDetail(thread) : null);
        }),
        create: jest.fn(({ data }) => {
          const thread = {
            id: threadId,
            subject: data.subject ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          threads.push(thread);
          data.participants.create.forEach((participant: { userId: string }) => {
            participants.push({
              id: `participant-${participants.length + 1}`,
              threadId: thread.id,
              userId: participant.userId,
              joinedAt: new Date(),
            });
          });
          return Promise.resolve(threadDetail(thread));
        }),
      },
      threadParticipant: {
        count: jest.fn(({ where }) =>
          Promise.resolve(
            participants.filter(
              (participant) =>
                participant.threadId === where.threadId &&
                participant.userId === where.userId,
            ).length,
          ),
        ),
      },
      message: {
        create: jest.fn(({ data }) => {
          const message = {
            id: `message-${messages.length + 1}`,
            threadId: data.threadId,
            senderId: data.senderId,
            content: data.content,
            createdAt: new Date(Date.now() + messages.length),
          };
          messages.push(message);
          const thread = threads.find((candidate) => candidate.id === data.threadId);
          if (thread) thread.updatedAt = new Date();
          return Promise.resolve(message);
        }),
        findMany: jest.fn(({ where, skip = 0, take = 50 }) =>
          Promise.resolve(
            messages
              .filter((message) => message.threadId === where.threadId)
              .sort(
                (left, right) =>
                  left.createdAt.getTime() - right.createdAt.getTime(),
              )
              .slice(skip, skip + take),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            messages.filter((message) => message.threadId === where.threadId)
              .length,
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
    creatorAuthorization = `Bearer ${jwtService.sign({
      sub: creatorId,
      email: 'creator@example.com',
      role: Role.TEACHER,
    })}`;
    participantAuthorization = `Bearer ${jwtService.sign({
      sub: participantId,
      email: 'participant@example.com',
      role: Role.STUDENT,
    })}`;
    outsiderAuthorization = `Bearer ${jwtService.sign({
      sub: outsiderId,
      email: 'outsider@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a thread and auto-adds the creator as a participant', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/threads')
      .set('Authorization', creatorAuthorization)
      .send({ subject: 'Planning', participantIds: [participantId] })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.participants.map((item: any) => item.userId)).toEqual([
          creatorId,
          participantId,
        ]);
      });
  });

  it('returns only threads where the current user is a participant', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/threads')
      .set('Authorization', creatorAuthorization)
      .send({ subject: 'Planning', participantIds: [participantId] })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/v1/threads')
      .set('Authorization', participantAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .get('/api/v1/threads')
      .set('Authorization', outsiderAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(0);
      });
  });

  it('returns message history and blocks non-participants from sending', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/threads')
      .set('Authorization', creatorAuthorization)
      .send({ subject: 'Planning', participantIds: [participantId] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/threads/${threadId}/messages`)
      .set('Authorization', creatorAuthorization)
      .send({ content: 'Hello' })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          threadId,
          senderId: creatorId,
          content: 'Hello',
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/threads/${threadId}/messages`)
      .set('Authorization', participantAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].content).toBe('Hello');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/threads/${threadId}/messages`)
      .set('Authorization', outsiderAuthorization)
      .send({ content: 'No access' })
      .expect(403);
  });
});
