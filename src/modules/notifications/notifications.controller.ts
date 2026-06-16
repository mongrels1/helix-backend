import {
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Body,
} from '@nestjs/common';
import { Notification, NotificationPreference } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsService } from './notifications.service';

type AuthenticatedUser = { userId: string };

@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getMyNotifications(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: Notification[];
    meta: { page: number; limit: number; total: number; unreadCount: number };
  }> {
    const result = await this.notificationsService.getMyNotifications(
      currentUser.userId,
      page,
      limit,
    );
    return { success: true, ...result };
  }

  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: Notification }> {
    const notification = await this.notificationsService.markRead(
      id,
      currentUser.userId,
    );
    return { success: true, data: notification };
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: null }> {
    await this.notificationsService.remove(id, currentUser.userId);
    return { success: true, data: null };
  }

  @Get('preferences')
  async getMyPreferences(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: NotificationPreference }> {
    const preferences = await this.notificationsService.getMyPreferences(
      currentUser.userId,
    );
    return { success: true, data: preferences };
  }

  @Patch('preferences')
  async updateMyPreferences(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ success: true; data: NotificationPreference }> {
    const preferences = await this.notificationsService.updateMyPreferences(
      currentUser.userId,
      dto,
    );
    return { success: true, data: preferences };
  }
}
