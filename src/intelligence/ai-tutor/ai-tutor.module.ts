import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AITutorController } from './ai-tutor.controller';
import { AITutorRepository } from './ai-tutor.repository';
import { AITutorService } from './ai-tutor.service';

@Module({
  imports: [PrismaModule],
  providers: [AITutorService, AITutorRepository],
  controllers: [AITutorController],
  exports: [AITutorService],
})
export class AITutorModule {}
