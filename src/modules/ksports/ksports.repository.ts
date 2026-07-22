import { Injectable } from '@nestjs/common';
// Adjust this import to your project's PrismaService location (helix-backend
// keeps it at src/prisma/prisma.service.ts).
import { PrismaService } from '../../prisma/prisma.service';
import type { KSportsModule } from './dto/record-fact.dto';

@Injectable()
export class KSportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByStudent(studentId: string) {
    return this.prisma.kSportsFact.findMany({
      where: { studentId },
      select: { module: true, factKey: true },
    });
  }

  /** Insert a mastered fact. Returns true if newly inserted, false if it already existed. */
  async record(studentId: string, module: KSportsModule, factKey: string): Promise<boolean> {
    try {
      await this.prisma.kSportsFact.create({ data: { studentId, module, factKey } });
      return true;
    } catch (e) {
      // P2002 = Prisma unique-constraint violation → the student already owns
      // this fact. Checked structurally so this file needs no generated types.
      if ((e as { code?: string })?.code === 'P2002') return false;
      throw e;
    }
  }
}
