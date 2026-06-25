import { Global, Module } from '@nestjs/common';
import { AIRouterController } from './ai-router.controller';
import { AIRouterService } from './ai-router.service';
import { EmailModule } from '../../modules/email/email.module';

@Global()
@Module({
  imports: [EmailModule],
  providers: [AIRouterService],
  controllers: [AIRouterController],
  exports: [AIRouterService],
})
export class AIRouterModule {}
