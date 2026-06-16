import { Injectable } from '@nestjs/common';
import { ContentBlock, Course, Section, Unit } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContentBlockDto } from './dto/create-content-block.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { CreateSectionDto } from './dto/create-section.dto';
import { CreateUnitDto } from './dto/create-unit.dto';

@Injectable()
export class CoursesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(classroomId: string, page: number, limit: number): Promise<[Course[], number]> {
    const where = { classroomId, deletedAt: null };
    const skip = (page - 1) * limit;
    return this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        include: { _count: { select: { units: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.course.count({ where }),
    ]);
  }

  async findById(id: string): Promise<Course | null> {
    return this.prisma.course.findFirst({
      where: { id, deletedAt: null },
      include: {
        units: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
          include: {
            sections: {
              where: { deletedAt: null },
              orderBy: { order: 'asc' },
              include: {
                contentBlocks: {
                  where: { deletedAt: null },
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        },
      },
    });
  }

  async createCourse(dto: CreateCourseDto): Promise<Course> {
    return this.prisma.course.create({ data: dto });
  }

  async updateCourse(id: string, data: Partial<CreateCourseDto>): Promise<Course> {
    await this.prisma.course.updateMany({ where: { id, deletedAt: null }, data });
    const course = await this.findById(id);
    if (!course) throw new Error('Course not found');
    return course;
  }

  async softDeleteCourse(id: string): Promise<void> {
    await this.prisma.course.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async createUnit(courseId: string, dto: CreateUnitDto): Promise<Unit> {
    return this.prisma.unit.create({ data: { ...dto, courseId } });
  }

  async updateUnit(id: string, data: Partial<CreateUnitDto>): Promise<Unit> {
    return this.prisma.unit.update({ where: { id }, data });
  }

  async softDeleteUnit(id: string): Promise<void> {
    await this.prisma.unit.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async getUnits(courseId: string): Promise<Unit[]> {
    return this.prisma.unit.findMany({
      where: { courseId, deletedAt: null, course: { deletedAt: null } },
      orderBy: { order: 'asc' },
    });
  }

  async findUnitById(id: string): Promise<Unit | null> {
    return this.prisma.unit.findFirst({ where: { id, deletedAt: null } });
  }

  async createSection(unitId: string, dto: CreateSectionDto): Promise<Section> {
    return this.prisma.section.create({ data: { ...dto, unitId } });
  }

  async updateSection(id: string, data: Partial<CreateSectionDto>): Promise<Section> {
    return this.prisma.section.update({ where: { id }, data });
  }

  async softDeleteSection(id: string): Promise<void> {
    await this.prisma.section.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async getSections(unitId: string): Promise<Section[]> {
    return this.prisma.section.findMany({
      where: { unitId, deletedAt: null, unit: { deletedAt: null } },
      orderBy: { order: 'asc' },
    });
  }

  async findSectionById(id: string): Promise<Section | null> {
    return this.prisma.section.findFirst({ where: { id, deletedAt: null } });
  }

  async createContentBlock(sectionId: string, dto: CreateContentBlockDto): Promise<ContentBlock> {
    return this.prisma.contentBlock.create({ data: { ...dto, sectionId } });
  }

  async updateContentBlock(id: string, data: Partial<CreateContentBlockDto>): Promise<ContentBlock> {
    return this.prisma.contentBlock.update({ where: { id }, data });
  }

  async softDeleteContentBlock(id: string): Promise<void> {
    await this.prisma.contentBlock.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async getContentBlocks(sectionId: string): Promise<ContentBlock[]> {
    return this.prisma.contentBlock.findMany({
      where: { sectionId, deletedAt: null, section: { deletedAt: null } },
      orderBy: { order: 'asc' },
    });
  }

  async findContentBlockById(id: string): Promise<ContentBlock | null> {
    return this.prisma.contentBlock.findFirst({ where: { id, deletedAt: null } });
  }
}
