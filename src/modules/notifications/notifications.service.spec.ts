import { ForbiddenException } from '@nestjs/common';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repository: jest.Mocked<NotificationsRepository>;

  const notification = {
    id: 'notification-1',
    userId: 'user-1',
    title: 'Alert',
    body: 'Body',
    channel: NotificationChannel.IN_APP,
    status: NotificationStatus.UNREAD,
    metadata: null,
    createdAt: new Date(),
    readAt: null,
    deletedAt: null,
  };

  beforeEach(() => {
    repository = {
      findByUser: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      markRead: jest.fn(),
      softDelete: jest.fn(),
      getUnreadCount: jest.fn(),
      getPreferences: jest.fn(),
      updatePreferences: jest.fn(),
    } as unknown as jest.Mocked<NotificationsRepository>;
    service = new NotificationsService(repository);
  });

  it('creates notifications and upserts preferences before delivery stubs', async () => {
    repository.getPreferences.mockResolvedValue({
      id: 'preferences-1',
      userId: 'user-1',
      email: true,
      push: false,
      inApp: true,
      updatedAt: new Date(),
    });
    repository.create.mockResolvedValue(notification);

    await expect(
      service.notify({
        userId: 'user-1',
        title: 'Alert',
        body: 'Body',
        channel: NotificationChannel.IN_APP,
      }),
    ).resolves.toEqual(notification);
    expect(repository.getPreferences).toHaveBeenCalledWith('user-1');
  });

  it('returns paginated notifications with unread count', async () => {
    repository.findByUser.mockResolvedValue([[notification], 1]);
    repository.getUnreadCount.mockResolvedValue(1);

    await expect(service.getMyNotifications('user-1')).resolves.toMatchObject({
      data: [notification],
      meta: { total: 1, unreadCount: 1 },
    });
  });

  it('blocks marking another user notification as read', async () => {
    repository.findById.mockResolvedValue(notification);

    await expect(
      service.markRead('notification-1', 'user-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('soft deletes owned notifications', async () => {
    repository.findById.mockResolvedValue(notification);
    repository.softDelete.mockResolvedValue(undefined);

    await service.remove('notification-1', 'user-1');

    expect(repository.softDelete).toHaveBeenCalledWith('notification-1');
  });
});
