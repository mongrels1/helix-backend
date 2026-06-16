import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Enrollment, Role } from '@prisma/client';
import { OrganizationsRepository } from '@modules/organizations/organizations.repository';
import { UsersRepository } from '@modules/users/users.repository';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { EnrollStudentDto } from './dto/enroll-student.dto';
import { ClassroomEntity } from './entities/classroom.entity';
import { ClassroomsRepository } from './classrooms.repository';

export type RequestingUser = {
  userId: string;
  email: string;
  role: Role;
  orgId?: string;
};

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly classroomsRepository: ClassroomsRepository,
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async findAll(
    page = 1,
    limit = 20,
    requestingUser?: RequestingUser,
  ): Promise<{
    data: ClassroomEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    let result: [ClassroomEntity[], number];

    if (requestingUser?.role === Role.TEACHER) {
      result = await this.classroomsRepository.findByTeacher(
        requestingUser.userId,
        normalizedPage,
        normalizedLimit,
      );
    } else if (requestingUser?.role === Role.STUDENT) {
      result = await this.classroomsRepository.findByStudent(
        requestingUser.userId,
        normalizedPage,
        normalizedLimit,
      );
    } else {
      result = await this.classroomsRepository.findAll(
        normalizedPage,
        normalizedLimit,
      );
    }

    const [classrooms, total] = result;
    return {
      data: classrooms,
      meta: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
      },
    };
  }

  async findById(id: string): Promise<ClassroomEntity> {
    const classroom = await this.classroomsRepository.findById(id);
    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    return classroom;
  }

  async create(
    dto: CreateClassroomDto,
    teacherId: string,
  ): Promise<ClassroomEntity> {
    const organization = await this.organizationsRepository.findById(
      dto.organizationId,
    );
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.classroomsRepository.create(dto, teacherId);
  }

  async update(
    id: string,
    dto: Partial<CreateClassroomDto>,
    requestingUser: RequestingUser,
  ): Promise<ClassroomEntity> {
    const classroom = await this.findById(id);
    const isOwner = classroom.teacherId === requestingUser.userId;
    const isAdmin =
      requestingUser.role === Role.ORG_ADMIN ||
      requestingUser.role === Role.SUPER_ADMIN;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Insufficient classroom permissions');
    }

    if (dto.organizationId) {
      const organization = await this.organizationsRepository.findById(
        dto.organizationId,
      );
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }
    }

    return this.classroomsRepository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.classroomsRepository.softDelete(id);
  }

  async enroll(
    classroomId: string,
    dto: EnrollStudentDto,
  ): Promise<Enrollment> {
    await this.findById(classroomId);

    const student = await this.usersRepository.findById(dto.studentId);
    if (!student || student.role !== Role.STUDENT) {
      throw new NotFoundException('Student not found');
    }

    const alreadyEnrolled = await this.classroomsRepository.isEnrolled(
      classroomId,
      dto.studentId,
    );
    if (alreadyEnrolled) {
      throw new ConflictException('Student is already enrolled');
    }

    return this.classroomsRepository.enroll(classroomId, dto.studentId);
  }

  async unenroll(classroomId: string, studentId: string): Promise<void> {
    await this.findById(classroomId);
    await this.classroomsRepository.unenroll(classroomId, studentId);
  }

  async getEnrollments(classroomId: string): Promise<Enrollment[]> {
    await this.findById(classroomId);
    return this.classroomsRepository.getEnrollments(classroomId);
  }
}
