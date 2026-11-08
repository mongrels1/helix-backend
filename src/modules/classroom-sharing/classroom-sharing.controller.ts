import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { ClassroomSharingService } from './classroom-sharing.service';
import { AcceptInviteDto, InviteTeacherDto, SetShareRoleDto } from './dto/sharing.dto';

type Caller = { userId: string; role: Role; email?: string };
const STAFF = [Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN] as const;

@Controller('api/v1/classroom-sharing')
export class ClassroomSharingController {
  constructor(private readonly sharing: ClassroomSharingService) {}

  @Get('classrooms/:id')
  @Roles(...STAFF)
  async list(@Param('id') id: string, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.list(id, user) };
  }

  @Post('invites')
  @Roles(...STAFF)
  async invite(@Body() dto: InviteTeacherDto, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.invite(user, dto.email, dto.role, dto.classroomIds) };
  }

  @Delete('invites/:inviteId')
  @Roles(...STAFF)
  async cancel(@Param('inviteId') inviteId: string, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.cancelInvite(user, inviteId) };
  }

  @Patch('classrooms/:id/teachers/:userId')
  @Roles(...STAFF)
  async setRole(@Param('id') id: string, @Param('userId') userId: string, @Body() dto: SetShareRoleDto, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.setRole(user, id, userId, dto.role) };
  }

  @Delete('classrooms/:id/teachers/:userId')
  @Roles(...STAFF)
  async remove(@Param('id') id: string, @Param('userId') userId: string, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.remove(user, id, userId) };
  }

  /** Signed in: what this invitation is for (no student data). */
  @Post('preview')
  async preview(@Body() dto: AcceptInviteDto, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.preview(user, dto.token) };
  }

  @Post('accept')
  async accept(@Body() dto: AcceptInviteDto, @CurrentUser() user: Caller) {
    return { success: true, data: await this.sharing.accept(user, dto.token) };
  }
}
