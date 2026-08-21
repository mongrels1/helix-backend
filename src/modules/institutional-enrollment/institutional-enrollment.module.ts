import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { InstitutionalEnrollmentController } from './institutional-enrollment.controller';
import { InstitutionalEnrollmentService } from './institutional-enrollment.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [InstitutionalEnrollmentController],
  providers: [InstitutionalEnrollmentService],
  exports: [InstitutionalEnrollmentService],
})
export class InstitutionalEnrollmentModule {}
