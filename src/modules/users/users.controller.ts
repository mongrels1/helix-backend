import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: UserEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.usersService.findAll(page, limit);
    return { success: true, ...result };
  }

  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.usersService.create(createUserDto);
    return { success: true, data: user };
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.usersService.findById(id);
    return { success: true, data: user };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.usersService.update(id, updateUserDto);
    return { success: true, data: user };
  }

  @Patch(':id/suspend')
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN)
  async suspend(
    @Param('id') id: string,
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.usersService.suspend(id);
    return { success: true, data: user };
  }

  @Patch(':id/restore')
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN)
  async restore(
    @Param('id') id: string,
  ): Promise<{ success: true; data: UserEntity }> {
    const user = await this.usersService.restore(id);
    return { success: true, data: user };
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.ORG_ADMIN)
  async remove(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.usersService.remove(id);
    return { success: true, data: null };
  }
}
