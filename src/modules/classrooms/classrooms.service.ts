import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Enrollment, Role } from '@prisma/client';
import { normalizeGrade } from '@common/grade/grade';
import { levelAllows, type ClassroomNeed } from '@common/classroom-access/classroom-access';
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

  /**
   * Load a class and require `need` (view / teach / manage) for this caller.
   * Students may also view a class they are enrolled in.
   */
  async findForCaller(
    id: string,
    caller: Pick<RequestingUser, 'userId' | 'role'>,
    need: ClassroomNeed,
  ): Promise<ClassroomEntity> {
    const classroom = await this.findById(id);
    if (need === 'view' && caller.role === Role.STUDENT && (await this.classroomsRepository.isEnrolled(id, caller.userId))) {
      return classroom;
    }
    const level = await this.classroomsRepository.accessLevel(classroom, caller);
    if (!levelAllows(level, need)) {
      throw new ForbiddenException(
        level === 'viewer'
          ? 'You have view-only access to this class.'
          : level === 'co_teacher'
            ? 'Only the class owner can do that.'
            : 'You do not have access to this classroom',
      );
    }
    return { ...classroom, access: level === 'admin' ? 'owner' : level ?? undefined } as ClassroomEntity;
  }

  async create(
    dto: CreateClassroomDto,
    teacherId: string,
    requestingUser?: Pick<RequestingUser, 'userId' | 'role'>,
  ): Promise<ClassroomEntity> {
    const organization = await this.organizationsRepository.findById(
      dto.organizationId,
    );
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    if (requestingUser) await this.assertCanUseSchool(dto.organizationId, requestingUser);

    return this.classroomsRepository.create(dto, teacherId);
  }

  /**
   * A classroom may only be filed under one of the caller's own schools (see
   * OrganizationsRepository.schoolsFor). Stops a class landing in the wrong
   * school — or in EdKairos's house organization — from the picker or the API.
   */
  private async assertCanUseSchool(
    organizationId: string,
    user: Pick<RequestingUser, 'userId' | 'role'>,
  ): Promise<void> {
    if (user.role === Role.SUPER_ADMIN) return;
    const schools = await this.organizationsRepository.schoolsFor(user.userId, user.role);
    if (!schools.some((s) => s.id === organizationId)) {
      throw new ForbiddenException('You can only create classes for your own school.');
    }
  }

  async update(
    id: string,
    dto: Partial<CreateClassroomDto>,
    requestingUser: RequestingUser,
  ): Promise<ClassroomEntity> {
    // Moving a class to another school is the owner's call; name, grade and
    // description can be changed by a co-teacher too.
    const moving = !!dto.organizationId && dto.organizationId !== (await this.findById(id)).organizationId;
    const classroom = await this.findForCaller(id, requestingUser, moving ? 'manage' : 'teach');

    if (dto.organizationId && dto.organizationId !== classroom.organizationId) {
      const organization = await this.organizationsRepository.findById(
        dto.organizationId,
      );
      if (!organization) {
        throw new NotFoundException('Organization not found');
      }
      await this.assertCanUseSchool(dto.organizationId, requestingUser);
    }

    if (dto.gradeLevel !== undefined) {
      const g = normalizeGrade(dto.gradeLevel);
      if (!g) throw new BadRequestException('Grade must be K or 1–12.');
      dto = { ...dto, gradeLevel: g };
    }
    const updated = await this.classroomsRepository.update(id, dto);
    // A class grade fills in every student in the class who has none.
    if (dto.gradeLevel && dto.gradeLevel !== classroom.gradeLevel) {
      await this.classroomsRepository.fillMissingGrades(id, dto.gradeLevel);
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.classroomsRepository.softDelete(id);
  }

  async enroll(
    classroomId: string,
    dto: EnrollStudentDto,
    caller: Pick<RequestingUser, 'userId' | 'role'>,
  ): Promise<Enrollment> {
    const classroom = await this.findForCaller(classroomId, caller, 'teach');

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

    const enrollment = await this.classroomsRepository.enroll(classroomId, dto.studentId);
    if (classroom.gradeLevel) await this.classroomsRepository.fillMissingGrades(classroomId, classroom.gradeLevel);
    return enrollment;
  }

  async unenroll(classroomId: string, studentId: string, caller: Pick<RequestingUser, 'userId' | 'role'>): Promise<void> {
    await this.findForCaller(classroomId, caller, 'teach');
    await this.classroomsRepository.unenroll(classroomId, studentId);
  }

  async getEnrollments(
    classroomId: string,
    requestingUser?: Pick<RequestingUser, 'userId' | 'role'>,
  ): Promise<Enrollment[]> {
    // A roster carries students' full names and emails: never to students,
    // parents, or a teacher this class isn't shared with.
    if (requestingUser) {
      if (requestingUser.role === Role.STUDENT || requestingUser.role === Role.PARENT) {
        throw new ForbiddenException('You do not have access to this class roster');
      }
      await this.findForCaller(classroomId, requestingUser, 'view');
    } else {
      await this.findById(classroomId);
    }
    return this.classroomsRepository.getEnrollments(classroomId);
  }
}
