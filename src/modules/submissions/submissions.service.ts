import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { AssignmentsRepository } from '../assignments/assignments.repository';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { UpdateSubmissionDto } from './dto/update-submission.dto';
import { SubmissionEntity } from './entities/submission.entity';
import { SubmissionsRepository } from './submissions.repository';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly submissionsRepository: SubmissionsRepository,
    private readonly assignmentsRepository: AssignmentsRepository,
    private readonly eventsService: EventsService,
  ) {}

  async findAll(
    filters: { assignmentId?: string; studentId?: string },
    page = 1,
    limit = 20,
    requestingUser?: { userId: string; role: Role },
  ): Promise<{
    data: SubmissionEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const effectiveFilters =
      requestingUser?.role === Role.STUDENT
        ? { ...filters, studentId: requestingUser.userId }
        : filters;
    const [submissions, total] = await this.submissionsRepository.findAll(
      effectiveFilters,
      normalizedPage,
      normalizedLimit,
    );
    return {
      data: submissions,
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  async findById(
    id: string,
    requestingUser?: { userId: string; role: Role },
  ): Promise<SubmissionEntity> {
    const submission = await this.submissionsRepository.findById(id);
    if (!submission) throw new NotFoundException('Submission not found');
    if (
      requestingUser?.role === Role.STUDENT &&
      requestingUser.userId !== submission.studentId
    ) {
      throw new ForbiddenException('You can only view your own submissions');
    }
    return submission;
  }

  async create(
    dto: CreateSubmissionDto,
    studentId: string,
    role: Role = Role.STUDENT,
  ): Promise<SubmissionEntity> {
    if (role !== Role.STUDENT) {
      throw new ForbiddenException('Only students can create submissions');
    }
    const assignment = await this.assignmentsRepository.findById(dto.assignmentId);
    if (!assignment) throw new NotFoundException('Assignment not found');

    const existing = await this.submissionsRepository.findByAssignmentAndStudent(
      dto.assignmentId,
      studentId,
    );
    if (existing) {
      throw new ConflictException(
        'Student already has a submission for this assignment',
      );
    }
    return this.submissionsRepository.create(dto.assignmentId, studentId, dto);
  }

  async update(
    id: string,
    dto: UpdateSubmissionDto,
    requestingUserId: string,
  ): Promise<SubmissionEntity> {
    const submission = await this.findById(id);
    if (requestingUserId !== submission.studentId) {
      throw new ForbiddenException('You can only edit your own submissions');
    }
    if (submission.status !== 'DRAFT') {
      throw new BadRequestException('Submitted work cannot be edited');
    }
    return this.submissionsRepository.update(id, dto);
  }

  async submit(id: string, requestingUserId: string): Promise<SubmissionEntity> {
    const submission = await this.findById(id);
    if (requestingUserId !== submission.studentId) {
      throw new ForbiddenException('You can only submit your own submissions');
    }
    const submitted = await this.submissionsRepository.submit(id);
    await this.eventsService.emit('submission.created', {
      submissionId: submitted.id,
      assignmentId: submitted.assignmentId,
      studentId: submitted.studentId,
    });
    return submitted;
  }

  async getByAssignmentAndStudent(
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionEntity | null> {
    return this.submissionsRepository.findByAssignmentAndStudent(
      assignmentId,
      studentId,
    );
  }
}
