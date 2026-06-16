import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersRepository } from './users.repository';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ data: UserEntity[]; meta: { page: number; limit: number; total: number } }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [users, total] = await this.usersRepository.findAll(
      normalizedPage,
      normalizedLimit,
    );

    return {
      data: users,
      meta: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
      },
    };
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    return this.usersRepository.create(dto, passwordHash);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findById(id);
    return this.usersRepository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.usersRepository.softDelete(id);
  }
}
