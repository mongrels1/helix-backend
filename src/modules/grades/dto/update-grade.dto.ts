import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateGradeDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  score?: number;

  @IsString()
  @IsOptional()
  feedback?: string;
}
