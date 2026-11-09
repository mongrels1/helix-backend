import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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

  /**
   * Build W: "Help me with this" on a worksheet question the student got
   * wrong. The server builds the lesson from its own stored copy of the
   * question and the student's answer; page text is not used for it.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  worksheetQuestion?: number;
}
