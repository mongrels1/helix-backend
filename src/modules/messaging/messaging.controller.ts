import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Message, Thread } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { CreateThreadDto } from './dto/create-thread.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagingService } from './messaging.service';

type AuthenticatedUser = { userId: string };

@Controller('api/v1')
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post('threads')
  async createThread(
    @Body() dto: CreateThreadDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: Thread }> {
    const thread = await this.messagingService.createThread(
      dto,
      currentUser.userId,
    );
    return { success: true, data: thread };
  }

  @Get('threads')
  async getMyThreads(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: Thread[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.messagingService.getMyThreads(
      currentUser.userId,
      page,
      limit,
    );
    return { success: true, ...result };
  }

  @Get('threads/:id/messages')
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: Message[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.messagingService.getMessages(
      id,
      currentUser.userId,
      page,
      limit,
    );
    return { success: true, ...result };
  }

  @Post('threads/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: Message }> {
    const message = await this.messagingService.sendMessage(
      id,
      currentUser.userId,
      dto,
    );
    return { success: true, data: message };
  }
}
