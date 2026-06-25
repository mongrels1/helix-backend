import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RecheckResponseDto {
  /** Calibrated bank item id (bank source). Omitted for AI/formative items. */
  @IsString()
  @IsOptional()
  id?: string;

  /** The option index the student picked, in the order they were shown (0-3). */
  @IsInt()
  @Min(0)
  @Max(3)
  choice!: number;

  /**
   * The TEXT of the picked option. Used to grade bank items, whose options are
   * shuffled per serve, so the displayed index can't be matched to the stored key.
   */
  @IsString()
  @IsOptional()
  text?: string;

  /**
   * AI answer key for the item (formative source only). Ignored for the bank
   * source, which is graded server-side against the calibrated bank.
   */
  @IsInt()
  @Min(0)
  @Max(3)
  @IsOptional()
  answer?: number;
}

/** Submit a completed re-check so its result feeds back into the mastery engine. */
export class SubmitRecheckDto {
  @IsString()
  kc!: string;

  /** 'bank' = calibrated (server-graded, measurement-valid); 'ai' = formative. */
  @IsIn(['bank', 'ai'])
  source!: 'bank' | 'ai';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecheckResponseDto)
  @ArrayMaxSize(10)
  responses!: RecheckResponseDto[];

  /** Optional: lets the mastery drop event reach the teacher's pacing alerts. */
  @IsString()
  @IsOptional()
  classroomId?: string;
}
