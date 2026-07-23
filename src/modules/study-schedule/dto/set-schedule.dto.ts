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

  /** SMS target for reminders. Normalized to E.164 server-side. */
  @IsString()
  @IsOptional()
  phone?: string;

  /** ISO-3166 alpha-2 country the phone belongs to (e.g. "US", "GB", "IN"), from
   *  the UI country picker — used to interpret a local number that has no `+`. */
  @IsString()
  @IsOptional()
  phoneCountry?: string;

  /** One entry per selected day. Inner shape validated in the service. */
  @IsArray()
  days!: ScheduleDayInput[];
}
