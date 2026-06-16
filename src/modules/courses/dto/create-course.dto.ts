import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCourseDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  classroomId!: string;
}
