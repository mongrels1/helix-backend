import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { EventsService } from '../../events/events.service';
import { ClassroomsRepository } from '../classrooms/classrooms.repository';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let attendanceRepository: jest.Mocked<AttendanceRepository>;
  let classroomsRepository: jest.Mocked<ClassroomsRepository>;
  let eventsService: jest.Mocked<EventsService>;

  const record = {
    id: 'attendance-1',
    classroomId: 'classroom-1',
    studentId: 'student-1',
    date: new Date('2026-06-16T00:00:00.000Z'),
    status: AttendanceStatus.ABSENT,
    note: null,
    recordedById: 'teacher-1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    attendanceRepository = {
      bulkUpsert: jest.fn(),
      findByClassroomAndDate: jest.fn(),
      findByStudent: jest.fn(),
      findRecentByStudent: jest.fn(),
    } as unknown as jest.Mocked<AttendanceRepository>;
    classroomsRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ClassroomsRepository>;
    eventsService = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<EventsService>;
    service = new AttendanceService(
      attendanceRepository,
      classroomsRepository,
      eventsService,
    );
  });

  it('records attendance and checks absent students', async () => {
    classroomsRepository.findById.mockResolvedValue({ id: 'classroom-1' } as any);
    attendanceRepository.bulkUpsert.mockResolvedValue([record]);
    attendanceRepository.findRecentByStudent.mockResolvedValue([
      record,
      { ...record, id: 'attendance-2' },
      { ...record, id: 'attendance-3' },
    ]);

    await expect(
      service.recordAttendance(
        {
          classroomId: 'classroom-1',
          date: '2026-06-16',
          entries: [
            { studentId: 'student-1', status: AttendanceStatus.ABSENT },
            { studentId: 'student-2', status: AttendanceStatus.PRESENT },
          ],
        },
        'teacher-1',
      ),
    ).resolves.toEqual([record]);
    expect(eventsService.emit).toHaveBeenCalledWith(
      'attendance.risk.detected',
      {
        studentId: 'student-1',
        classroomId: 'classroom-1',
      },
    );
  });

  it('rejects missing classrooms', async () => {
    classroomsRepository.findById.mockResolvedValue(null);

    await expect(
      service.recordAttendance(
        {
          classroomId: 'missing',
          date: '2026-06-16',
          entries: [{ studentId: 'student-1', status: AttendanceStatus.PRESENT }],
        },
        'teacher-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not emit when the recent three include present', async () => {
    attendanceRepository.findRecentByStudent.mockResolvedValue([
      record,
      { ...record, id: 'attendance-2' },
      { ...record, id: 'attendance-3', status: AttendanceStatus.PRESENT },
    ]);

    await service.checkConsecutiveAbsences('classroom-1', 'student-1');

    expect(eventsService.emit).not.toHaveBeenCalled();
  });

  it('prevents students from reading another student attendance history', async () => {
    await expect(
      service.getByStudent('student-2', 1, 20, {
        userId: 'student-1',
        role: Role.STUDENT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
