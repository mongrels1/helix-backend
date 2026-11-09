import { Module } from '@nestjs/common';
import { WorksheetsController } from './worksheets.controller';
import { WorksheetsService } from './worksheets.service';

/** Build W. PrismaService and AIRouterService come from their @Global() modules. */
@Module({
  controllers: [WorksheetsController],
  providers: [WorksheetsService],
  exports: [WorksheetsService],
})
export class WorksheetsModule {}
