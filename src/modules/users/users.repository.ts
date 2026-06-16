import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

const userSelect = {
  id: true,
  email: true,
  role: true,
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
      where: { email, deletedAt: null },
    });
  }

  async create(data: CreateUserDto, passwordHash: string): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        email: data.email,
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
