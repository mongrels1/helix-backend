import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ItemGenerationController } from './item-generation.controller';
import { ItemGenerationService } from './item-generation.service';
import { ValidationService } from './validation.service';

/**
 * Item generation (Question Bank -> Generate). AIRouterModule is @Global, so
 * AIRouterService injects without an explicit import (same as AITutorModule).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ItemGenerationController],
  providers: [ItemGenerationService, ValidationService],
  exports: [ItemGenerationService],
})
export class ItemGenerationModule {}
