import { NotFoundException } from '@nestjs/common';
import { ContentBlockType } from '@prisma/client';
import { ClassroomsRepository } from '@modules/classrooms/classrooms.repository';
import { CoursesRepository } from './courses.repository';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
  let service: CoursesService;
  let coursesRepository: jest.Mocked<CoursesRepository>;
  let classroomsRepository: jest.Mocked<ClassroomsRepository>;

  const course = {
    id: 'course-1',
    title: 'Algebra I',
    description: null,
    classroomId: 'classroom-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  beforeEach(() => {
    coursesRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createCourse: jest.fn(),
      updateCourse: jest.fn(),
      softDeleteCourse: jest.fn(),
      createUnit: jest.fn(),
      updateUnit: jest.fn(),
      softDeleteUnit: jest.fn(),
      getUnits: jest.fn(),
      findUnitById: jest.fn(),
      createSection: jest.fn(),
      updateSection: jest.fn(),
      softDeleteSection: jest.fn(),
      getSections: jest.fn(),
      findSectionById: jest.fn(),
      createContentBlock: jest.fn(),
      updateContentBlock: jest.fn(),
      softDeleteContentBlock: jest.fn(),
      getContentBlocks: jest.fn(),
      findContentBlockById: jest.fn(),
    } as unknown as jest.Mocked<CoursesRepository>;
    classroomsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByTeacher: jest.fn(),
      findByStudent: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      enroll: jest.fn(),
      unenroll: jest.fn(),
      getEnrollments: jest.fn(),
      isEnrolled: jest.fn(),
    } as unknown as jest.Mocked<ClassroomsRepository>;

    service = new CoursesService(coursesRepository, classroomsRepository);
  });

  it('creates a course when classroom exists', async () => {
    classroomsRepository.findById.mockResolvedValue({
      id: 'classroom-1',
      name: 'Room A',
      description: null,
      organizationId: 'org-1',
      teacherId: 'teacher-1',
      enrollmentCount: 0,
      createdAt: new Date(),
    });
    coursesRepository.createCourse.mockResolvedValue(course);

    await expect(
      service.createCourse({ title: 'Algebra I', classroomId: 'classroom-1' }),
    ).resolves.toEqual(course);
  });

  it('rejects courses for missing classrooms', async () => {
    classroomsRepository.findById.mockResolvedValue(null);

    await expect(
      service.createCourse({ title: 'Algebra I', classroomId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verifies parents before creating child resources', async () => {
    coursesRepository.findById.mockResolvedValue(course);
    coursesRepository.createUnit.mockResolvedValue({
      id: 'unit-1',
      title: 'Unit 1',
      order: 0,
      courseId: 'course-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    coursesRepository.findUnitById.mockResolvedValue({
      id: 'unit-1',
      title: 'Unit 1',
      order: 0,
      courseId: 'course-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    coursesRepository.createSection.mockResolvedValue({
      id: 'section-1',
      title: 'Section 1',
      order: 0,
      unitId: 'unit-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    coursesRepository.findSectionById.mockResolvedValue({
      id: 'section-1',
      title: 'Section 1',
      order: 0,
      unitId: 'unit-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    coursesRepository.createContentBlock.mockResolvedValue({
      id: 'block-1',
      type: ContentBlockType.VIDEO,
      title: 'Intro',
      content: 'https://example.com/video',
      order: 0,
      sectionId: 'section-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    await expect(service.createUnit('course-1', { title: 'Unit 1', order: 0 })).resolves.toMatchObject({ id: 'unit-1' });
    await expect(service.createSection('unit-1', { title: 'Section 1', order: 0 })).resolves.toMatchObject({ id: 'section-1' });
    await expect(service.createContentBlock('section-1', { type: ContentBlockType.VIDEO, title: 'Intro', content: 'url', order: 0 })).resolves.toMatchObject({ id: 'block-1' });
  });
});
