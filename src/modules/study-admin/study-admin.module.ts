import { Module } from '@nestjs/common';
import { StudyAdminController } from './study-admin.controller';
import { StudyAdminRepository } from './study-admin.repository';
import { StudyAdminService } from './study-admin.service';

// PrismaModule is global; no extra imports needed.
@Module({
  controllers: [StudyAdminController],
  providers: [StudyAdminService, StudyAdminRepository],
})
export class StudyAdminModule {}
