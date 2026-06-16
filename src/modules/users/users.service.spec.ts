import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<UsersRepository>;

  const user = {
    id: 'user-1',
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
    repository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;

    service = new UsersService(repository);
  });

  it('returns paginated users', async () => {
    repository.findAll.mockResolvedValue([[user], 1]);

    await expect(service.findAll(1, 20)).resolves.toEqual({
      data: [user],
      meta: { page: 1, limit: 20, total: 1 },
    });
    expect(repository.findAll).toHaveBeenCalledWith(1, 20);
  });

  it('hashes passwords before create', async () => {
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);
    repository.create.mockResolvedValue(user);

    await expect(
      service.create({
        email: 'student@example.com',
        password: 'password123',
        role: Role.STUDENT,
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).resolves.toEqual(user);

    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'password123' }),
      'hashed-password',
    );
  });

  it('throws when a user cannot be found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.findById('missing-user')).rejects.toThrow('User not found');
  });

  it('soft deletes existing users', async () => {
    repository.findById.mockResolvedValue(user);
    repository.softDelete.mockResolvedValue();

    await service.remove('user-1');

    expect(repository.softDelete).toHaveBeenCalledWith('user-1');
  });
});
