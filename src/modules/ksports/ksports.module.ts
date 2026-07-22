import { Module } from '@nestjs/common';
import { KSportsController } from './ksports.controller';
import { KSportsService } from './ksports.service';
import { KSportsRepository } from './ksports.repository';
// If PrismaService isn't provided globally in your AppModule, also import your
// PrismaModule here so KSportsRepository can inject it.
// import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  // imports: [PrismaModule],
  controllers: [KSportsController],
  providers: [KSportsService, KSportsRepository],
})
export class KSportsModule {}
