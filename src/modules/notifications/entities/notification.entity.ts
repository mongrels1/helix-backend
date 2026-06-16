import { NotificationChannel, NotificationStatus } from '@prisma/client';

export class NotificationEntity {
  id!: string;
  userId!: string;
  title!: string;
  body!: string;
  channel!: NotificationChannel;
  status!: NotificationStatus;
  metadata!: Record<string, unknown> | null;
  createdAt!: Date;
  readAt!: Date | null;
  deletedAt!: Date | null;
}
