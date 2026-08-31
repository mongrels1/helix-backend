import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ParentExperienceService } from './parent-experience.service';

interface AuthenticatedUser {
  userId: string;
  role: Role;
}

class LinkParentStudentDto {
  @IsString()
  parentId!: string;

  @IsString()
  studentId!: string;
}

/**
 * What a parent sends to add a child. `email` is optional on purpose — most
 * children of this age have no address, and requiring one would either block the
 * family or push them into inventing a mailbox. Left blank, the service derives
 * a +alias on the parent's own address.
 */
class AddChildDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  grade?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

@Controller('api/v1/experience/parent')
@Roles(Role.PARENT)
export class ParentExperienceController {
  constructor(private readonly parentExperienceService: ParentExperienceService) {}

  /**
   * Create a child login and link it. Inherits the controller's @Roles(PARENT),
   * so this is the parent's own path — unlike `link` below, which is admin-only
   * and needs a student that already exists.
   */
  @Post('children')
  @HttpCode(201)
  async addChild(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AddChildDto,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['addChild']>> }> {
    const data = await this.parentExperienceService.addChild(user.userId, body);
    return { success: true, data };
  }

  @Post('link')
  @HttpCode(200)
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async link(
    @Body() body: LinkParentStudentDto,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['linkParentToStudent']>> }> {
    const data = await this.parentExperienceService.linkParentToStudent(
      body.parentId,
      body.studentId,
    );
    return { success: true, data };
  }

  @Get('children')
  async children(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildren']>> }> {
    const data = await this.parentExperienceService.getChildren(user.userId);
    return { success: true, data };
  }

  @Get('child/:studentId/attendance')
  async attendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildAttendance']>> }> {
    const data = await this.parentExperienceService.getChildAttendance(user.userId, studentId);
    return { success: true, data };
  }

  @Get('child/:studentId/grades')
  async grades(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildGrades']>> }> {
    const data = await this.parentExperienceService.getChildGrades(user.userId, studentId);
    return { success: true, data };
  }

  @Get('child/:studentId/alerts')
  async alerts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<ParentExperienceService['getChildAlerts']>> }> {
    const data = await this.parentExperienceService.getChildAlerts(user.userId, studentId);
    return { success: true, data };
  }
}
