import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  // Declared grade for the learner's profile. Optional so it can be omitted at
  // provisioning (GHL sends no grade) and set later via profile edit / the
  // diagnostic grade-consent flow. Lives on Profile, not User.
  @IsString()
  @IsOptional()
  grade?: string;
}
