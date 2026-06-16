import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PacingEngineController } from './pacing-engine.controller';
import { PacingEngineRepository } from './pacing-engine.repository';
import { PacingEngineService } from './pacing-engine.service';

@Module({
  imports: [PrismaModule],
  providers: [PacingEngineService, PacingEngineRepository],
  controllers: [PacingEngineController],
  exports: [PacingEngineService],
})
export class PacingEngineModule {}
