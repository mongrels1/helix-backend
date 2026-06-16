import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';
import { MasteryEngineService } from '../../intelligence/mastery-engine/mastery-engine.service';
import { SubmissionsRepository } from '../submissions/submissions.repository';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';
import { GradeEntity } from './entities/grade.entity';
import { GradesRepository } from './grades.repository';

type RequestingUser = { userId: string; role: Role };
type SubmissionForGrading = Awaited<
  ReturnType<SubmissionsRepository['findById']>
> & {
  assignment?: {
    id: string;
    classroomId?: string;
    maxScore: number;
    skillTags?: string[];
  };
};

@Injectable()
export class GradesService {
  constructor(
    private readonly gradesRepository: GradesRepository,
    private readonly submissionsRepository: SubmissionsRepository,
    private readonly masteryEngineService: MasteryEngineService,
  ) {}

  async findBySubmission(
    submissionId: string,
    requestingUser?: RequestingUser,
  ): Promise<GradeEntity> {
    const grade = await this.gradesRepository.findBySubmission(submissionId);
    if (!grade) throw new NotFoundException('Grade not found');
    this.assertStudentCanView(grade, requestingUser);
    return grade;
  }

  async findById(
    id: string,
    requestingUser?: RequestingUser,
  ): Promise<GradeEntity> {
    const grade = await this.gradesRepository.findById(id);
    if (!grade) throw new NotFoundException('Grade not found');
    this.assertStudentCanView(grade, requestingUser);
    return grade;
  }

  async create(
    dto: CreateGradeDto,
    gradedById: string,
  ): Promise<GradeEntity> {
    const submission = (await this.submissionsRepository.findById(
      dto.submissionId,
    )) as SubmissionForGrading;
    if (!submission) throw new NotFoundException('Submission not found');
    const existingGrade = await this.gradesRepository.findBySubmission(
      dto.submissionId,
    );
    if (existingGrade) {
      throw new ConflictException('Grade already exists for this submission');
    }
    if (
      submission.status !== SubmissionStatus.SUBMITTED &&
      submission.status !== SubmissionStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Only submitted work can be graded');
    }
    const maxScore = submission.assignment?.maxScore;
    if (maxScore === undefined) {
      throw new NotFoundException('Submission assignment not found');
    }
    if (dto.score > maxScore) {
      throw new BadRequestException('Score cannot exceed max score');
    }

    const grade = await this.gradesRepository.create(
      dto.submissionId,
      dto.score,
      maxScore,
      dto.feedback,
      gradedById,
    );
    await this.updateMasteryForGrade(
      submission.studentId,
      submission,
      grade.score,
        grade.maxScore,
        dto.submissionId,
        submission.assignment?.classroomId,
      );
    return grade;
  }

  async update(
    id: string,
    dto: UpdateGradeDto,
    changedById: string,
  ): Promise<GradeEntity> {
    const existing = await this.gradesRepository.findById(id);
    if (!existing) throw new NotFoundException('Grade not found');
    const nextScore = dto.score ?? existing.score;
    if (nextScore > existing.maxScore) {
      throw new BadRequestException('Score cannot exceed max score');
    }
    const grade = await this.gradesRepository.update(id, dto, changedById);
    const submission = (await this.submissionsRepository.findById(
      grade.submissionId,
    )) as SubmissionForGrading;
    if (submission) {
      await this.updateMasteryForGrade(
        grade.submission.studentId,
        submission,
        grade.score,
        grade.maxScore,
        grade.submissionId,
        submission.assignment?.classroomId,
      );
    }
    return grade;
  }

  private async updateMasteryForGrade(
    studentId: string,
    submission: SubmissionForGrading,
    score: number,
    maxScore: number,
    submissionId: string,
    classroomId?: string,
  ): Promise<void> {
    const skillTags = submission.assignment?.skillTags ?? [];
    for (const skillTag of skillTags) {
      await this.masteryEngineService.updateMastery(
        studentId,
        skillTag,
        score,
        maxScore,
        submissionId,
        classroomId,
      );
    }
  }

  private assertStudentCanView(
    grade: { submission: { studentId: string } },
    requestingUser?: RequestingUser,
  ): void {
    if (
      requestingUser?.role === Role.STUDENT &&
      requestingUser.userId !== grade.submission.studentId
    ) {
      throw new ForbiddenException('You can only view your own grade');
    }
  }
}
