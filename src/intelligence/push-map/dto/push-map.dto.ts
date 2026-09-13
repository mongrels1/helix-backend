import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
 * These are classes so the bodies are actually **validated**. The global
 * ValidationPipe skips any body whose emitted metatype is `Object` — which is
 * what an `interface` or an inline object type compiles to — and passes it
 * through untouched. So an interface-typed body is not stripped; it simply
 * arrives unchecked, which on this surface means a `vendor` we do not handle or
 * a `percentile` of 4000 reaching the composer. Declaring classes is what turns
 * the pipe on.
 *
 * `@IsOptional()` is used rather than `@IsNotEmpty()` throughout on purpose —
 * the confirm screen is allowed to submit nulls. A field nobody could read stays
 * null and is flagged; it is never filled with a guess.
 */

export class ExtractDto {
  /**
   * Text pulled from the PDF in the browser by `lib/pdfExtract.ts`.
   *
   * Optional because most score reports do not have any. Schools hand out
   * printed-then-scanned PDFs and screenshots, which carry no text layer at
   * all — see `pageImages`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  reportText?: string;

  /**
   * Rendered page images as `data:image/jpeg;base64,…` URLs, from
   * `renderPdfPages()`. The vision path, used when the PDF has no text layer.
   *
   * `main.ts` raises the JSON body limit to 30mb for exactly this.
   *
   * The cap is 30 pages, not the 8 it started at. What families upload is not a
   * tidy two-page report — it is a browser print of the whole dashboard, and the
   * first real one was 21 pages with the four domain scores on pages 2, 11, 15
   * and 19. An 8-page cap silently truncated three of them, and the reader
   * correctly reported what it had been given: unreadable. A page budget below
   * the length of a real document is a wrong answer generator.
   *
   * At the render settings the client uses, 30 pages is roughly 7MB of base64 —
   * comfortably inside the body limit.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(6_000_000, { each: true })
  pageImages?: string[];

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

/** Rejecting a report requires a reason — see `KairosReviewService.reject`. */
export class RejectDto {
  @IsString()
  @MaxLength(1000)
  note!: string;
}
