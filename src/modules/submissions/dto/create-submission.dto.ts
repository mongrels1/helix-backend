import { IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';

export class CreateSubmissionDto {
  @IsUUID()
  assignmentId!: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsUrl()
  @IsOptional()
  fileUrl?: string;
}
