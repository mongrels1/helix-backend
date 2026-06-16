import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Rubric } from '@prisma/client';
import { ClassroomsRepository } from '@modules/classrooms/classrooms.repository';
import { CoursesRepository } from '@modules/courses/courses.repository';
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
    classroomId: string,
    page = 1,
    limit = 20,
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

  async create(dto: CreateAssignmentDto): Promise<AssignmentEntity> {
    const classroom = await this.classroomsRepository.findById(dto.classroomId);
    if (!classroom) throw new NotFoundException('Classroom not found');
    if (dto.courseId) {
      const course = await this.coursesRepository.findById(dto.courseId);
      if (!course) throw new NotFoundException('Course not found');
    }
    return this.assignmentsRepository.create(dto);
  }

  async update(id: string, dto: UpdateAssignmentDto): Promise<AssignmentEntity> {
    await this.findById(id);
    if (dto.classroomId) {
      const classroom = await this.classroomsRepository.findById(dto.classroomId);
      if (!classroom) throw new NotFoundException('Classroom not found');
    }
    if (dto.courseId) {
      const course = await this.coursesRepository.findById(dto.courseId);
      if (!course) throw new NotFoundException('Course not found');
    }
    return this.assignmentsRepository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.assignmentsRepository.softDelete(id);
  }

  async createRubric(
    assignmentId: string,
    dto: CreateRubricDto,
  ): Promise<Rubric> {
    const assignment = await this.findById(assignmentId);
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
