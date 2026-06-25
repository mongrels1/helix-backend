import { Module } from '@nestjs/common';
import { InstructorAssistantModule } from '../instructor-assistant/instructor-assistant.module';
import { MasteryEngineModule } from '../mastery-engine/mastery-engine.module';
import { RemediationController } from './remediation.controller';
import { RemediationService } from './remediation.service';

/**
 * Teach -> re-check loop. Reuses InstructorAssistantService (mini-lesson) and
 * MasteryEngineService (feedback rail). Exported so an autonomous post-diagnostic
 * trigger can call RemediationService directly, not just via the HTTP endpoint.
 */
@Module({
  imports: [InstructorAssistantModule, MasteryEngineModule],
  providers: [RemediationService],
  controllers: [RemediationController],
  exports: [RemediationService],
})
export class RemediationModule {}
