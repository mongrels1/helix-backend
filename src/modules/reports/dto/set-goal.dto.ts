import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SetGoalDto {
  /** Weekly practice goal in minutes; null/omitted = back to the default (180). */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1200)
  minutes?: number | null;
}
