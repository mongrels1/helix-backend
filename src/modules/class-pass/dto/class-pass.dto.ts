import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetClassPassDto {
  @IsBoolean()
  on!: boolean;
}

export class AddStudentsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(130, { each: true })
  names!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4)
  grade?: string;
}

export class IssueBadgesDto {
  /** Empty or omitted = every student in the class who has no active badge. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  studentIds?: string[];
}

export class BadgeSignInDto {
  @IsString()
  @MaxLength(64)
  badge!: string;
}

export class PersonalCodeSignInDto {
  @IsString()
  @MaxLength(16)
  code!: string;
}

export class ClassCodeSignInDto {
  @IsString()
  @MaxLength(16)
  classCode!: string;

  @IsString()
  @MaxLength(16)
  code!: string;
}
