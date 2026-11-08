import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { EntitlementService } from '@modules/entitlement/entitlement.service';
import { ClassPassRateLimitGuard, clientIp, type IpRequest } from './class-pass-rate-limit.guard';
import { ClassPassCaller, ClassPassService } from './class-pass.service';
import {
  AddStudentsDto,
  BadgeSignInDto,
  ClassCodeSignInDto,
  PersonalCodeSignInDto,
  IssueBadgesDto,
  SetClassPassDto,
} from './dto/class-pass.dto';

const TEACHERS = [Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN] as const;

@Controller('api/v1/class-pass')
export class ClassPassController {
  constructor(
    private readonly classPass: ClassPassService,
    private readonly entitlement: EntitlementService,
  ) {}

  // ── Teacher ──────────────────────────────────────────────────────────────
  @Get('classrooms/:id')
  @Roles(...TEACHERS)
  async status(@Param('id') id: string, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.status(id, user) };
  }

  @Post('classrooms/:id/state')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async setOn(@Param('id') id: string, @Body() dto: SetClassPassDto, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.setOn(id, user, dto.on) };
  }

  @Post('classrooms/:id/class-code')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async rotate(@Param('id') id: string, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.rotateClassCode(id, user) };
  }

  @Post('classrooms/:id/students')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async addStudents(@Param('id') id: string, @Body() dto: AddStudentsDto, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.addStudents(id, user, dto.names, dto.grade) };
  }

  @Post('classrooms/:id/badges')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async issue(@Param('id') id: string, @Body() dto: IssueBadgesDto, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.issue(id, user, dto.studentIds) };
  }

  @Post('classrooms/:id/students/:studentId/revoke')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async revoke(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.revoke(id, user, studentId) };
  }

  @Post('classrooms/:id/students/:studentId/unlock')
  @Roles(...TEACHERS)
  @HttpCode(200)
  async unlock(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.unlock(id, user, studentId) };
  }

  @Get('classrooms/:id/help')
  @Roles(...TEACHERS)
  async help(@Param('id') id: string, @Query('days') days: string | undefined, @CurrentUser() user: ClassPassCaller) {
    return { success: true, data: await this.classPass.helpActivity(id, user, Number(days) || 14) };
  }

  // ── Student (public: this IS the sign-in) ────────────────────────────────
  @Public()
  @UseGuards(ClassPassRateLimitGuard)
  @Post('sign-in/badge')
  @HttpCode(200)
  async badge(@Body() dto: BadgeSignInDto) {
    const data = await this.classPass.signInWithBadge(dto.badge);
    const entitled = await this.entitlement.isEntitled(data.user.id);
    return { success: true, data: { ...data, user: { ...data.user, entitled } } };
  }

  /** The personal code typed alone: opens that one student's work, nothing else. */
  @Public()
  @UseGuards(ClassPassRateLimitGuard)
  @Post('sign-in/personal')
  @HttpCode(200)
  async personal(@Body() dto: PersonalCodeSignInDto, @Req() req: IpRequest) {
    const data = await this.classPass.signInWithPersonalCode(dto.code, clientIp(req));
    const entitled = await this.entitlement.isEntitled(data.user.id);
    return { success: true, data: { ...data, user: { ...data.user, entitled } } };
  }

  /** Pages printed before 8 Nov: class code + 6-character code. No name list. */
  @Public()
  @UseGuards(ClassPassRateLimitGuard)
  @Post('sign-in/code')
  @HttpCode(200)
  async code(@Body() dto: ClassCodeSignInDto, @Req() req: IpRequest) {
    const data = await this.classPass.signInWithClassAndCode(dto.classCode, dto.code, clientIp(req));
    const entitled = await this.entitlement.isEntitled(data.user.id);
    return { success: true, data: { ...data, user: { ...data.user, entitled } } };
  }
}
