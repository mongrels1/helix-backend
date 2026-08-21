import {
  IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';

/**
 * One submit enrolls both people: the parent (who owns the account and the
 * consent) and the child (who does the maths). The paper opt-in form collects
 * exactly these fields, and the online form must not diverge from it — a family
 * enrolling by QR has to give the same consent as one returning paper.
 */
export class EnrollDto {
  // --- student -------------------------------------------------------------
  @IsString() @IsNotEmpty() @MaxLength(60)  studentFirstName!: string;
  @IsString() @IsNotEmpty() @MaxLength(60)  studentLastName!: string;
  @IsOptional() @IsString() @MaxLength(20)  gradeLevel?: string;
  @IsOptional() @IsString() @MaxLength(20)  classPeriod?: string;
  @IsOptional() @IsString() @MaxLength(40)  studentIdExternal?: string;

  // --- parent --------------------------------------------------------------
  @IsString() @IsNotEmpty() @MaxLength(120) parentName!: string;
  @IsEmail()                                parentEmail!: string;
  // Optional by design. The parent letter promises a mobile number is not
  // required from a family that does not want text messages.
  @IsOptional() @IsString() @MaxLength(32)  parentPhone?: string;
  @IsString() @IsNotEmpty() @MaxLength(40)  relationship!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;

  // --- notifications (both default off; neither may gate enrollment) -------
  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifySms?: boolean;

  // --- consent -------------------------------------------------------------
  @IsBoolean() consentAccess!: boolean;
  @IsBoolean() consentProviderAndAi!: boolean;
  @IsBoolean() consentDataUse!: boolean;
  @IsBoolean() consentHoldHarmless!: boolean;
  @IsString() @IsNotEmpty() @MaxLength(40)    consentVersion!: string;
  /** The exact wording rendered to the parent, stored verbatim. */
  @IsString() @IsNotEmpty() @MaxLength(20000) consentText!: string;

  // --- anti-abuse ----------------------------------------------------------
  @IsOptional() @IsString() captchaToken?: string;
  /** Honeypot — hidden from humans; a filled value is a bot. */
  @IsOptional() @IsString() website?: string;
}
