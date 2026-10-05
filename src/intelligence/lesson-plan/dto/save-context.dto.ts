import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

/**
 * The saved context sheet. Everything is optional: a teacher may save only the
 * standing instructions, or only the class details. `week` is deliberately
 * absent - it changes every time and is never worth remembering.
 */
export class SaveContextDto {
  @IsOptional() @IsString() @MaxLength(10) period?: string;
  @IsOptional() @IsString() @MaxLength(60) grade?: string;
  @IsOptional() @IsString() @MaxLength(200) unit?: string;
  @IsOptional() @IsString() @MaxLength(300) teacher?: string;
  @IsOptional() @IsString() @MaxLength(200) school?: string;
  @IsOptional() @IsString() @MaxLength(60) coTeaching?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true })
  groups?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(80, { each: true })
  strategies?: string[];

  /** The pacing guide and standing instructions. */
  @IsOptional() @IsString() @MaxLength(12000) instructions?: string;
}
