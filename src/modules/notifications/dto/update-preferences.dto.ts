import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePreferencesDto {
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @IsBoolean()
  @IsOptional()
  push?: boolean;

  @IsBoolean()
  @IsOptional()
  inApp?: boolean;
}
