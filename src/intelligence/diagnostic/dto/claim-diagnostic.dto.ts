import { IsString } from 'class-validator';

export class ClaimDiagnosticDto {
  @IsString() claimToken!: string;
}
