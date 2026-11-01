import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DAY_STATUSES, DayStatus } from '../lesson-plan.days';

/** The teacher's choice for one template day (Track LP1). */
export class DayPlanEntryDto {
  /** The template's day name; matched by name, then by position. */
  @IsOptional() @IsString() @MaxLength(60)
  name?: string;

  @IsIn(DAY_STATUSES as unknown as string[])
  status!: DayStatus;

  /** e.g. "Election Day", "Unit 3 quiz". */
  @IsOptional() @IsString() @MaxLength(120)
  reason?: string;
}

/** For the day-suggestion lookup: which days, and the week's first date. */
export class DaySuggestionsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  days!: string[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be yyyy-mm-dd' })
  weekStart!: string;
}

export class GeneratePlanDto {
  /** "How long is the period?" — required; drives time-weighting. */
  @IsInt()
  @Min(5)
  periodMinutes!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  days!: string[];

  @IsInt()
  @Min(1)
  segmentsPerDay!: number;

  /** Subset of ['ESOL','Gifted','SWD'] the teacher has in this class. */
  @IsArray()
  @IsString({ each: true })
  differentiationGroups!: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  strategies?: string[];

  @IsOptional() @IsString() grade?: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() week?: string;
  @IsOptional() @IsString() teacher?: string;
  @IsOptional() @IsString() school?: string;
  @IsOptional() @IsString() coTeaching?: string;

  /** Free-text teacher notes: what to add, emphasize, or differentiate. */
  @IsOptional() @IsString() instructions?: string;

  /**
   * Per-day status (teach / ild / no_school / test / centers / half_day).
   * Optional: without it every day is a teaching day, as before.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayPlanEntryDto)
  dayPlan?: DayPlanEntryDto[];

  /** First day of the week, yyyy-mm-dd. Gives each day its date and fills the header. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be yyyy-mm-dd' })
  weekStart?: string;
}
