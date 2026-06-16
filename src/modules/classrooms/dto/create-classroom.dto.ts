import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateClassroomDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  organizationId!: string;
}
