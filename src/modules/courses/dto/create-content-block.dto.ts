import { ContentBlockType } from '@prisma/client';
import { IsEnum, IsInt, IsString, Min } from 'class-validator';

export class CreateContentBlockDto {
  @IsEnum(ContentBlockType)
  type!: ContentBlockType;

  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsInt()
  @Min(0)
  order!: number;
}
