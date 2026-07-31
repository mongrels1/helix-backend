import { Module } from '@nestjs/common';
import { LessonPlanController } from './lesson-plan.controller';
import { LessonPlanService } from './lesson-plan.service';
import { LessonPlanSidecarService } from './lesson-plan.sidecar';

/**
 * AIRouterService is provided by the @Global() AIRouterModule, so it does not
 * need to be imported here. ConfigModule is global as well.
 */
@Module({
  controllers: [LessonPlanController],
  providers: [LessonPlanService, LessonPlanSidecarService],
  exports: [LessonPlanService],
})
export class LessonPlanModule {}
