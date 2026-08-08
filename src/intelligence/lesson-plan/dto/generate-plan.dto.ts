import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ArrayNotEmpty,
} from 'class-validator';

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
  @IsOptional() @IsString() coTeaching?: string;

  /** Free-text teacher notes: what to add, emphasize, or differentiate. */
  @IsOptional() @IsString() instructions?: string;
}
