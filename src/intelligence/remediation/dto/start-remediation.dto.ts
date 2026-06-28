import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Request a targeted mini-lesson + re-check for a single gap KC. */
export class StartRemediationDto {
  @IsString()
  kc!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  grade?: number;

  /**
   * "Try another lesson": skip the fixed calibrated item and serve a fresh,
   * on-topic AI variant so the student gets a different question each time.
   */
  @IsBoolean()
  @IsOptional()
  fresh?: boolean;
}
