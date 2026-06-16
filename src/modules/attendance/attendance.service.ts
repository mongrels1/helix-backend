import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceRecord, AttendanceStatus, Role } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { ClassroomsRepository } from '../classrooms/classrooms.repository';
import { AttendanceRepository } from './attendance.repository';
import { RecordAttendanceDto } from './dto/record-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly classroomsRepository: ClassroomsRepository,
    private readonly eventsService: EventsService,
  ) {}

  async recordAttendance(
    dto: RecordAttendanceDto,
    recordedById: string,
  ): Promise<AttendanceRecord[]> {
    const classroom = await this.classroomsRepository.findById(dto.classroomId);
    if (!classroom) throw new NotFoundException('Classroom not found');

    const date = this.toDateOnly(dto.date);
    const records = await this.attendanceRepository.bulkUpsert(
      dto.classroomId,
      date,
      dto.entries,
      recordedById,
    );

    for (const entry of dto.entries) {
      if (entry.status === AttendanceStatus.ABSENT) {
        await this.checkConsecutiveAbsences(dto.classroomId, entry.studentId);
      }
    }

    return records;
  }

  async checkConsecutiveAbsences(
    classroomId: string,
    studentId: string,
  ): Promise<void> {
    const recent = await this.attendanceRepository.findRecentByStudent(
      studentId,
      classroomId,
      3,
    );
    if (
      recent.length === 3 &&
      recent.every((record) => record.status === AttendanceStatus.ABSENT)
    ) {
      await this.eventsService.emit('attendance.risk.detected', {
        studentId,
        classroomId,
      });
    }
  }

  async getByClassroomAndDate(
    classroomId: string,
    date: string,
  ): Promise<AttendanceRecord[]> {
    return this.attendanceRepository.findByClassroomAndDate(
      classroomId,
      this.toDateOnly(date),
    );
  }

  async getByStudent(
    studentId: string,
    page = 1,
    limit = 20,
    requestingUser?: { userId: string; role: Role },
  ): Promise<{
    data: AttendanceRecord[];
    meta: { page: number; limit: number; total: number };
  }> {
    if (
      requestingUser?.role === Role.STUDENT &&
      requestingUser.userId !== studentId
    ) {
      throw new ForbiddenException('You can only view your own attendance');
    }
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [records, total] = await this.attendanceRepository.findByStudent(
      studentId,
      normalizedPage,
      normalizedLimit,
    );
    return {
      data: records,
      meta: { page: normalizedPage, limit: normalizedLimit, total },
    };
  }

  private toDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
