import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateGradeDto {
  @IsUUID()
  submissionId!: string;

  @IsNumber()
  @Min(0)
  score!: number;

  @IsString()
  @IsOptional()
  feedback?: string;
}
