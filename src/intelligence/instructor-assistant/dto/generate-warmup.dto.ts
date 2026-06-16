import { IsOptional, IsString } from 'class-validator';

export class GenerateWarmUpDto {
  @IsString()
  classroomId!: string;

  @IsOptional()
  @IsString()
  lessonId?: string;
}
