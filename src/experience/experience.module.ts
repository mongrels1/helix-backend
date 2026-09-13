import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminExperienceController } from './admin/admin-experience.controller';
import { AdminExperienceService } from './admin/admin-experience.service';
import { MeExperienceController } from './me/me.controller';
import { ParentExperienceController } from './parent/parent-experience.controller';
import { ParentExperienceService } from './parent/parent-experience.service';
import { StudentExperienceController } from './student/student-experience.controller';
import { StudentExperienceService } from './student/student-experience.service';
import { TeacherExperienceController } from './teacher/teacher-experience.controller';
import { TeacherExperienceService } from './teacher/teacher-experience.service';

@Module({
  imports: [PrismaModule],
  providers: [
    TeacherExperienceService,
    StudentExperienceService,
    ParentExperienceService,
    AdminExperienceService,
  ],
  controllers: [
    TeacherExperienceController,
    StudentExperienceController,
    ParentExperienceController,
    AdminExperienceController,
    // Reads AdminExperienceService, but is not admin-scoped — it answers only
    // about the caller's own account. See the note in me.controller.ts.
    MeExperienceController,
  ],
})
export class ExperienceModule {}
