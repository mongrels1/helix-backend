import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizePhone } from '@common/phone';
import { SetScheduleDto, ScheduleDayInput } from './dto/set-schedule.dto';
import { StudyScheduleRepository } from './study-schedule.repository';

const MIN_DAYS = 3;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h "HH:MM"

export interface StudyScheduleView {
  timezone: string | null;
  phone: string | null;
  minDays: number;
  days: Array<{ dayOfWeek: number; studyTime: string }>;
}

@Injectable()
export class StudyScheduleService {
  constructor(private readonly repo: StudyScheduleRepository) {}

  async getMine(studentId: string): Promise<StudyScheduleView> {
    const [rows, contact] = await Promise.all([
      this.repo.findByStudent(studentId),
      this.repo.getContact(studentId),
    ]);
    return {
      timezone: contact.timezone,
      phone: contact.phone,
      minDays: MIN_DAYS,
      days: rows.map((r) => ({ dayOfWeek: r.dayOfWeek, studyTime: r.studyTime })),
    };
  }

  async setMine(studentId: string, dto: SetScheduleDto): Promise<StudyScheduleView> {
    const timezone = (dto.timezone ?? '').trim();
    if (!this.isValidTimeZone(timezone)) {
      throw new BadRequestException('Please choose a valid timezone.');
    }

    const days = this.normalizeDays(dto.days);
    if (days.length < MIN_DAYS) {
      throw new BadRequestException(
        `Please choose at least ${MIN_DAYS} study days (with a time for each).`,
      );
    }

    // Force phone to E.164 so reminders can actually be routed — users won't type
    // the country code. Undefined = leave unchanged; empty = clear; anything else
    // must normalize to a real number or we reject it with a helpful message.
    let phone = dto.phone;
    if (phone !== undefined && phone.trim() !== '') {
      const normalized = normalizePhone(phone, dto.phoneCountry);
      if (!normalized) {
        throw new BadRequestException(
          'That mobile number doesn\'t look valid for the selected country. Please check it, or include your country code (e.g. +44…).',
        );
      }
      phone = normalized;
    }

    await this.repo.replaceSchedule(studentId, timezone, phone, days);
    return this.getMine(studentId);
  }

  /**
   * Validate + de-duplicate the incoming days. Each must be an integer weekday
   * 0–6 with a valid "HH:MM" time; the last entry for a repeated day wins. Throws
   * on any malformed entry rather than silently dropping it, so the student gets a
   * clear error instead of a quietly-wrong schedule.
   */
  private normalizeDays(input: unknown): ScheduleDayInput[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException('Schedule days are missing or malformed.');
    }
    if (input.length > 7) {
      throw new BadRequestException('A weekly plan can have at most 7 days.');
    }
    const byDay = new Map<number, string>();
    for (const raw of input) {
      const day = (raw as ScheduleDayInput)?.dayOfWeek;
      const time = (raw as ScheduleDayInput)?.studyTime;
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new BadRequestException('Each study day must be a weekday (Sun–Sat).');
      }
      if (typeof time !== 'string' || !TIME_RE.test(time)) {
        throw new BadRequestException('Each study day needs a valid time (HH:MM).');
      }
      byDay.set(day, time);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayOfWeek, studyTime]) => ({ dayOfWeek, studyTime }));
  }

  /** True if `tz` is an IANA zone the runtime accepts (e.g. "America/New_York"). */
  private isValidTimeZone(tz: string): boolean {
    if (!tz) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
}
