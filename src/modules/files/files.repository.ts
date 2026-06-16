import { Injectable } from '@nestjs/common';
import { FileRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<FileRecord | null> {
    return this.prisma.fileRecord.findUnique({ where: { id } });
  }

  async findByOwner(
    ownerId: string,
    page: number,
    limit: number,
  ): Promise<[FileRecord[], number]> {
    const where = { ownerId, deletedAt: null };
    const skip = (page - 1) * limit;
    const [files, total] = await this.prisma.$transaction([
      this.prisma.fileRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.fileRecord.count({ where }),
    ]);
    return [files, total];
  }

  async create(
    ownerId: string,
    filename: string,
    mimeType: string,
    sizeBytes: number,
    r2Key: string,
  ): Promise<FileRecord> {
    return this.prisma.fileRecord.create({
      data: { ownerId, filename, mimeType, sizeBytes, r2Key },
    });
  }

  async markUploaded(id: string): Promise<FileRecord> {
    return this.prisma.fileRecord.update({
      where: { id },
      data: { status: 'UPLOADED' },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.fileRecord.update({
      where: { id },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
  }
}
