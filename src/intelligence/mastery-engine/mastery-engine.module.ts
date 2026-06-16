import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasteryEngineController } from './mastery-engine.controller';
import { MasteryEngineRepository } from './mastery-engine.repository';
import { MasteryEngineService } from './mastery-engine.service';

@Module({
  imports: [PrismaModule],
  providers: [MasteryEngineService, MasteryEngineRepository],
  controllers: [MasteryEngineController],
  exports: [MasteryEngineService],
})
export class MasteryEngineModule {}
