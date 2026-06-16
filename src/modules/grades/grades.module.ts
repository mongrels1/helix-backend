import { Module } from '@nestjs/common';
import { SubmissionsModule } from '@modules/submissions/submissions.module';
import { MasteryEngineModule } from '../../intelligence/mastery-engine/mastery-engine.module';
import { GradesController } from './grades.controller';
import { GradesRepository } from './grades.repository';
import { GradesService } from './grades.service';

@Module({
  imports: [SubmissionsModule, MasteryEngineModule],
  controllers: [GradesController],
  providers: [GradesService, GradesRepository],
  exports: [GradesService, GradesRepository],
})
export class GradesModule {}
