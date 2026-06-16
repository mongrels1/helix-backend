import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrganizationsRepository } from '@modules/organizations/organizations.repository';
import { UsersRepository } from '@modules/users/users.repository';
import { ClassroomsRepository } from './classrooms.repository';
import { ClassroomsService } from './classrooms.service';

describe('ClassroomsService', () => {
  let service: ClassroomsService;
  let classroomsRepository: jest.Mocked<ClassroomsRepository>;
  let organizationsRepository: jest.Mocked<OrganizationsRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;

  const classroom = {
    id: 'classroom-1',
    name: 'Algebra I',
    description: null,
    organizationId: 'org-1',
    teacherId: 'teacher-1',
    enrollmentCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  const organization = {
    id: 'org-1',
    name: 'Helix Academy',
    slug: 'helix-academy',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    memberCount: 0,
  };

  const student = {
    id: 'student-1',
    email: 'student@example.com',
    role: Role.STUDENT,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    profile: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatarUrl: null,
    },
  };

  beforeEach(() => {
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

    organizationsRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      addMember: jest.fn(),
      removeMember: jest.fn(),
      getMembers: jest.fn(),
    } as unknown as jest.Mocked<OrganizationsRepository>;

    usersRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    service = new ClassroomsService(
      classroomsRepository,
      organizationsRepository,
      usersRepository,
    );
  });

  it('creates a classroom when organization exists', async () => {
    organizationsRepository.findById.mockResolvedValue(organization);
    classroomsRepository.create.mockResolvedValue(classroom);

    await expect(
      service.create(
        { name: 'Algebra I', organizationId: 'org-1' },
        'teacher-1',
      ),
    ).resolves.toEqual(classroom);
  });

  it('throws when creating for a missing organization', async () => {
    organizationsRepository.findById.mockResolvedValue(null);

    await expect(
      service.create(
        { name: 'Algebra I', organizationId: 'missing-org' },
        'teacher-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows owning teacher to update', async () => {
    classroomsRepository.findById.mockResolvedValue(classroom);
    classroomsRepository.update.mockResolvedValue({
      ...classroom,
      name: 'Geometry',
    });

    await expect(
      service.update(
        'classroom-1',
        { name: 'Geometry' },
        { userId: 'teacher-1', email: 'teacher@example.com', role: Role.TEACHER },
      ),
    ).resolves.toMatchObject({ name: 'Geometry' });
  });

  it('blocks non-owning teacher updates', async () => {
    classroomsRepository.findById.mockResolvedValue(classroom);

    await expect(
      service.update(
        'classroom-1',
        { name: 'Geometry' },
        { userId: 'teacher-2', email: 'teacher2@example.com', role: Role.TEACHER },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws conflict for duplicate enrollment', async () => {
    classroomsRepository.findById.mockResolvedValue(classroom);
    usersRepository.findById.mockResolvedValue(student);
    classroomsRepository.isEnrolled.mockResolvedValue(true);

    await expect(
      service.enroll('classroom-1', { studentId: 'student-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
