import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AccelerationController } from './acceleration.controller';
import { AccelerationService } from './acceleration.service';

/**
 * Georgia standards.
 *
 * The registry itself (`ga-standards.ts`, the crosswalk, the alignment gate) is
 * pure functions with no NestJS wiring — import them directly from anywhere.
 * This module exists only for the parts that need the database: acceleration
 * evidence, which reads a student's practice history and resolves it through
 * the registry.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AccelerationController],
  providers: [AccelerationService],
  exports: [AccelerationService],
})
export class StandardsModule {}
