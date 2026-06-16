import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersRepository } from '@modules/users/users.repository';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let authRepository: jest.Mocked<AuthRepository>;
  let usersRepository: jest.Mocked<UsersRepository>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const userEntity = {
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
    authRepository = {
      createRefreshToken: jest.fn(),
      findRefreshToken: jest.fn(),
      deleteRefreshToken: jest.fn(),
    } as unknown as jest.Mocked<AuthRepository>;
    usersRepository = {
      findAll: jest.fn(),
      findById: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<UsersRepository>;
    jwtService = {
      sign: jest.fn(() => 'access-token'),
    } as unknown as jest.Mocked<JwtService>;
    configService = {
      get: jest.fn((key: string) =>
        key === 'jwt.refreshExpiresIn' ? '7d' : undefined,
      ),
    } as unknown as jest.Mocked<ConfigService>;

    authRepository.createRefreshToken.mockResolvedValue({
      id: 'refresh-1',
      userId: 'user-1',
      token: 'refresh-token',
      expiresAt: new Date(Date.now() + 1000),
      createdAt: new Date(),
    });

    service = new AuthService(
      authRepository,
      usersRepository,
      jwtService,
      configService,
    );
  });

  it('registers a new user and returns tokens', async () => {
    usersRepository.findByEmail.mockResolvedValue(null);
    usersRepository.create.mockResolvedValue(userEntity);
    jest.mocked(bcrypt.hash).mockResolvedValue('hashed-password' as never);

    const result = await service.register({
      email: 'student@example.com',
      password: 'password123',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: Role.STUDENT,
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBeDefined();
    expect(result.user).toEqual(userEntity);
    expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
  });

  it('rejects duplicate email registration', async () => {
    usersRepository.findByEmail.mockResolvedValue({
      ...userEntity,
      passwordHash: 'hashed-password',
    });

    await expect(
      service.register({
        email: 'student@example.com',
        password: 'password123',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with valid credentials', async () => {
    usersRepository.findByEmail.mockResolvedValue({
      ...userEntity,
      passwordHash: 'hashed-password',
    });
    usersRepository.findById.mockResolvedValue(userEntity);
    jest.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const result = await service.login({
      email: 'student@example.com',
      password: 'password123',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.user).toEqual(userEntity);
  });

  it('rejects invalid passwords', async () => {
    usersRepository.findByEmail.mockResolvedValue({
      ...userEntity,
      passwordHash: 'hashed-password',
    });
    jest.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      service.login({ email: 'student@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes a valid refresh token', async () => {
    authRepository.findRefreshToken.mockResolvedValue({
      id: 'refresh-1',
      userId: 'user-1',
      token: 'refresh-token',
      expiresAt: new Date(Date.now() + 1000),
      createdAt: new Date(),
    });
    usersRepository.findById.mockResolvedValue(userEntity);

    await expect(
      service.refresh({ refreshToken: 'refresh-token' }),
    ).resolves.toEqual({ accessToken: 'access-token' });
  });

  it('rejects expired refresh tokens', async () => {
    authRepository.findRefreshToken.mockResolvedValue({
      id: 'refresh-1',
      userId: 'user-1',
      token: 'refresh-token',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });

    await expect(
      service.refresh({ refreshToken: 'refresh-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
