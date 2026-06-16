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
import { Enrollment, Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { ClassroomEntity } from './entities/classroom.entity';
import { ClassroomsService, RequestingUser } from './classrooms.service';

@Controller('api/v1/classrooms')
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Post()
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async create(
    @Body() createClassroomDto: CreateClassroomDto,
    @CurrentUser() currentUser: RequestingUser,
  ): Promise<{ success: true; data: ClassroomEntity }> {
    const classroom = await this.classroomsService.create(
      createClassroomDto,
      currentUser.userId,
    );
    return { success: true, data: classroom };
  }

  @Get()
  async findAll(
    @CurrentUser() currentUser: RequestingUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: ClassroomEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.classroomsService.findAll(
      page,
      limit,
      currentUser,
    );
    return { success: true, ...result };
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
  ): Promise<{ success: true; data: ClassroomEntity }> {
    const classroom = await this.classroomsService.findById(id);
    return { success: true, data: classroom };
  }

  @Patch(':id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async update(
    @Param('id') id: string,
    @Body() updateClassroomDto: Partial<CreateClassroomDto>,
    @CurrentUser() currentUser: RequestingUser,
  ): Promise<{ success: true; data: ClassroomEntity }> {
    const classroom = await this.classroomsService.update(
      id,
      updateClassroomDto,
      currentUser,
    );
    return { success: true, data: classroom };
  }

  @Delete(':id')
  @Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async remove(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.classroomsService.remove(id);
    return { success: true, data: null };
  }

  @Post(':id/enroll')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async enroll(
    @Param('id') id: string,
    @Body() enrollStudentDto: EnrollStudentDto,
  ): Promise<{ success: true; data: Enrollment }> {
    const enrollment = await this.classroomsService.enroll(
      id,
      enrollStudentDto,
    );
    return { success: true, data: enrollment };
  }

  @Delete(':id/enroll/:studentId')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async unenroll(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ): Promise<{ success: true; data: null }> {
    await this.classroomsService.unenroll(id, studentId);
    return { success: true, data: null };
  }

  @Get(':id/enrollments')
  async getEnrollments(
    @Param('id') id: string,
  ): Promise<{ success: true; data: Enrollment[] }> {
    const enrollments = await this.classroomsService.getEnrollments(id);
    return { success: true, data: enrollments };
  }
}
