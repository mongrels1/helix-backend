import {
  IsDateString,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  dueAt?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxScore?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  skillTags?: string[];

  @IsUUID()
  classroomId!: string;

  @IsUUID()
  @IsOptional()
  courseId?: string;
}
