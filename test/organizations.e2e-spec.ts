import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Organizations endpoints', () => {
  let app: INestApplication;
  let authorization: string;
  let organizations: Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }>;
  let users: Array<{
    id: string;
    email: string;
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
  let memberships: Array<{
    id: string;
    userId: string;
    organizationId: string;
    role: Role;
    createdAt: Date;
  }>;

  const publicOrganization = (organization: (typeof organizations)[number]) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    createdAt: organization.createdAt,
    _count: {
      memberships: memberships.filter(
        (membership) => membership.organizationId === organization.id,
      ).length,
    },
  });

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
    organizations = [
      {
        id: 'org-1',
        name: 'Helix Academy',
        slug: 'helix-academy',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    users = [
      {
        id: 'user-1',
        email: 'teacher@example.com',
        role: Role.TEACHER,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        profile: {
          firstName: 'Grace',
          lastName: 'Hopper',
          avatarUrl: null,
        },
      },
    ];
    memberships = [];

    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
      organization: {
        findMany: jest.fn(({ skip = 0, take = 20 }) =>
          Promise.resolve(
            organizations
              .filter((organization) => organization.deletedAt === null)
              .slice(skip, skip + take)
              .map(publicOrganization),
          ),
        ),
        count: jest.fn(() =>
          Promise.resolve(
            organizations.filter(
              (organization) => organization.deletedAt === null,
            ).length,
          ),
        ),
        findFirst: jest.fn(({ where }) => {
          const organization = organizations.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const slugMatches =
              where.slug === undefined || candidate.slug === where.slug;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;

            return idMatches && slugMatches && deletedAtMatches;
          });

          return Promise.resolve(
            organization ? publicOrganization(organization) : null,
          );
        }),
        create: jest.fn(({ data }) => {
          const organization = {
            id: 'org-2',
            name: data.name,
            slug: data.slug,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: null,
          };
          organizations.push(organization);
          return Promise.resolve(publicOrganization(organization));
        }),
        updateMany: jest.fn(({ where, data }) => {
          const organization = organizations.find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.deletedAt === where.deletedAt,
          );
          if (organization) {
            Object.assign(organization, data, { updatedAt: new Date() });
          }
          return Promise.resolve({ count: organization ? 1 : 0 });
        }),
      },
      membership: {
        upsert: jest.fn(({ where, update, create }) => {
          const existing = memberships.find(
            (membership) =>
              membership.userId === where.userId_organizationId.userId &&
              membership.organizationId ===
                where.userId_organizationId.organizationId,
          );

          if (existing) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }

          const membership = {
            id: 'membership-1',
            userId: create.userId,
            organizationId: create.organizationId,
            role: create.role,
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
          };
          memberships.push(membership);
          return Promise.resolve(membership);
        }),
        deleteMany: jest.fn(({ where }) => {
          const before = memberships.length;
          memberships = memberships.filter(
            (membership) =>
              !(
                membership.organizationId === where.organizationId &&
                membership.userId === where.userId
              ),
          );
          return Promise.resolve({ count: before - memberships.length });
        }),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            memberships.filter((membership) => {
              const organization = organizations.find(
                (candidate) => candidate.id === membership.organizationId,
              );

              return (
                membership.organizationId === where.organizationId &&
                organization?.deletedAt === null
              );
            }),
          ),
        ),
      },
      user: {
        findFirst: jest.fn(({ where }) => {
          const user = users.find((candidate) => {
            const idMatches = where.id === undefined || candidate.id === where.id;
            const deletedAtMatches =
              where.deletedAt === undefined ||
              candidate.deletedAt === where.deletedAt;
            return idMatches && deletedAtMatches;
          });

          return Promise.resolve(user ? publicUser(user) : null);
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
      email: 'teacher@example.com',
      role: Role.TEACHER,
    })}`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates, lists, reads, updates, and soft deletes organizations', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'New School', slug: 'new-school' })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: true,
          data: { name: 'New School', slug: 'new-school' },
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/organizations')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.success).toBe(true);
        expect(response.body.meta.total).toBe(2);
      });

    await request(app.getHttpServer())
      .get('/api/v1/organizations/org-1')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.slug).toBe('helix-academy');
      });

    await request(app.getHttpServer())
      .patch('/api/v1/organizations/org-1')
      .set('Authorization', authorization)
      .send({ name: 'Helix Institute' })
      .expect(200)
      .expect((response) => {
        expect(response.body.data.name).toBe('Helix Institute');
      });

    await request(app.getHttpServer())
      .delete('/api/v1/organizations/org-1')
      .set('Authorization', authorization)
      .expect(200)
      .expect({ success: true, data: null });

    await request(app.getHttpServer())
      .get('/api/v1/organizations/org-1')
      .set('Authorization', authorization)
      .expect(404);
  });

  it('returns 409 for duplicate slug', () => {
    return request(app.getHttpServer())
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Duplicate', slug: 'helix-academy' })
      .expect(409)
      .expect((response) => {
        expect(response.body.success).toBe(false);
      });
  });

  it('adds, lists, and removes organization members', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/organizations/org-1/members')
      .set('Authorization', authorization)
      .send({ userId: 'user-1', role: Role.TEACHER })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          organizationId: 'org-1',
          userId: 'user-1',
          role: Role.TEACHER,
        });
      });

    await request(app.getHttpServer())
      .get('/api/v1/organizations/org-1/members')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(1);
      });

    await request(app.getHttpServer())
      .delete('/api/v1/organizations/org-1/members/user-1')
      .set('Authorization', authorization)
      .expect(200)
      .expect({ success: true, data: null });

    await request(app.getHttpServer())
      .get('/api/v1/organizations/org-1/members')
      .set('Authorization', authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(0);
      });
  });

  it('returns 404 when adding a missing user', () => {
    return request(app.getHttpServer())
      .post('/api/v1/organizations/org-1/members')
      .set('Authorization', authorization)
      .send({ userId: 'missing-user', role: Role.STUDENT })
      .expect(404)
      .expect((response) => {
        expect(response.body.success).toBe(false);
      });
  });
});
