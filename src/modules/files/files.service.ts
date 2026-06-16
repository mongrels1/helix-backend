import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FileRecord, FileStatus, Role } from '@prisma/client';
import { RequestUploadDto } from './dto/request-upload.dto';
import { FileEntity } from './entities/file.entity';
import { FilesRepository } from './files.repository';
import { R2StorageService } from './r2-storage.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly r2StorageService: R2StorageService,
  ) {}

  async requestUpload(
    dto: RequestUploadDto,
    ownerId: string,
  ): Promise<{ file: FileEntity; uploadUrl: string }> {
    const r2Key = `${ownerId}/${Date.now()}-${this.sanitizeFilename(
      dto.filename,
    )}`;
    const file = await this.filesRepository.create(
      ownerId,
      dto.filename,
      dto.mimeType,
      dto.sizeBytes,
      r2Key,
    );
    const uploadUrl = await this.r2StorageService.getPresignedUploadUrl(
      r2Key,
      dto.mimeType,
    );
    return { file: this.toEntity(file, { uploadUrl }), uploadUrl };
  }

  async confirmUpload(
    fileId: string,
    requestingUserId: string,
  ): Promise<FileEntity> {
    const file = await this.getExistingFile(fileId);
    if (file.ownerId !== requestingUserId) {
      throw new ForbiddenException('You can only confirm your own files');
    }
    if (file.status !== FileStatus.PENDING) {
      throw new BadRequestException('Only pending files can be confirmed');
    }
    return this.toEntity(await this.filesRepository.markUploaded(fileId));
  }

  async getFile(
    fileId: string,
    requestingUser: { userId: string; role: Role },
  ): Promise<FileEntity> {
    const file = await this.getExistingFile(fileId);
    const canView =
      file.ownerId === requestingUser.userId ||
      requestingUser.role === Role.TEACHER ||
      requestingUser.role === Role.ORG_ADMIN ||
      requestingUser.role === Role.SUPER_ADMIN;
    if (!canView) {
      throw new ForbiddenException('You cannot access this file');
    }
    return this.toEntity(file, {
      downloadUrl: this.r2StorageService.getPublicUrl(file.r2Key),
    });
  }

  async deleteFile(fileId: string, requestingUserId: string): Promise<void> {
    const file = await this.getExistingFile(fileId);
    if (file.ownerId !== requestingUserId) {
      throw new ForbiddenException('You can only delete your own files');
    }
    await this.r2StorageService.deleteObject(file.r2Key);
    await this.filesRepository.softDelete(fileId);
  }

  private async getExistingFile(fileId: string): Promise<FileRecord> {
    const file = await this.filesRepository.findById(fileId);
    if (!file || file.deletedAt || file.status === FileStatus.DELETED) {
      throw new NotFoundException('File not found');
    }
    return file;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private toEntity(
    file: FileRecord,
    urls: { uploadUrl?: string; downloadUrl?: string } = {},
  ): FileEntity {
    return {
      id: file.id,
      ownerId: file.ownerId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      status: file.status,
      createdAt: file.createdAt,
      ...urls,
    };
  }
}
