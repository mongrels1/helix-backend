import { Role } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  // Honeypot: a hidden field a real user never sees or fills. Bots that auto-fill
  // every input trip it and are rejected. Declared here because the global
  // ValidationPipe uses forbidNonWhitelisted (undeclared fields are 400'd).
  @IsString()
  @IsOptional()
  website?: string;

  // Cloudflare Turnstile token from the widget; verified server-side. Optional so
  // the endpoint keeps working before the site key/secret are configured.
  @IsString()
  @IsOptional()
  captchaToken?: string;
}
