import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateSubmissionDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsUrl()
  @IsOptional()
  fileUrl?: string;
}
