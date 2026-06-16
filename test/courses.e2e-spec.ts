import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { ContentBlockType, Role } from '@prisma/client';
import request = require('supertest');
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Courses endpoints', () => {
  let app: INestApplication;
  let teacherAuthorization: string;
  let studentAuthorization: string;
  let courses: any[];
  let units: any[];
  let sections: any[];
  let contentBlocks: any[];

  const classroomId = '44444444-4444-4444-8444-444444444444';
  const courseId = '88888888-8888-4888-8888-888888888888';
  const unitId = '99999999-9999-4999-8999-999999999999';
  const sectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const blockId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const fullCourse = (course: any) => ({
    ...course,
    units: units
      .filter((unit) => unit.courseId === course.id && unit.deletedAt === null)
      .sort((a, b) => a.order - b.order)
      .map((unit) => ({
        ...unit,
        sections: sections
          .filter((section) => section.unitId === unit.id && section.deletedAt === null)
          .sort((a, b) => a.order - b.order)
          .map((section) => ({
            ...section,
            contentBlocks: contentBlocks
              .filter((block) => block.sectionId === section.id && block.deletedAt === null)
              .sort((a, b) => a.order - b.order),
          })),
      })),
  });

  beforeEach(async () => {
    courses = [
      {
        id: courseId,
        title: 'Algebra I',
        description: null,
        classroomId,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    units = [
      {
        id: unitId,
        title: 'Foundations',
        order: 0,
        courseId,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    sections = [
      {
        id: sectionId,
        title: 'Variables',
        order: 0,
        unitId,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        deletedAt: null,
      },
    ];
    contentBlocks = [
      {
        id: blockId,
        type: ContentBlockType.VIDEO,
        title: 'Intro Video',
        content: 'https://example.com/video',
        order: 0,
        sectionId,
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        updatedAt: new Date('2026-01-04T00:00:00.000Z'),
        deletedAt: null,
      },
    ];

    const prismaMock = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      $transaction: jest.fn((operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
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
      course: {
        findMany: jest.fn(({ where, skip = 0, take = 20 }) =>
          Promise.resolve(
            courses
              .filter(
                (course) =>
                  course.classroomId === where.classroomId &&
                  course.deletedAt === where.deletedAt,
              )
              .slice(skip, skip + take)
              .map((course) => ({
                ...course,
                _count: {
                  units: units.filter((unit) => unit.courseId === course.id).length,
                },
              })),
          ),
        ),
        count: jest.fn(({ where }) =>
          Promise.resolve(
            courses.filter(
              (course) =>
                course.classroomId === where.classroomId &&
                course.deletedAt === where.deletedAt,
            ).length,
          ),
        ),
        findFirst: jest.fn(({ where, include }) => {
          const course = courses.find(
            (candidate) =>
              candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (!course) return Promise.resolve(null);
          return Promise.resolve(include ? fullCourse(course) : course);
        }),
        create: jest.fn(({ data }) => {
          const course = {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            title: data.title,
            description: data.description ?? null,
            classroomId: data.classroomId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          courses.push(course);
          return Promise.resolve(course);
        }),
        updateMany: jest.fn(({ where, data }) => {
          const course = courses.find(
            (candidate) => candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (course) Object.assign(course, data, { updatedAt: new Date() });
          return Promise.resolve({ count: course ? 1 : 0 });
        }),
      },
      unit: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            units.find(
              (unit) => unit.id === where.id && unit.deletedAt === where.deletedAt,
            ) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            units.filter(
              (unit) => unit.courseId === where.courseId && unit.deletedAt === where.deletedAt,
            ),
          ),
        ),
        create: jest.fn(({ data }) => {
          const unit = {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            title: data.title,
            order: data.order,
            courseId: data.courseId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          units.push(unit);
          return Promise.resolve(unit);
        }),
        update: jest.fn(({ where, data }) => {
          const unit = units.find((candidate) => candidate.id === where.id);
          Object.assign(unit, data, { updatedAt: new Date() });
          return Promise.resolve(unit);
        }),
        updateMany: jest.fn(({ where, data }) => {
          const unit = units.find(
            (candidate) => candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (unit) Object.assign(unit, data, { updatedAt: new Date() });
          return Promise.resolve({ count: unit ? 1 : 0 });
        }),
      },
      section: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            sections.find(
              (section) => section.id === where.id && section.deletedAt === where.deletedAt,
            ) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            sections.filter(
              (section) => section.unitId === where.unitId && section.deletedAt === where.deletedAt,
            ),
          ),
        ),
        create: jest.fn(({ data }) => {
          const section = {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            title: data.title,
            order: data.order,
            unitId: data.unitId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          sections.push(section);
          return Promise.resolve(section);
        }),
        update: jest.fn(({ where, data }) => {
          const section = sections.find((candidate) => candidate.id === where.id);
          Object.assign(section, data, { updatedAt: new Date() });
          return Promise.resolve(section);
        }),
        updateMany: jest.fn(({ where, data }) => {
          const section = sections.find(
            (candidate) => candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (section) Object.assign(section, data, { updatedAt: new Date() });
          return Promise.resolve({ count: section ? 1 : 0 });
        }),
      },
      contentBlock: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            contentBlocks.find(
              (block) => block.id === where.id && block.deletedAt === where.deletedAt,
            ) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }) =>
          Promise.resolve(
            contentBlocks.filter(
              (block) => block.sectionId === where.sectionId && block.deletedAt === where.deletedAt,
            ),
          ),
        ),
        create: jest.fn(({ data }) => {
          const block = {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            type: data.type,
            title: data.title,
            content: data.content,
            order: data.order,
            sectionId: data.sectionId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          contentBlocks.push(block);
          return Promise.resolve(block);
        }),
        update: jest.fn(({ where, data }) => {
          const block = contentBlocks.find((candidate) => candidate.id === where.id);
          Object.assign(block, data, { updatedAt: new Date() });
          return Promise.resolve(block);
        }),
        updateMany: jest.fn(({ where, data }) => {
          const block = contentBlocks.find(
            (candidate) => candidate.id === where.id && candidate.deletedAt === where.deletedAt,
          );
          if (block) Object.assign(block, data, { updatedAt: new Date() });
          return Promise.resolve({ count: block ? 1 : 0 });
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
    teacherAuthorization = `Bearer ${jwtService.sign({
      sub: 'teacher-1',
      email: 'teacher@example.com',
      role: Role.TEACHER,
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

  it('creates courses and rejects invalid classrooms and student writers', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', teacherAuthorization)
      .send({ title: 'Geometry', classroomId })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', teacherAuthorization)
      .send({ title: 'Missing', classroomId: '11111111-1111-4111-8111-111111111111' })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/courses')
      .set('Authorization', studentAuthorization)
      .send({ title: 'Student Course', classroomId })
      .expect(403);
  });

  it('returns a full nested course tree', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/courses/${courseId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data.units[0].sections[0].contentBlocks[0]).toMatchObject({
          title: 'Intro Video',
        });
      });
  });

  it('creates all four hierarchy levels', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/courses/${courseId}/units`)
      .set('Authorization', teacherAuthorization)
      .send({ title: 'Unit 2', order: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/units/${unitId}/sections`)
      .set('Authorization', teacherAuthorization)
      .send({ title: 'Expressions', order: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/content`)
      .set('Authorization', teacherAuthorization)
      .send({
        type: ContentBlockType.DOCUMENT,
        title: 'Reading',
        content: 'Read chapter 1',
        order: 1,
      })
      .expect(201);
  });

  it('soft deletes courses and excludes them from lists', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/courses/${courseId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/courses?classroomId=${classroomId}`)
      .set('Authorization', teacherAuthorization)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toHaveLength(0);
      });
  });
});
