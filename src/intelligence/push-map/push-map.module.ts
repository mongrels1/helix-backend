import { Module } from '@nestjs/common';
import { PushMapController } from './push-map.controller';
import { PushMapService } from './push-map.service';

/**
 * The Push Map builder.
 *
 * AIRouterService comes from the @Global() AIRouterModule and PrismaService from
 * the @Global() PrismaModule, so neither is imported here — the same shape as
 * LessonPlanModule, which this feature sits beside in the UI.
 */
@Module({
  controllers: [PushMapController],
  providers: [PushMapService],
  exports: [PushMapService],
})
export class PushMapModule {}
