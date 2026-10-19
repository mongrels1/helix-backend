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
import { SpamPurgeDto } from './dto/spam-purge.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './users.service';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ---- Spam cleanup (super admin) ----
  @Post('spam/scan')
  @Roles(Role.SUPER_ADMIN)
  async spamScan(@Body() dto: SpamPurgeDto): Promise<{
    success: true;
    data: { count: number; olderThanHours: number; sample: Array<{ id: string; email: string; name: string; createdAt: Date }> };
  }> {
    const data = await this.usersService.scanSpam(dto.olderThanHours);
    return { success: true, data };
  }

  @Post('spam/purge')
  @Roles(Role.SUPER_ADMIN)
  async spamPurge(
    @Body() dto: SpamPurgeDto,
  ): Promise<{ success: true; data: { softDeleted: number; count: number } }> {
    const data = await this.usersService.purgeSpam(dto.olderThanHours, dto.expectedCount);
    return { success: true, data };
  }

  /**
   * User search. Used by "Enroll Student" (teachers) and admin screens.
   * Before 19 Oct 2026 this ignored `role` and `search` and returned the newest users
   * of every role to any signed-in account, so a student older than the newest ten
   * could never be found and anyone could list everyone. Now:
   *  - only teachers and admins may call it;
   *  - `search` matches first name, last name or email (case-insensitive);
   *  - a teacher only ever gets STUDENT accounts, and must type at least 2 characters.
   */
  @Get()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async findAll(
    @CurrentUser() caller: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('role') role?: string,
    @Query('search') search?: string,
  ): Promise<{
    success: true;
    data: UserEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const term = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    const isTeacher = caller?.role === Role.TEACHER;
    const wantedRole = isTeacher
      ? Role.STUDENT
      : (Object.values(Role) as string[]).includes(String(role))
        ? (role as Role)
        : undefined;
    if (isTeacher && term.length < 2) {
      return { success: true, data: [], meta: { page: 1, limit, total: 0 } };
    }
    const result = await this.usersService.findAll(page, limit, { role: wantedRole, search: term || undefined });
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
