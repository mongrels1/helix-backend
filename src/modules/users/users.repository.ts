import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

/**
 * Canonical email form so one person maps to exactly ONE account regardless of
 * the casing/whitespace they (or an upstream purchase webhook) send. Writes are
 * stored canonical; reads match case-insensitively so pre-existing mixed-case
 * rows are still found without a data migration.
 */
export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

const userSelect = {
  id: true,
  email: true,
  role: true,
  plan: true,
  planStatus: true,
  planRenewsAt: true,
  maxStudents: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  profile: {
    select: {
      firstName: true,
      lastName: true,
      avatarUrl: true,
    },
  },
};

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number): Promise<[UserEntity[], number]> {
    const skip = (page - 1) * limit;
    const where = { deletedAt: null };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return [users, total];
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: userSelect,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        email: { equals: normalizeEmail(email), mode: 'insensitive' },
        deletedAt: null,
      },
    });
  }

  async create(data: CreateUserDto, passwordHash: string): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: normalizeEmail(data.email),
        passwordHash,
        role: data.role,
        profile: {
          create: {
            firstName: data.firstName,
            lastName: data.lastName,
          },
        },
      },
      select: userSelect,
    });
  }

  async update(id: string, data: UpdateUserDto): Promise<UserEntity> {
    const { firstName, lastName, password, ...userData } = data;

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id, deletedAt: null },
        data: userData,
      }),
      ...(firstName !== undefined || lastName !== undefined
        ? [
            this.prisma.profile.updateMany({
              where: { userId: id, user: { deletedAt: null } },
              data: {
                ...(firstName !== undefined ? { firstName } : {}),
                ...(lastName !== undefined ? { lastName } : {}),
              },
            }),
          ]
        : []),
    ]);

    const user = await this.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    return user;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
