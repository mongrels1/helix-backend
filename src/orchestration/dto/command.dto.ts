import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CommandDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  command!: string;

  @IsOptional()
  @IsString()
  classroomId?: string;

  @IsOptional()
  @IsString()
  assignmentId?: string;
}
