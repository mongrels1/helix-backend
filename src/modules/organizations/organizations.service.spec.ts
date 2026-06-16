import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersRepository } from '@modules/users/users.repository';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let organizationsRepository: jest.Mocked<OrganizationsRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;

  const organization = {
    id: 'org-1',
    name: 'Helix Academy',
    slug: 'helix-academy',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    memberCount: 1,
  };

  const user = {
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
  };

  beforeEach(() => {
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

    service = new OrganizationsService(
      organizationsRepository,
      usersRepository,
    );
  });

  it('returns paginated organizations', async () => {
    organizationsRepository.findAll.mockResolvedValue([[organization], 1]);

    await expect(service.findAll(1, 20)).resolves.toEqual({
      data: [organization],
      meta: { page: 1, limit: 20, total: 1 },
    });
  });

  it('throws ConflictException for duplicate slugs', async () => {
    organizationsRepository.findBySlug.mockResolvedValue(organization);

    await expect(
      service.create({ name: 'Helix Academy', slug: 'helix-academy' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates an organization when slug is available', async () => {
    organizationsRepository.findBySlug.mockResolvedValue(null);
    organizationsRepository.create.mockResolvedValue(organization);

    await expect(
      service.create({ name: 'Helix Academy', slug: 'helix-academy' }),
    ).resolves.toEqual(organization);
  });

  it('throws NotFoundException for missing organizations', async () => {
    organizationsRepository.findById.mockResolvedValue(null);

    await expect(service.findById('missing-org')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when adding a missing user', async () => {
    organizationsRepository.findById.mockResolvedValue(organization);
    usersRepository.findById.mockResolvedValue(null);

    await expect(
      service.addMember('org-1', { userId: 'missing-user', role: Role.TEACHER }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds existing users as members', async () => {
    const membership = {
      id: 'membership-1',
      organizationId: 'org-1',
      userId: 'user-1',
      role: Role.TEACHER,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    organizationsRepository.findById.mockResolvedValue(organization);
    usersRepository.findById.mockResolvedValue(user);
    organizationsRepository.addMember.mockResolvedValue(membership);

    await expect(
      service.addMember('org-1', { userId: 'user-1', role: Role.TEACHER }),
    ).resolves.toEqual(membership);
  });
});
