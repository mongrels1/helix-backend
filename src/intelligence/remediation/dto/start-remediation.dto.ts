import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Request a targeted mini-lesson + re-check for a single gap KC. */
export class StartRemediationDto {
  @IsString()
  kc!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  grade?: number;
}
