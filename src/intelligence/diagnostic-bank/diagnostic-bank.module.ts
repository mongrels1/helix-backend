import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiagnosticBankController } from './diagnostic-bank.controller';
import { DiagnosticBankService } from './diagnostic-bank.service';

/**
 * Diagnostic staging bank (Super-Admin curation of the scored diagnostic).
 * DB-backed; the live diagnostic still serves from code until items are published.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DiagnosticBankController],
  providers: [DiagnosticBankService],
  exports: [DiagnosticBankService],
})
export class DiagnosticBankModule {}
