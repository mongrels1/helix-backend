import { IsString } from 'class-validator';

export class GenerateInsightDto {
  @IsString()
  assignmentId!: string;

  @IsString()
  classroomId!: string;
}
