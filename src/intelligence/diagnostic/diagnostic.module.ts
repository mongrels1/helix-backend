import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MasteryEngineModule } from '../mastery-engine/mastery-engine.module';
import { DiagnosticController } from './diagnostic.controller';
import { DiagnosticService } from './diagnostic.service';

@Module({
  imports: [PrismaModule, MasteryEngineModule],
  providers: [DiagnosticService],
  controllers: [DiagnosticController],
  exports: [DiagnosticService],
})
export class DiagnosticModule {}
