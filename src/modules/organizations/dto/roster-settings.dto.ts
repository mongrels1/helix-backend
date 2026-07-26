import { IsBoolean, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

// Super-admin roster controls for a school. All optional so a request can flip
// just one setting.
export class RosterSettingsDto {
  // The approval gate — teachers can only upload once this is true.
  @IsOptional()
  @IsBoolean()
  rosterEnabled?: boolean;

  // Whether EdKairos may email students a set-password link (else the teacher
  // hands out the printed sheet). Parent-facing email is never sent regardless.
  @IsOptional()
  @IsBoolean()
  studentEmailInvites?: boolean;

  // Contracted per-teacher student cap. null clears it and reverts the school to
  // the trial default (25/teacher, applied in the import service).
  @IsOptional()
  @ValidateIf((o: RosterSettingsDto) => o.perTeacherCap !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  perTeacherCap?: number | null;
}
