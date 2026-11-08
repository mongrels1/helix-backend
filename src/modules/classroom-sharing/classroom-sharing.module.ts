import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClassroomSharingController } from './classroom-sharing.controller';
import { ClassroomSharingService } from './classroom-sharing.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [ClassroomSharingController],
  providers: [ClassroomSharingService],
})
export class ClassroomSharingModule {}
