import { Module } from '@nestjs/common';
import { InstructorAssistantModule } from '../intelligence/instructor-assistant/instructor-assistant.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DomainSynthesizerService } from './domain-synthesizer/domain-synthesizer.service';
import { IntentParserService } from './intent-parser/intent-parser.service';
import { OrchestrationController } from './orchestration.controller';
import { ResponseSynthesizerService } from './response-synthesizer/response-synthesizer.service';
import { WorkflowEngineService } from './workflow-engine/workflow-engine.service';

@Module({
  imports: [PrismaModule, NotificationsModule, InstructorAssistantModule],
  providers: [
    IntentParserService,
    DomainSynthesizerService,
    WorkflowEngineService,
    ResponseSynthesizerService,
  ],
  controllers: [OrchestrationController],
})
export class OrchestrationModule {}
