import { Role } from '@prisma/client';
import { IsEnum, IsString } from 'class-validator';

export class AddMemberDto {
  @IsString()
  userId!: string;

  @IsEnum(Role)
  role!: Role;
}
