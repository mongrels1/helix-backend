import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Notification, NotificationChannel, NotificationPreference } from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  async notify(dto: CreateNotificationDto): Promise<Notification> {
    const channel = dto.channel ?? NotificationChannel.IN_APP;
    const preferences = await this.notificationsRepository.getPreferences(
      dto.userId,
    );
    const notification = await this.notificationsRepository.create({
      ...dto,
      channel,
    });

    if (channel === NotificationChannel.EMAIL && preferences.email) {
      this.logger.log(`EMAIL stub: ${dto.title}`);
    }
    if (channel === NotificationChannel.PUSH && preferences.push) {
      this.logger.log(`PUSH stub: ${dto.title}`);
    }

    return notification;
  }

  async getMyNotifications(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    data: Notification[];
    meta: { page: number; limit: number; total: number; unreadCount: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [notifications, total] =
      await this.notificationsRepository.findByUser(
        userId,
        normalizedPage,
        normalizedLimit,
      );
    const unreadCount = await this.notificationsRepository.getUnreadCount(userId);
    return {
      data: notifications,
      meta: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        unreadCount,
      },
    };
  }

  async markRead(id: string, requestingUserId: string): Promise<Notification> {
    const notification = await this.getOwnedNotification(id, requestingUserId);
    if (notification.status === 'READ') return notification;
    return this.notificationsRepository.markRead(id);
  }

  async remove(id: string, requestingUserId: string): Promise<void> {
    await this.getOwnedNotification(id, requestingUserId);
    await this.notificationsRepository.softDelete(id);
  }

  async getMyPreferences(userId: string): Promise<NotificationPreference> {
    return this.notificationsRepository.getPreferences(userId);
  }

  async updateMyPreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<NotificationPreference> {
    return this.notificationsRepository.updatePreferences(userId, dto);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationsRepository.getUnreadCount(userId);
  }

  private async getOwnedNotification(
    id: string,
    requestingUserId: string,
  ): Promise<Notification> {
    const notification = await this.notificationsRepository.findById(id);
    if (!notification || notification.deletedAt) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.userId !== requestingUserId) {
      throw new ForbiddenException('You can only access your own notifications');
    }
    return notification;
  }
}
