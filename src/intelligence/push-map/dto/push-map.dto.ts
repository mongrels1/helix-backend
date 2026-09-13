import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

/**
 * DTOs for the Push Map builder.
 *
 * These exist as classes rather than interfaces because the global
 * ValidationPipe runs with `whitelist` + `forbidNonWhitelisted`: a body typed
 * only as an interface carries no metadata, so every property would be stripped
 * and the request would arrive empty. Every field the confirm screen can send
 * has to be declared here.
 *
 * `@IsOptional()` is used rather than `@IsNotEmpty()` throughout on purpose —
 * the confirm screen is allowed to submit nulls. A field nobody could read stays
 * null and is flagged; it is never filled with a guess.
 */

export class ExtractDto {
  /** Text pulled from the PDF in the browser by `lib/pdfExtract.ts`. */
  @IsString()
  @MaxLength(200_000)
  reportText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class OverallDto {
  @IsOptional()
  @IsNumber()
  score?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @IsOptional()
  @IsNumber()
  standardError?: number | null;
}

export class DomainDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsNumber()
  score?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string | null;

  /** Georgia strand. Sent when a human picked it on the confirm screen. */
  @IsOptional()
  @IsIn(['NR', 'PAR', 'GSR', 'MDR', 'PR', 'FGR'])
  strand?: 'NR' | 'PAR' | 'GSR' | 'MDR' | 'PR' | 'FGR' | null;
}

export class GrowthTargetsDto {
  @IsOptional()
  @IsNumber()
  typical?: number | null;

  @IsOptional()
  @IsNumber()
  stretch?: number | null;
}

export class ConfirmedExtractionDto {
  @IsIn(['IREADY', 'MAP_GROWTH', 'STAR', 'GA_MILESTONES', 'UNKNOWN'])
  vendor!: 'IREADY' | 'MAP_GROWTH' | 'STAR' | 'GA_MILESTONES' | 'UNKNOWN';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  assessmentName?: string | null;

  /** ISO date the student sat the test. Load-bearing — see push-map.tracks.ts. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  takenOn?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  studentGrade?: number | null;

  @ValidateNested()
  @Type(() => OverallDto)
  overall!: OverallDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentile?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomainDto)
  domains!: DomainDto[];

  @ValidateNested()
  @Type(() => GrowthTargetsDto)
  growthTargets!: GrowthTargetsDto;

  @IsArray()
  @IsString({ each: true })
  unreadable!: string[];
}

export class GenerateDto {
  @IsString()
  @MaxLength(64)
  studentId!: string;
}
