import { Module } from '@nestjs/common';
import { AIRouterModule } from '../ai-router/ai-router.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [AIRouterModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
