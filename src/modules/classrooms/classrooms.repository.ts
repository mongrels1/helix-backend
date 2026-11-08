import { Injectable } from '@nestjs/common';
import { fillMissingGrades } from '@common/grade/grade';
import { ClassroomStaffRole, Enrollment } from '@prisma/client';
import {
  accessibleClassroomWhere,
  classroomAccessLevel,
  type AccessCaller,
  type ClassroomAccessLevel,
} from '@common/classroom-access/classroom-access';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { ClassroomEntity } from './entities/classroom.entity';

const classroomSelect = {
  id: true,
  name: true,
  description: true,
  organizationId: true,
  teacherId: true,
  gradeLevel: true,
  createdAt: true,
  _count: {
    select: {
      enrollments: true,
    },
  },
};

type ClassroomRecord = {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  teacherId: string;
  gradeLevel?: string | null;
  createdAt: Date;
  _count?: {
    enrollments: number;
  };
};

@Injectable()
export class ClassroomsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(page: number, limit: number): Promise<[ClassroomEntity[], number]> {
    return this.findByWhere({ deletedAt: null }, page, limit);
  }

  async findById(id: string): Promise<ClassroomEntity | null> {
    const classroom = await this.prisma.classroom.findFirst({
      where: { id, deletedAt: null },
      select: classroomSelect,
    });

    return classroom ? this.toEntity(classroom) : null;
  }

  /** The teacher's own classes plus classes shared with them, each marked with their access. */
  async findByTeacher(
    teacherId: string,
    page: number,
    limit: number,
  ): Promise<[ClassroomEntity[], number]> {
    const where = { deletedAt: null, ...accessibleClassroomWhere(teacherId) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.classroom.findMany({
        where,
        select: {
          ...classroomSelect,
          staff: { where: { userId: teacherId }, select: { role: true } },
          teacher: { select: { profile: { select: { firstName: true, lastName: true } } } },
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.classroom.count({ where }),
    ]);
    return [
      rows.map((r) => {
        const own = r.teacherId === teacherId;
        const p = r.teacher?.profile;
        return {
          ...this.toEntity(r),
          access: own ? 'owner' : r.staff[0]?.role === ClassroomStaffRole.CO_TEACHER ? 'co_teacher' : 'viewer',
          ownerName: own ? null : p ? `${p.firstName} ${p.lastName}`.trim() : null,
        } as ClassroomEntity;
      }),
      total,
    ];
  }

  /** The caller's access to a class (owner, school admin, co-teacher, viewer) or null. */
  accessLevel(
    classroom: { id: string; teacherId: string; organizationId: string },
    caller: AccessCaller,
  ): Promise<ClassroomAccessLevel | null> {
    return classroomAccessLevel(this.prisma, classroom, caller);
  }

  async findByStudent(
    studentId: string,
    page: number,
    limit: number,
  ): Promise<[ClassroomEntity[], number]> {
    return this.findByWhere(
      { deletedAt: null, enrollments: { some: { studentId } } },
      page,
      limit,
    );
  }

  async create(
    dto: CreateClassroomDto,
    teacherId: string,
  ): Promise<ClassroomEntity> {
    const classroom = await this.prisma.classroom.create({
      data: {
        name: dto.name,
        description: dto.description,
        organizationId: dto.organizationId,
        teacherId,
        gradeLevel: dto.gradeLevel ?? null,
      },
      select: classroomSelect,
    });

    return this.toEntity(classroom);
  }

  async update(
    id: string,
    data: Partial<CreateClassroomDto>,
  ): Promise<ClassroomEntity> {
    await this.prisma.classroom.updateMany({
      where: { id, deletedAt: null },
      data,
    });

    const classroom = await this.findById(id);
    if (!classroom) {
      throw new Error('Classroom not found');
    }

    return classroom;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.classroom.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async enroll(classroomId: string, studentId: string): Promise<Enrollment> {
    return this.prisma.enrollment.create({
      data: { classroomId, studentId },
    });
  }

  async unenroll(classroomId: string, studentId: string): Promise<void> {
    await this.prisma.enrollment.deleteMany({
      where: { classroomId, studentId },
    });
  }

  async getEnrollments(classroomId: string): Promise<Enrollment[]> {
    // Include the student + profile so the roster can show real names/emails.
    // Without this the roster received bare enrollment rows and every student
    // rendered as a nameless "Student" with "No email".
    return this.prisma.enrollment.findMany({
      where: { classroomId, classroom: { deletedAt: null } },
      orderBy: { enrolledAt: 'desc' },
      include: {
        student: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  async isEnrolled(classroomId: string, studentId: string): Promise<boolean> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { classroomId, studentId, classroom: { deletedAt: null } },
    });

    return enrollment !== null;
  }

  private async findByWhere(
    where: object,
    page: number,
    limit: number,
  ): Promise<[ClassroomEntity[], number]> {
    const skip = (page - 1) * limit;
    const [classrooms, total] = await this.prisma.$transaction([
      this.prisma.classroom.findMany({
        where,
        select: classroomSelect,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.classroom.count({ where }),
    ]);

    return [classrooms.map(this.toEntity), total];
  }

  /** Students in this class with no grade get the class grade (never overwrites one). */
  async fillMissingGrades(classroomId: string, grade: string): Promise<number> {
    return fillMissingGrades(this.prisma, classroomId, grade);
  }

  private toEntity(classroom: ClassroomRecord): ClassroomEntity {
    return {
      id: classroom.id,
      name: classroom.name,
      description: classroom.description,
      organizationId: classroom.organizationId,
      teacherId: classroom.teacherId,
      gradeLevel: classroom.gradeLevel ?? null,
      enrollmentCount: classroom._count?.enrollments ?? 0,
      createdAt: classroom.createdAt,
    };
  }
}
