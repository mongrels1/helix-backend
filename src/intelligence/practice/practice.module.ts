import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntitlementModule } from '@modules/entitlement/entitlement.module';
import { PracticeController } from './practice.controller';
import { PracticeService } from './practice.service';

/** Student practice pool — serves approved generated items as unscored practice. */
@Module({
  imports: [PrismaModule, EntitlementModule],
  controllers: [PracticeController],
  providers: [PracticeService],
})
export class PracticeModule {}
