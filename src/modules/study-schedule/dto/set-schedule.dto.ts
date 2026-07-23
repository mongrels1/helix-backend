import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** One selected study day + its local time. Shape is validated in the service
 *  (dayOfWeek 0–6, studyTime "HH:MM") so correctness doesn't depend on the
 *  ValidationPipe's nested-transform config. */
export interface ScheduleDayInput {
  dayOfWeek: number;
  studyTime: string;
}

/** Body for PUT /api/v1/study-schedule/me — replaces the caller's whole weekly
 *  plan. `days` must contain at least 3 entries (enforced in the service). */
export class SetScheduleDto {
  /** IANA timezone, e.g. "America/New_York". Validated against Intl in the service. */
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  /** SMS target for reminders (optional at this phase; sending comes later). */
  @IsString()
  @IsOptional()
  phone?: string;

  /** One entry per selected day. Inner shape validated in the service. */
  @IsArray()
  days!: ScheduleDayInput[];
}
