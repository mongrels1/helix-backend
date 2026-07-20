import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

type AuthenticatedUser = { userId: string; role: Role };

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
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<{ success: true; data: UserEntity }> {
    const isAdmin =
      caller?.role === Role.SUPER_ADMIN || caller?.role === Role.ORG_ADMIN;

    // Non-admins may edit ONLY their own name and declared grade — never
    // role/plan/email or another account. This closes the privilege-escalation
    // hole where any signed-in user could PATCH their own record to
    // { role: 'SUPER_ADMIN' }. Grade is a self-serviceable profile attribute
    // (set at enrollment, or via the diagnostic grade-consent flow).
    if (!isAdmin) {
      if (!caller || caller.userId !== id) {
        throw new ForbiddenException('You can only update your own profile.');
      }
      const allowed = new Set(['firstName', 'lastName', 'grade']);
      const attempted = Object.keys(updateUserDto).filter(
        (key) => !allowed.has(key),
      );
      if (attempted.length > 0) {
        throw new ForbiddenException('You can only update your own profile.');
      }
    }

    // Only a Super Admin may grant the Super Admin role (an Org Admin cannot mint one).
    if (
      updateUserDto.role === Role.SUPER_ADMIN &&
      caller?.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only a Super Admin can grant the Super Admin role.',
      );
    }

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
