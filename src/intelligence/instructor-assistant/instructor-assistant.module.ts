import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InstructorAssistantController } from './instructor-assistant.controller';
import { InstructorAssistantRepository } from './instructor-assistant.repository';
import { InstructorAssistantService } from './instructor-assistant.service';

@Module({
  imports: [PrismaModule],
  providers: [InstructorAssistantService, InstructorAssistantRepository],
  controllers: [InstructorAssistantController],
  exports: [InstructorAssistantService],
})
export class InstructorAssistantModule {}
