import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { UpdateSubmissionDto } from './dto/update-submission.dto';
import { SubmissionEntity } from './entities/submission.entity';

@Injectable()
export class SubmissionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    filters: { assignmentId?: string; studentId?: string },
    page: number,
    limit: number,
  ): Promise<[SubmissionEntity[], number]> {
    const where = {
      ...(filters.assignmentId ? { assignmentId: filters.assignmentId } : {}),
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
    };
    const skip = (page - 1) * limit;
    const [submissions, total] = await this.prisma.$transaction([
      this.prisma.submission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.submission.count({ where }),
    ]);
    return [submissions as SubmissionEntity[], total];
  }

  async findById(id: string): Promise<SubmissionEntity | null> {
    return this.prisma.submission.findUnique({
      where: { id },
      include: { assignment: true },
    }) as Promise<SubmissionEntity | null>;
  }

  async findByAssignmentAndStudent(
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionEntity | null> {
    return this.prisma.submission.findUnique({
      where: { assignmentId_studentId: { assignmentId, studentId } },
    }) as Promise<SubmissionEntity | null>;
  }

  async create(
    assignmentId: string,
    studentId: string,
    dto: CreateSubmissionDto,
  ): Promise<SubmissionEntity> {
    return this.prisma.submission.create({
      data: {
        assignmentId,
        studentId,
        content: dto.content,
        fileUrl: dto.fileUrl,
      },
    }) as Promise<SubmissionEntity>;
  }

  async update(
    id: string,
    dto: UpdateSubmissionDto,
  ): Promise<SubmissionEntity> {
    return this.prisma.submission.update({
      where: { id },
      data: {
        content: dto.content,
        fileUrl: dto.fileUrl,
      },
    }) as Promise<SubmissionEntity>;
  }

  async submit(id: string): Promise<SubmissionEntity> {
    const submission = await this.findById(id);
    if (!submission) {
      throw new BadRequestException('Submission not found');
    }
    if (submission.status !== SubmissionStatus.DRAFT) {
      throw new BadRequestException('Only draft submissions can be submitted');
    }
    return this.prisma.submission.update({
      where: { id },
      data: {
        status: SubmissionStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    }) as Promise<SubmissionEntity>;
  }

  async updateStatus(
    id: string,
    status: SubmissionStatus,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SubmissionEntity> {
    return client.submission.update({
      where: { id },
      data: { status },
    }) as Promise<SubmissionEntity>;
  }
}
