import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntitlementModule } from '@modules/entitlement/entitlement.module';
import { AITutorController } from './ai-tutor.controller';
import { AITutorRepository } from './ai-tutor.repository';
import { AITutorService } from './ai-tutor.service';

@Module({
  imports: [PrismaModule, EntitlementModule],
  providers: [AITutorService, AITutorRepository],
  controllers: [AITutorController],
  exports: [AITutorService],
})
export class AITutorModule {}
