import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartSessionDto {
  @IsOptional()
  @IsString()
  assignmentId?: string;

  /** Optional skill/knowledge-component to focus the session on (e.g. from a diagnostic gap). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}
