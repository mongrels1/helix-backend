import { IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import { GRADE_PATTERN } from '@common/grade/grade';

export class CreateClassroomDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  organizationId!: string;

  /** "K" or "1"–"12". */
  @IsOptional()
  @IsString()
  @Matches(GRADE_PATTERN, { message: 'Grade must be K or 1–12.' })
  gradeLevel?: string;
}
