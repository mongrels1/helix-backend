import { IsNotEmpty, IsString } from 'class-validator';

/** Body for POST /api/v1/auth/verify-email — the token from the emailed link. */
export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
