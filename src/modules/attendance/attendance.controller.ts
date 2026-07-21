import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AttendanceRecord, PresenceDay, Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { AttendanceService } from './attendance.service';
import { EngagementRow } from './attendance.repository';
import { RecordAttendanceDto } from './dto/record-attendance.dto';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async recordAttendance(
    @Body() dto: RecordAttendanceDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: AttendanceRecord[] }> {
    const records = await this.attendanceService.recordAttendance(
      dto,
      currentUser.userId,
    );
    return { success: true, data: records };
  }

  @Get()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getByClassroomAndDate(
    @Query('classroomId') classroomId: string,
    @Query('date') date: string,
  ): Promise<{ success: true; data: AttendanceRecord[] }> {
    const records = await this.attendanceService.getByClassroomAndDate(
      classroomId,
      date,
    );
    return { success: true, data: records };
  }

  // Student heartbeat while on a learning page — tallies active time for today.
  @Post('heartbeat')
  @Roles(Role.STUDENT)
  async heartbeat(
    @Body() body: { date?: string },
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: PresenceDay }> {
    const record = await this.attendanceService.recordHeartbeat(
      currentUser.userId,
      body?.date,
    );
    return { success: true, data: record };
  }

  // Teacher view: per-student engagement (active seconds + arrival) for a day.
  @Get('engagement')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async getEngagement(
    @Query('classroomId') classroomId: string,
    @Query('date') date: string,
  ): Promise<{ success: true; data: EngagementRow[] }> {
    const data = await this.attendanceService.getEngagement(classroomId, date);
    return { success: true, data };
  }

  @Get('student/:userId')
  async getByStudent(
    @Param('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{
    success: true;
    data: AttendanceRecord[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.attendanceService.getByStudent(
      userId,
      page,
      limit,
      currentUser,
    );
    return { success: true, ...result };
  }
}
