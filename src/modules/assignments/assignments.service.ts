import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, Rubric } from '@prisma/client';
import { ClassroomsRepository } from '@modules/classrooms/classrooms.repository';
import { CoursesRepository } from '@modules/courses/courses.repository';
import { levelAllows } from '@common/classroom-access/classroom-access';

type Caller = { userId: string; role: Role | string };
import { AssignmentsRepository } from './assignments.repository';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { CreateRubricDto } from './dto/create-rubric.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { AssignmentEntity } from './entities/assignment.entity';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly assignmentsRepository: AssignmentsRepository,
    private readonly classroomsRepository: ClassroomsRepository,
    private readonly coursesRepository: CoursesRepository,
  ) {}

  async findAll(
    classroomId: string | undefined,
    page = 1,
    limit = 20,
    requestingUser?: { userId: string; role: Role },
  ): Promise<{
    data: AssignmentEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [assignments, total] = await this.assignmentsRepository.findAll(
      classroomId,
      normalizedPage,
      normalizedLimit,
      requestingUser,
    );
    return {
      data: assignments,
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  async findById(id: string): Promise<AssignmentEntity> {
    const assignment = await this.assignmentsRepository.findById(id);
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }

  /** Assigning and editing work: the class owner, a co-teacher or a school admin. */
  private async assertCanTeach(classroomId: string, caller?: Caller): Promise<void> {
    const classroom = await this.classroomsRepository.findById(classroomId);
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (!caller) return;
    const level = await this.classroomsRepository.accessLevel(classroom, caller);
    if (!levelAllows(level, 'teach')) {
      throw new ForbiddenException(level === 'viewer' ? 'You have view-only access to this class.' : 'You do not have access to this classroom');
    }
  }

  async create(dto: CreateAssignmentDto, caller?: Caller): Promise<AssignmentEntity> {
    await this.assertCanTeach(dto.classroomId, caller);
    if (dto.courseId) {
      const course = await this.coursesRepository.findById(dto.courseId);
      if (!course) throw new NotFoundException('Course not found');
    }
    return this.assignmentsRepository.create(dto);
  }

  async update(id: string, dto: UpdateAssignmentDto, caller?: Caller): Promise<AssignmentEntity> {
    const existing = await this.findById(id);
    await this.assertCanTeach(existing.classroomId, caller);
    if (dto.classroomId && dto.classroomId !== existing.classroomId) {
      await this.assertCanTeach(dto.classroomId, caller);
    }
    if (dto.courseId) {
      const course = await this.coursesRepository.findById(dto.courseId);
      if (!course) throw new NotFoundException('Course not found');
    }
    return this.assignmentsRepository.update(id, dto);
  }

  async remove(id: string, caller?: Caller): Promise<void> {
    const existing = await this.findById(id);
    await this.assertCanTeach(existing.classroomId, caller);
    await this.assignmentsRepository.softDelete(id);
  }

  async createRubric(
    assignmentId: string,
    dto: CreateRubricDto,
    caller?: Caller,
  ): Promise<Rubric> {
    const assignment = await this.findById(assignmentId);
    await this.assertCanTeach(assignment.classroomId, caller);
    if (assignment.rubric) {
      throw new ConflictException('Assignment already has a rubric');
    }
    return this.assignmentsRepository.createRubric(assignmentId, dto);
  }

  async updateRubric(rubricId: string, dto: CreateRubricDto): Promise<Rubric> {
    return this.assignmentsRepository.updateRubric(rubricId, dto);
  }

  async deleteRubric(rubricId: string): Promise<void> {
    await this.assignmentsRepository.deleteRubric(rubricId);
  }
}
