import { Injectable } from '@nestjs/common';
import { AttendanceRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceEntryDto } from './dto/attendance-entry.dto';

@Injectable()
export class AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async bulkUpsert(
    classroomId: string,
    date: Date,
    entries: AttendanceEntryDto[],
    recordedById: string,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.$transaction(
      entries.map((entry) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            classroomId_studentId_date: {
              classroomId,
              studentId: entry.studentId,
              date,
            },
          },
          create: {
            classroomId,
            studentId: entry.studentId,
            date,
            status: entry.status,
            note: entry.note,
            recordedById,
          },
          update: {
            status: entry.status,
            note: entry.note,
            recordedById,
          },
        }),
      ),
    );
  }

  async findByClassroomAndDate(
    classroomId: string,
    date: Date,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { classroomId, date },
      orderBy: { studentId: 'asc' },
    });
  }

  async findByStudent(
    studentId: string,
    page: number,
    limit: number,
  ): Promise<[AttendanceRecord[], number]> {
    const skip = (page - 1) * limit;
    const where = { studentId };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return [records, total];
  }

  async findRecentByStudent(
    studentId: string,
    classroomId: string,
    limit: number,
  ): Promise<AttendanceRecord[]> {
    return this.prisma.attendanceRecord.findMany({
      where: { studentId, classroomId },
      take: limit,
      orderBy: { date: 'desc' },
    });
  }
}
