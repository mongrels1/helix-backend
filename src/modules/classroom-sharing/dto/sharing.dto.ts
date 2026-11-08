import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsString, MaxLength } from 'class-validator';

export const SHARE_ROLES = ['CO_TEACHER', 'VIEWER'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export class InviteTeacherDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsIn(SHARE_ROLES as unknown as string[])
  role!: ShareRole;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  classroomIds!: string[];
}

export class SetShareRoleDto {
  @IsIn(SHARE_ROLES as unknown as string[])
  role!: ShareRole;
}

export class AcceptInviteDto {
  @IsString()
  @MaxLength(100)
  token!: string;
}
