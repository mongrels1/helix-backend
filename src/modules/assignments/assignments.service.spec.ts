import { ConflictException, NotFoundException } from '@nestjs/common';
import { ClassroomsRepository } from '@modules/classrooms/classrooms.repository';
import { CoursesRepository } from '@modules/courses/courses.repository';
import { AssignmentsRepository } from './assignments.repository';
import { AssignmentsService } from './assignments.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let assignmentsRepository: jest.Mocked<AssignmentsRepository>;
  let classroomsRepository: jest.Mocked<ClassroomsRepository>;
  let coursesRepository: jest.Mocked<CoursesRepository>;

  const assignment = {
    id: 'assignment-1',
    title: 'Essay',
    description: null,
    dueAt: null,
    maxScore: 100,
    skillTags: [],
    classroomId: 'classroom-1',
    courseId: null,
    rubric: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    assignmentsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findOverdue: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      createRubric: jest.fn(),
      updateRubric: jest.fn(),
      deleteRubric: jest.fn(),
    } as unknown as jest.Mocked<AssignmentsRepository>;
    classroomsRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ClassroomsRepository>;
    coursesRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CoursesRepository>;
    service = new AssignmentsService(
      assignmentsRepository,
      classroomsRepository,
      coursesRepository,
    );
  });

  it('creates when classroom exists', async () => {
    classroomsRepository.findById.mockResolvedValue({
      id: 'classroom-1',
      name: 'Room',
      description: null,
      organizationId: 'org-1',
      teacherId: 'teacher-1',
      enrollmentCount: 0,
      createdAt: new Date(),
    });
    assignmentsRepository.create.mockResolvedValue(assignment);
    await expect(
      service.create({ title: 'Essay', classroomId: 'classroom-1' }),
    ).resolves.toEqual(assignment);
  });

  it('rejects missing classrooms', async () => {
    classroomsRepository.findById.mockResolvedValue(null);
    await expect(
      service.create({ title: 'Essay', classroomId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate rubric', async () => {
    assignmentsRepository.findById.mockResolvedValue({
      ...assignment,
      rubric: { id: 'rubric-1', title: 'Rubric', criteria: [] },
    });
    await expect(
      service.createRubric('assignment-1', { title: 'Rubric', criteria: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
