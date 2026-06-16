import { IsString } from 'class-validator';

export class GenerateFeedbackDto {
  @IsString()
  submissionId!: string;
}
