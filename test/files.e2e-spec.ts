import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { FileStatus, Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Files endpoints', () => {
  let app: INestApplication;
  let ownerAuthorization: string;
  let otherAuthorization: string;
  let files: any[];

  const ownerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const fileId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    files = [];

    const prismaMock: any = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((arg: any): Promise<any> =>
        Array.isArray(arg) ? Promise.all(arg) : arg(prismaMock),
      ),
      fileRecord: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(files.find((file) => file.id === where.id) ?? null),
        ),
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            files
              .filter(
                (file) =>
                  file.ownerId === where.ownerId &&
                  file.deletedAt === where.deletedAt,
              )
              .slice(skip, skip + take),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            files.filter(
              (file) =>
                file.ownerId === where.ownerId &&
                file.deletedAt === where.deletedAt,
            ).length,
          ),
        ),
        create: jest.fn(({ data }) => {
          const file = {
            id: fileId,
            ownerId: data.ownerId,
            filename: data.filename,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes ?? null,
            r2Key: data.r2Key,
            status: FileStatus.PENDING,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          files.push(file);
          return Promise.resolve(file);
        }),
        update: jest.fn(({ where, data }) => {
          const file = files.find((candidate) => candidate.id === where.id);
          Object.assign(file, data, { updatedAt: new Date() });
          return Promise.resolve(file);
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
    ownerAuthorization = `Bearer ${jwtService.sign({
      sub: ownerId,
      email: 'owner@example.com',
      role: Role.STUDENT,
    })}`;
    otherAuthorization = `Bearer ${jwtService.sign({
      sub: otherId,
      email: 'other@example.com',
      role: Role.STUDENT,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('requests upload, confirms it once, and returns a download URL', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', ownerAuthorization)
      .send({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.data.uploadUrl).toContain('mock=true');
        expect(response.body.data.file).toMatchObject({
          ownerId,
          filename: 'report.pdf',
          status: FileStatus.PENDING,
        });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/files/${fileId}/confirm`)
      .set('Authorization', ownerAuthorization)
      .expect(201)
      .expect((response) => {
        expect(response.body.data.status).toBe(FileStatus.UPLOADED);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/files/${fileId}/confirm`)
      .set('Authorization', ownerAuthorization)
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Authorization', ownerAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.downloadUrl).toContain('mock-r2.example.com');
      });
  });

  it('soft deletes owned files and blocks non-owner deletes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', ownerAuthorization)
      .send({
        filename: 'lecture.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 2048,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', otherAuthorization)
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', ownerAuthorization)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/files/${fileId}`)
      .set('Authorization', ownerAuthorization)
      .expect(404);
  });

  it('rejects unsupported mime types and oversized files', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', ownerAuthorization)
      .send({
        filename: 'script.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .set('Authorization', ownerAuthorization)
      .send({
        filename: 'huge.zip',
        mimeType: 'application/zip',
        sizeBytes: 104857601,
      })
      .expect(400);
  });
});
