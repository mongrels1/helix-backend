import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { KairosPointPublicController, PushMapController } from './push-map.controller';
import { KairosReviewService } from './kairos-review.service';
import { PushMapService } from './push-map.service';

/**
 * The Push Map builder.
 *
 * AIRouterService comes from the @Global() AIRouterModule and PrismaService from
 * the @Global() PrismaModule, so neither is imported here — the same shape as
 * LessonPlanModule, which this feature sits beside in the UI.
 *
 * EmailService is NOT global, so EmailModule is imported for the dispatch path.
 */
@Module({
  imports: [EmailModule],
  controllers: [PushMapController, KairosPointPublicController],
  providers: [PushMapService, KairosReviewService],
  exports: [PushMapService, KairosReviewService],
})
export class PushMapModule {}
