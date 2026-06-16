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
import { ContentBlock, Course, Role, Section, Unit } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateSectionDto } from './dto/create-section.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CoursesService } from './courses.service';

@Controller('api/v1')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post('courses')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async createCourse(
    @Body() dto: CreateCourseDto,
  ): Promise<{ success: true; data: Course }> {
    const course = await this.coursesService.createCourse(dto);
    return { success: true, data: course };
  }

  @Get('courses')
  async findAll(
    @Query('classroomId') classroomId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: Course[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.coursesService.findAll(classroomId, page, limit);
    return { success: true, ...result };
  }

  @Get('courses/:id')
  async findById(@Param('id') id: string): Promise<{ success: true; data: Course }> {
    const course = await this.coursesService.findById(id);
    return { success: true, data: course };
  }

  @Patch('courses/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async updateCourse(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCourseDto>,
  ): Promise<{ success: true; data: Course }> {
    const course = await this.coursesService.updateCourse(id, dto);
    return { success: true, data: course };
  }

  @Delete('courses/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async deleteCourse(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.coursesService.softDeleteCourse(id);
    return { success: true, data: null };
  }

  @Post('courses/:courseId/units')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async createUnit(
    @Param('courseId') courseId: string,
    @Body() dto: CreateUnitDto,
  ): Promise<{ success: true; data: Unit }> {
    const unit = await this.coursesService.createUnit(courseId, dto);
    return { success: true, data: unit };
  }

  @Get('courses/:courseId/units')
  async getUnits(
    @Param('courseId') courseId: string,
  ): Promise<{ success: true; data: Unit[] }> {
    const units = await this.coursesService.getUnits(courseId);
    return { success: true, data: units };
  }

  @Patch('units/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async updateUnit(
    @Param('id') id: string,
    @Body() dto: Partial<CreateUnitDto>,
  ): Promise<{ success: true; data: Unit }> {
    const unit = await this.coursesService.updateUnit(id, dto);
    return { success: true, data: unit };
  }

  @Delete('units/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async deleteUnit(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.coursesService.softDeleteUnit(id);
    return { success: true, data: null };
  }

  @Post('units/:unitId/sections')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async createSection(
    @Param('unitId') unitId: string,
    @Body() dto: CreateSectionDto,
  ): Promise<{ success: true; data: Section }> {
    const section = await this.coursesService.createSection(unitId, dto);
    return { success: true, data: section };
  }

  @Get('units/:unitId/sections')
  async getSections(
    @Param('unitId') unitId: string,
  ): Promise<{ success: true; data: Section[] }> {
    const sections = await this.coursesService.getSections(unitId);
    return { success: true, data: sections };
  }

  @Patch('sections/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async updateSection(
    @Param('id') id: string,
    @Body() dto: Partial<CreateSectionDto>,
  ): Promise<{ success: true; data: Section }> {
    const section = await this.coursesService.updateSection(id, dto);
    return { success: true, data: section };
  }

  @Delete('sections/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async deleteSection(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.coursesService.softDeleteSection(id);
    return { success: true, data: null };
  }

  @Post('sections/:sectionId/content')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async createContentBlock(
    @Param('sectionId') sectionId: string,
    @Body() dto: CreateContentBlockDto,
  ): Promise<{ success: true; data: ContentBlock }> {
    const block = await this.coursesService.createContentBlock(sectionId, dto);
    return { success: true, data: block };
  }

  @Get('sections/:sectionId/content')
  async getContentBlocks(
    @Param('sectionId') sectionId: string,
  ): Promise<{ success: true; data: ContentBlock[] }> {
    const blocks = await this.coursesService.getContentBlocks(sectionId);
    return { success: true, data: blocks };
  }

  @Patch('content/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async updateContentBlock(
    @Param('id') id: string,
    @Body() dto: Partial<CreateContentBlockDto>,
  ): Promise<{ success: true; data: ContentBlock }> {
    const block = await this.coursesService.updateContentBlock(id, dto);
    return { success: true, data: block };
  }

  @Delete('content/:id')
  @Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
  async deleteContentBlock(
    @Param('id') id: string,
  ): Promise<{ success: true; data: null }> {
    await this.coursesService.softDeleteContentBlock(id);
    return { success: true, data: null };
  }
}
