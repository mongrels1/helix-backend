import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRubricCriteriaDto {
  @IsString()
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  maxScore!: number;

  @IsInt()
  @Min(0)
  order!: number;
}
