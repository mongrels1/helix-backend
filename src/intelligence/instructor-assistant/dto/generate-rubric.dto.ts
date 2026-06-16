import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GenerateRubricDto {
  @IsString()
  assignmentTitle!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(1)
  maxScore!: number;
}
