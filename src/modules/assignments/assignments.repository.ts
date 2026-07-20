import { Injectable } from '@nestjs/common';
import { Assignment, Prisma, Role, Rubric } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { CreateRubricDto } from './dto/create-rubric.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { AssignmentEntity } from './entities/assignment.entity';

const assignmentInclude = {
  rubric: { include: { criteria: { orderBy: { order: 'asc' as const } } } },
};

@Injectable()
export class AssignmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    classroomId: string | undefined,
    page: number,
    limit: number,
    requestingUser?: { userId: string; role: Role },
  ): Promise<[AssignmentEntity[], number]> {
    const where: Prisma.AssignmentWhereInput = { deletedAt: null };
    // Optional explicit classroom filter (e.g. a teacher viewing one class).
    if (classroomId) where.classroomId = classroomId;
    // Scope by caller so the list is never unbounded: a STUDENT sees only
    // assignments for classrooms they're enrolled in; a TEACHER only their own
    // classrooms'. Without this, an omitted classroomId returned EVERY
    // assignment in the system to every user (the cross-class leak). Admins
    // (ORG_ADMIN / SUPER_ADMIN) are intentionally unscoped.
    if (requestingUser?.role === Role.STUDENT) {
      where.classroom = { enrollments: { some: { studentId: requestingUser.userId } } };
    } else if (requestingUser?.role === Role.TEACHER) {
      where.classroom = { teacherId: requestingUser.userId };
    }
    const skip = (page - 1) * limit;
    const [assignments, total] = await this.prisma.$transaction([
      this.prisma.assignment.findMany({
        where,
        include: assignmentInclude,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.assignment.count({ where }),
    ]);
    return [assignments as AssignmentEntity[], total];
  }

  async findById(id: string): Promise<AssignmentEntity | null> {
    return this.prisma.assignment.findFirst({
      where: { id, deletedAt: null },
      include: assignmentInclude,
    }) as Promise<AssignmentEntity | null>;
  }

  async findOverdue(): Promise<Assignment[]> {
    return this.prisma.assignment.findMany({
      where: { dueAt: { lt: new Date() }, deletedAt: null },
    });
  }

  async create(dto: CreateAssignmentDto): Promise<AssignmentEntity> {
    return this.prisma.assignment.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        maxScore: dto.maxScore,
        skillTags: dto.skillTags,
        classroomId: dto.classroomId,
        courseId: dto.courseId,
      },
      include: assignmentInclude,
    }) as Promise<AssignmentEntity>;
  }

  async update(id: string, dto: UpdateAssignmentDto): Promise<AssignmentEntity> {
    await this.prisma.assignment.updateMany({
      where: { id, deletedAt: null },
      data: {
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        maxScore: dto.maxScore,
        skillTags: dto.skillTags,
        classroomId: dto.classroomId,
        courseId: dto.courseId,
      },
    });
    const assignment = await this.findById(id);
    if (!assignment) throw new Error('Assignment not found');
    return assignment;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.assignment.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async createRubric(assignmentId: string, dto: CreateRubricDto): Promise<Rubric> {
    return this.prisma.$transaction(async (tx) => {
      const rubric = await tx.rubric.create({
        data: {
          title: dto.title,
          criteria: { create: dto.criteria },
        },
        include: { criteria: { orderBy: { order: 'asc' } } },
      });
      await tx.assignment.update({
        where: { id: assignmentId },
        data: { rubricId: rubric.id },
      });
      return rubric;
    });
  }

  async updateRubric(rubricId: string, dto: CreateRubricDto): Promise<Rubric> {
    return this.prisma.$transaction(async (tx) => {
      await tx.rubricCriteria.deleteMany({ where: { rubricId } });
      return tx.rubric.update({
        where: { id: rubricId },
        data: {
          title: dto.title,
          criteria: { create: dto.criteria },
        },
        include: { criteria: { orderBy: { order: 'asc' } } },
      });
    });
  }

  async deleteRubric(rubricId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.assignment.updateMany({
        where: { rubricId },
        data: { rubricId: null },
      }),
      this.prisma.rubricCriteria.deleteMany({ where: { rubricId } }),
      this.prisma.rubric.delete({ where: { id: rubricId } }),
    ]);
  }
}
