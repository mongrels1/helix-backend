import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { MAX_PAGES, MAX_QUESTIONS } from '../worksheet-logic';

/** Read an uploaded worksheet (+ optional key) and draft the check screen. */
export class DraftWorksheetDto {
  /** Worksheet pages as data:image/jpeg;base64 URLs (rendered in the browser). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGES)
  @IsString({ each: true })
  pageImages!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60000)
  worksheetText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  keyImages?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(30000)
  keyText?: string;

  /** Letters the teacher typed, e.g. "C D C D A D". */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  typedKey?: string;
}

export class WorksheetQuestionDto {
  @IsString()
  @MaxLength(600)
  stem!: string;

  @IsObject()
  options!: Record<string, string>;

  @IsOptional()
  @IsObject()
  feedback?: Record<string, string>;

  /** Draft only: where a graph is on the page ({page, x, y, w, h}); not stored. */
  @IsOptional()
  @IsObject()
  crop?: Record<string, number>;

  /** Facts from the problem box, shown above the question. */
  @IsOptional()
  @IsString()
  @MaxLength(800)
  context?: string;

  /** {headers: string[], rows: string[][]}; checked in the service. */
  @IsOptional()
  @IsObject()
  table?: Record<string, unknown>;

  /** The question's graph/diagram as a high-resolution data:image URL. */
  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  figureImage?: string;
}

/** Save the teacher-confirmed worksheet. The server re-checks everything. */
export class CreateWorksheetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  standard?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGES)
  @IsString({ each: true })
  pageImages!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_QUESTIONS)
  @ValidateNested({ each: true })
  @Type(() => WorksheetQuestionDto)
  questions!: WorksheetQuestionDto[];

  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  @IsString({ each: true })
  key!: string[];
}

export class AssignWorksheetDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  classroomIds!: string[];

  /** Optional: only these students (each must be in one of the chosen classes). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  studentIds?: string[];

  @IsDateString()
  dueAt!: string;

  /** Students do not see it before this time. Empty/null = right away. */
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;
}

/** A student's letters, one slot per question. Anything that is not A–D counts as blank (checked in the service). */
export class AnswersDto {
  @IsArray()
  @ArrayMaxSize(MAX_QUESTIONS)
  answers!: (string | null)[];
}

/** Change when a worksheet opens for students, in all its classes. null = right away. */
export class ScheduleWorksheetDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;
}
