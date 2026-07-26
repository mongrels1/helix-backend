import { Module } from '@nestjs/common';
import { EmailModule } from '@modules/email/email.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';

@Module({
  imports: [EmailModule, PrismaModule],
  controllers: [RosterController],
  providers: [RosterService],
})
export class RosterModule {}
