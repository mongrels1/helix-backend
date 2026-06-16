import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileStatus, Role } from '@prisma/client';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { R2StorageService } from './r2-storage.service';

describe('FilesService', () => {
  let service: FilesService;
  let filesRepository: jest.Mocked<FilesRepository>;
  let r2StorageService: jest.Mocked<R2StorageService>;

  const file = {
    id: 'file-1',
    ownerId: 'owner-1',
    filename: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    r2Key: 'owner-1/123-report.pdf',
    status: FileStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    filesRepository = {
      findById: jest.fn(),
      findByOwner: jest.fn(),
      create: jest.fn(),
      markUploaded: jest.fn(),
      softDelete: jest.fn(),
    } as unknown as jest.Mocked<FilesRepository>;
    r2StorageService = {
      getPresignedUploadUrl: jest.fn(),
      deleteObject: jest.fn(),
      getPublicUrl: jest.fn(),
    } as unknown as jest.Mocked<R2StorageService>;
    service = new FilesService(filesRepository, r2StorageService);
  });

  it('creates pending metadata and returns an upload URL', async () => {
    filesRepository.create.mockResolvedValue(file);
    r2StorageService.getPresignedUploadUrl.mockResolvedValue(
      'https://mock-r2.example.com/upload/key?mock=true',
    );

    await expect(
      service.requestUpload(
        {
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
        },
        'owner-1',
      ),
    ).resolves.toMatchObject({
      file: { status: FileStatus.PENDING },
      uploadUrl: 'https://mock-r2.example.com/upload/key?mock=true',
    });
  });

  it('confirms pending uploads', async () => {
    filesRepository.findById.mockResolvedValue(file);
    filesRepository.markUploaded.mockResolvedValue({
      ...file,
      status: FileStatus.UPLOADED,
    });

    await expect(service.confirmUpload('file-1', 'owner-1')).resolves.toMatchObject({
      status: FileStatus.UPLOADED,
    });
  });

  it('rejects confirming already uploaded files', async () => {
    filesRepository.findById.mockResolvedValue({
      ...file,
      status: FileStatus.UPLOADED,
    });

    await expect(service.confirmUpload('file-1', 'owner-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('allows teachers and admins to read files with download URLs', async () => {
    filesRepository.findById.mockResolvedValue(file);
    r2StorageService.getPublicUrl.mockReturnValue(
      'https://mock-r2.example.com/owner-1/123-report.pdf',
    );

    await expect(
      service.getFile('file-1', { userId: 'teacher-1', role: Role.TEACHER }),
    ).resolves.toMatchObject({
      downloadUrl: 'https://mock-r2.example.com/owner-1/123-report.pdf',
    });
  });

  it('blocks non-owner deletes', async () => {
    filesRepository.findById.mockResolvedValue(file);

    await expect(service.deleteFile('file-1', 'other-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('treats deleted records as missing', async () => {
    filesRepository.findById.mockResolvedValue({
      ...file,
      status: FileStatus.DELETED,
      deletedAt: new Date(),
    });

    await expect(
      service.getFile('file-1', { userId: 'owner-1', role: Role.STUDENT }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
