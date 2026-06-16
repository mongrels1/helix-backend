import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequestUploadDto } from './dto/request-upload.dto';
import { FileEntity } from './entities/file.entity';
import { FilesService } from './files.service';

type AuthenticatedUser = { userId: string; role: Role };

@Controller('api/v1/files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  async requestUpload(
    @Body() dto: RequestUploadDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: { file: FileEntity; uploadUrl: string } }> {
    const data = await this.filesService.requestUpload(dto, currentUser.userId);
    return { success: true, data };
  }

  @Post(':id/confirm')
  async confirmUpload(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: FileEntity }> {
    const file = await this.filesService.confirmUpload(id, currentUser.userId);
    return { success: true, data: file };
  }

  @Get(':id')
  async getFile(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: FileEntity }> {
    const file = await this.filesService.getFile(id, currentUser);
    return { success: true, data: file };
  }

  @Delete(':id')
  async deleteFile(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: true; data: null }> {
    await this.filesService.deleteFile(id, currentUser.userId);
    return { success: true, data: null };
  }
}
