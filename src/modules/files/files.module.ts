import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { R2StorageService } from './r2-storage.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, FilesRepository, R2StorageService],
  exports: [FilesService, FilesRepository],
})
export class FilesModule {}
