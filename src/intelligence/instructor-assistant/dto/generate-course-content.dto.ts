import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateCourseContentDto {
  @IsString()
  topic!: string;

  @IsString()
  stage!: string;

  @IsString()
  @IsOptional()
  standard?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  unitNumber!: number;
}
