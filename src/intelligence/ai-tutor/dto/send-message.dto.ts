import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  /**
   * The problem the student is looking at when they press "Ask for help" (the
   * question text and its choices, from the page). Used as context for the
   * reply only; it is not stored as the student's message.
   */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  questionContext?: string;
}
