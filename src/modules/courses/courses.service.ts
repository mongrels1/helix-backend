import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentBlock, Course, Section, Unit } from '@prisma/client';
import { ClassroomsRepository } from '@modules/classrooms/classrooms.repository';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateSectionDto } from './dto/create-section.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { CoursesRepository } from './courses.repository';

@Injectable()
export class CoursesService {
  constructor(
    private readonly coursesRepository: CoursesRepository,
    private readonly classroomsRepository: ClassroomsRepository,
  ) {}

  async findAll(classroomId: string, page = 1, limit = 20): Promise<{ data: Course[]; meta: { page: number; limit: number; total: number } }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [courses, total] = await this.coursesRepository.findAll(classroomId, normalizedPage, normalizedLimit);
    return { data: courses, meta: { page: normalizedPage, limit: normalizedLimit, total } };
  }

  async findById(id: string): Promise<Course> {
    const course = await this.coursesRepository.findById(id);
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  async createCourse(dto: CreateCourseDto): Promise<Course> {
    const classroom = await this.classroomsRepository.findById(dto.classroomId);
    if (!classroom) throw new NotFoundException('Classroom not found');
    return this.coursesRepository.createCourse(dto);
  }

  async updateCourse(id: string, data: Partial<CreateCourseDto>): Promise<Course> {
    await this.findById(id);
    return this.coursesRepository.updateCourse(id, data);
  }

  async softDeleteCourse(id: string): Promise<void> {
    await this.findById(id);
    await this.coursesRepository.softDeleteCourse(id);
  }

  async createUnit(courseId: string, dto: CreateUnitDto): Promise<Unit> {
    await this.findById(courseId);
    return this.coursesRepository.createUnit(courseId, dto);
  }

  async updateUnit(id: string, data: Partial<CreateUnitDto>): Promise<Unit> {
    await this.ensureUnit(id);
    return this.coursesRepository.updateUnit(id, data);
  }

  async softDeleteUnit(id: string): Promise<void> {
    await this.ensureUnit(id);
    await this.coursesRepository.softDeleteUnit(id);
  }

  async getUnits(courseId: string): Promise<Unit[]> {
    await this.findById(courseId);
    return this.coursesRepository.getUnits(courseId);
  }

  async createSection(unitId: string, dto: CreateSectionDto): Promise<Section> {
    await this.ensureUnit(unitId);
    return this.coursesRepository.createSection(unitId, dto);
  }

  async updateSection(id: string, data: Partial<CreateSectionDto>): Promise<Section> {
    await this.ensureSection(id);
    return this.coursesRepository.updateSection(id, data);
  }

  async softDeleteSection(id: string): Promise<void> {
    await this.ensureSection(id);
    await this.coursesRepository.softDeleteSection(id);
  }

  async getSections(unitId: string): Promise<Section[]> {
    await this.ensureUnit(unitId);
    return this.coursesRepository.getSections(unitId);
  }

  async createContentBlock(sectionId: string, dto: CreateContentBlockDto): Promise<ContentBlock> {
    await this.ensureSection(sectionId);
    return this.coursesRepository.createContentBlock(sectionId, dto);
  }

  async updateContentBlock(id: string, data: Partial<CreateContentBlockDto>): Promise<ContentBlock> {
    await this.ensureContentBlock(id);
    return this.coursesRepository.updateContentBlock(id, data);
  }

  async softDeleteContentBlock(id: string): Promise<void> {
    await this.ensureContentBlock(id);
    await this.coursesRepository.softDeleteContentBlock(id);
  }

  async getContentBlocks(sectionId: string): Promise<ContentBlock[]> {
    await this.ensureSection(sectionId);
    return this.coursesRepository.getContentBlocks(sectionId);
  }

  private async ensureUnit(id: string): Promise<Unit> {
    const unit = await this.coursesRepository.findUnitById(id);
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }

  private async ensureSection(id: string): Promise<Section> {
    const section = await this.coursesRepository.findSectionById(id);
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  private async ensureContentBlock(id: string): Promise<ContentBlock> {
    const block = await this.coursesRepository.findContentBlockById(id);
    if (!block) throw new NotFoundException('Content block not found');
    return block;
  }
}
