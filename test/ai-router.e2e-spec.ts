import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AI Router endpoints', () => {
  let app: INestApplication;
  let adminAuthorization: string;
  let studentAuthorization: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => {
          if (key === 'jwt.secret') return 'test-secret';
          if (key === 'ai.openaiKey') return 'openai-key';
          if (key === 'ai.googleKey') return '';
          if (key === 'ai.anthropicKey') return '';
          return '';
        }),
      })
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
    adminAuthorization = `Bearer ${jwtService.sign({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: Role.ORG_ADMIN,
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

  it('returns provider configured status for admins', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/providers')
      .set('Authorization', adminAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          success: true,
          data: {
            providers: [
              { name: 'openai', configured: true },
              { name: 'gemini', configured: false },
              { name: 'claude', configured: false },
            ],
          },
        });
      });
  });

  it('blocks non-admin users from provider diagnostics', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ai/providers')
      .set('Authorization', studentAuthorization)
      .expect(403);
  });
});
