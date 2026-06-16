import { Global, Module } from '@nestjs/common';
import { AIRouterController } from './ai-router.controller';
import { AIRouterService } from './ai-router.service';

@Global()
@Module({
  providers: [AIRouterService],
  controllers: [AIRouterController],
  exports: [AIRouterService],
})
export class AIRouterModule {}
