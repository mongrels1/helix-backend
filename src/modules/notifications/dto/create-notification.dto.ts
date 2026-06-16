import { NotificationChannel } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateNotificationDto {
  @IsUUID()
  userId!: string;

  @IsString()
  title!: string;

  @IsString()
  body!: string;

  @IsEnum(NotificationChannel)
  @IsOptional()
  channel?: NotificationChannel;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
